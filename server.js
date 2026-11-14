'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { client, payable, findSettlement } = require('./src/oneclick');
const { draftInvoice } = require('./src/agent');
const { ngnToUsdCents, usdCentsToBaseUnits } = require('./src/money');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const cfg = () => ({
  mock: process.env.MOCK === '1',
  merchantName: process.env.MERCHANT_NAME || "Dahnny's Tech Ville",
  merchantCity: process.env.MERCHANT_CITY || 'Onitsha, Nigeria',
  merchantAccount: process.env.MERCHANT_NEAR_ACCOUNT || 'merchant.near',
  settleSymbol: process.env.SETTLE_SYMBOL || 'USDC',
  settleChain: process.env.SETTLE_CHAIN || 'near',
  ngnPerUsd: Number(process.env.NGN_PER_USD || 1550),
  maxInvoiceNgn: Number(process.env.MAX_INVOICE_NGN || 5000000),
  maxQty: Number(process.env.MAX_QTY || 50),
});

let db = { invoices: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
const save = () => { try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {} };

// ---- rate: live NGN/USD with fallback to env ----
let rateCache = { at: 0, value: null };
async function ngnPerUsd() {
  if (process.env.MOCK === '1' || process.env.NGN_PER_USD) return cfg().ngnPerUsd;
  if (Date.now() - rateCache.at < 10 * 60 * 1000 && rateCache.value) return rateCache.value;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const j = await r.json();
    if (j?.rates?.NGN > 0) { rateCache = { at: Date.now(), value: j.rates.NGN }; return j.rates.NGN; }
  } catch {}
  return cfg().ngnPerUsd;
}

// ---- tokens cache ----
let tokenCache = { at: 0, list: [] };
async function tokens() {
  if (Date.now() - tokenCache.at < 5 * 60 * 1000 && tokenCache.list.length) return tokenCache.list;
  tokenCache = { at: Date.now(), list: await client().tokens() };
  return tokenCache.list;
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const readBody = req => new Promise((ok, bad) => {
  let s = '';
  req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } });
});

function publicInvoice(inv) {
  const { quoteResponse, ...rest } = inv;
  return { ...rest, hasQuote: !!quoteResponse };
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const c = cfg();

  if (req.method === 'GET' && p === '/api/config') {
    return send(res, 200, { ...c, ngnPerUsd: await ngnPerUsd(), merchantAccount: c.merchantAccount });
  }
  if (req.method === 'GET' && p === '/api/tokens') {
    return send(res, 200, payable(await tokens()));
  }
  if (req.method === 'GET' && p === '/api/invoices') {
    return send(res, 200, Object.values(db.invoices).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicInvoice));
  }

  // Step 1: AI drafts an invoice from a message (merchant reviews, then confirms).
  if (req.method === 'POST' && p === '/api/draft') {
    const { message } = await readBody(req);
    if (!message || message.length > 4000) return send(res, 400, { error: 'message required (max 4000 chars)' });
    return send(res, 200, await draftInvoice(message, c));
  }

  // Step 2: merchant confirms a draft -> invoice with a locked USD amount.
  if (req.method === 'POST' && p === '/api/invoices') {
    const b = await readBody(req);
    const items = Array.isArray(b.items) ? b.items : [];
    const total = items.reduce((s, i) => s + Number(i.qty) * Number(i.unit_price_ngn), 0);
    if (!items.length || !(total > 0)) return send(res, 400, { error: 'items required' });
    if (total > c.maxInvoiceNgn) return send(res, 400, { error: 'exceeds merchant limit' });
    const rate = await ngnPerUsd();
    const usdCents = ngnToUsdCents(total, rate);
    const id = crypto.randomBytes(5).toString('hex');
    db.invoices[id] = {
      id, customer: b.customer || null, items, note: b.note || null,
      totalNgn: total, rate, usdCents, status: 'UNPAID',
      aiSource: b.aiSource || 'manual', createdAt: new Date().toISOString(),
    };
    save();
    return send(res, 201, publicInvoice(db.invoices[id]));
  }

  let m;
  if ((m = p.match(/^\/api\/invoices\/([a-f0-9]+)$/)) && req.method === 'GET') {
    const inv = db.invoices[m[1]];
    return inv ? send(res, 200, publicInvoice(inv)) : send(res, 404, { error: 'not found' });
  }

  // Step 3: customer picks the asset they hold; we ask 1Click for an EXACT_OUTPUT quote.
  if ((m = p.match(/^\/api\/invoices\/([a-f0-9]+)\/pay$/)) && req.method === 'POST') {
    const inv = db.invoices[m[1]];
    if (!inv) return send(res, 404, { error: 'not found' });
    if (inv.status === 'PAID') return send(res, 400, { error: 'already paid' });
    const { originAsset, refundTo } = await readBody(req);
    if (!originAsset || !refundTo) return send(res, 400, { error: 'originAsset and refundTo required' });
    const list = await tokens();
    const dest = findSettlement(list, c.settleSymbol, c.settleChain);
    if (!dest) return send(res, 502, { error: `settlement token ${c.settleSymbol} on ${c.settleChain} not supported by 1Click` });
    const origin = list.find(t => t.assetId === originAsset);
    if (!origin) return send(res, 400, { error: 'unsupported origin asset' });
    try {
      const qr = await client().quote({
        dry: false,
        swapType: 'EXACT_OUTPUT',
        slippageTolerance: 100,
        originAsset, destinationAsset: dest.assetId,
        amount: usdCentsToBaseUnits(inv.usdCents, dest.decimals),
        depositType: 'ORIGIN_CHAIN', depositMode: 'SIMPLE',
        refundTo, refundType: 'ORIGIN_CHAIN',
        recipient: c.merchantAccount, recipientType: 'DESTINATION_CHAIN',
        deadline: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        referral: 'ogapay',
      });
      inv.quoteResponse = qr;
      inv.payment = {
        originSymbol: origin.symbol, originChain: origin.blockchain,
        depositAddress: qr.quote.depositAddress, depositMemo: qr.quote.depositMemo || null,
        amountInFormatted: qr.quote.amountInFormatted, amountInUsd: qr.quote.amountInUsd,
        deadline: qr.quote.deadline, timeEstimate: qr.quote.timeEstimate,
        correlationId: qr.correlationId, quoteSignature: qr.signature,
      };
      inv.status = 'AWAITING_PAYMENT';
      save();
      return send(res, 200, publicInvoice(inv));
    } catch (e) {
      return send(res, e.status || 502, { error: e.message });
    }
  }

  // Customer says "I paid" with optional tx hash -> speeds up 1Click processing.
  if ((m = p.match(/^\/api\/invoices\/([a-f0-9]+)\/deposit$/)) && req.method === 'POST') {
    const inv = db.invoices[m[1]];
    if (!inv?.payment) return send(res, 404, { error: 'no payment in progress' });
    const { txHash } = await readBody(req);
    try { await client().submitDeposit(inv.payment.depositAddress, txHash); } catch (e) { return send(res, e.status || 502, { error: e.message }); }
    return send(res, 200, { ok: true });
  }

  // Poll 1Click and mark paid on SUCCESS.
  if ((m = p.match(/^\/api\/invoices\/([a-f0-9]+)\/status$/)) && req.method === 'GET') {
    const inv = db.invoices[m[1]];
    if (!inv) return send(res, 404, { error: 'not found' });
    if (inv.payment && inv.status !== 'PAID') {
      try {
        const s = await client().status(inv.payment.depositAddress, inv.payment.depositMemo);
        inv.swapStatus = s.status;
        if (s.status === 'SUCCESS') {
          inv.status = 'PAID';
          inv.paidAt = new Date().toISOString();
          inv.settlementTx = s.swapDetails?.destinationChainTxHashes?.[0] || null;
        } else if (s.status === 'REFUNDED' || s.status === 'FAILED') {
          inv.status = s.status;
        }
        save();
      } catch (e) { return send(res, e.status || 502, { error: e.message }); }
    }
    return send(res, 200, publicInvoice(inv));
  }

  // Demo helper: simulate the customer's on-chain deposit (mock mode only).
  if ((m = p.match(/^\/api\/invoices\/([a-f0-9]+)\/simulate-deposit$/)) && req.method === 'POST') {
    if (!c.mock) return send(res, 403, { error: 'only available in MOCK=1 demo mode' });
    const inv = db.invoices[m[1]];
    if (!inv?.payment) return send(res, 404, { error: 'no payment in progress' });
    await client().submitDeposit(inv.payment.depositAddress);
    return send(res, 200, { ok: true });
  }

  // ---- pages ----
  const page = f => send(res, 200, fs.readFileSync(path.join(__dirname, 'public', f)), f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
  if (p === '/') return page('index.html');
  if (p.startsWith('/pay/')) return page('pay.html');
  if (p.startsWith('/receipt/')) return page('receipt.html');
  if (['/style.css', '/dash.js', '/pay.js', '/receipt.js'].includes(p)) return page(p.slice(1));
  send(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch(e => send(res, 500, { error: e.message }));
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Oga Pay on http://localhost:${PORT}  (${cfg().mock ? 'MOCK demo mode' : 'LIVE 1Click'})`));
}
module.exports = { server };
