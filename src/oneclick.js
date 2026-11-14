'use strict';
// Thin client for the NEAR Intents 1Click API (https://1click.chaindefuser.com)
// plus a deterministic mock so the whole flow can be demoed with no API key and no funds.

const BASE = process.env.ONECLICK_BASE || 'https://1click.chaindefuser.com';
const PAYABLE_SYMBOLS = new Set(['USDC', 'USDT', 'NEAR', 'wNEAR', 'ETH', 'BTC', 'SOL']);

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (process.env.ONECLICK_API_KEY) h['X-API-Key'] = process.env.ONECLICK_API_KEY;
  return h;
}

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { ...headers(), ...(opts.headers || {}) } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { message: text }; }
  if (!res.ok) {
    const err = new Error(body.message || `1Click ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---------- live ----------
const live = {
  name: 'live',
  async tokens() {
    return call('/v0/tokens');
  },
  async quote(req) {
    return call('/v0/quote', { method: 'POST', body: JSON.stringify(req) });
  },
  async status(depositAddress, depositMemo) {
    const q = new URLSearchParams({ depositAddress });
    if (depositMemo) q.set('depositMemo', depositMemo);
    return call('/v0/status?' + q.toString());
  },
  async submitDeposit(depositAddress, txHash) {
    return call('/v0/deposit/submit', { method: 'POST', body: JSON.stringify({ depositAddress, txHash }) });
  },
};

// ---------- mock ----------
const MOCK_TOKENS = [
  { assetId: 'nep141:usdc.mock.near', decimals: 6, blockchain: 'near', symbol: 'USDC', price: '1' },
  { assetId: 'nep141:eth-usdc.mock.omft.near', decimals: 6, blockchain: 'eth', symbol: 'USDC', price: '1' },
  { assetId: 'nep141:base-usdc.mock.omft.near', decimals: 6, blockchain: 'base', symbol: 'USDC', price: '1' },
  { assetId: 'nep141:sol-usdc.mock.omft.near', decimals: 6, blockchain: 'sol', symbol: 'USDC', price: '1' },
  { assetId: 'nep141:eth.omft.near', decimals: 18, blockchain: 'eth', symbol: 'ETH', price: '3200' },
  { assetId: 'nep141:btc.omft.near', decimals: 8, blockchain: 'btc', symbol: 'BTC', price: '95000' },
  { assetId: 'nep141:wrap.near', decimals: 24, blockchain: 'near', symbol: 'wNEAR', price: '2.8' },
];
const mockSwaps = new Map(); // depositAddress -> { quote, depositedAt, phase }

const mock = {
  name: 'mock',
  async tokens() { return MOCK_TOKENS; },
  async quote(req) {
    const o = MOCK_TOKENS.find(t => t.assetId === req.originAsset);
    const d = MOCK_TOKENS.find(t => t.assetId === req.destinationAsset);
    if (!o || !d) { const e = new Error('unknown asset'); e.status = 400; throw e; }
    const usdOut = Number(BigInt(req.amount)) / 10 ** d.decimals * Number(d.price);
    const usdIn = usdOut * 1.003; // 0.3% simulated fee
    const amountIn = BigInt(Math.ceil((usdIn / Number(o.price)) * 10 ** o.decimals)).toString();
    const depositAddress = 'mock_' + Math.random().toString(36).slice(2, 12);
    const quote = {
      depositAddress,
      amountIn,
      amountInFormatted: (Number(amountIn) / 10 ** o.decimals).toString(),
      amountInUsd: usdIn.toFixed(2),
      minAmountIn: amountIn,
      amountOut: req.amount,
      amountOutFormatted: (usdOut / Number(d.price)).toString(),
      amountOutUsd: usdOut.toFixed(2),
      minAmountOut: req.amount,
      deadline: req.deadline,
      timeEstimate: 20,
    };
    mockSwaps.set(depositAddress, { phase: 'PENDING_DEPOSIT', at: 0 });
    return { correlationId: 'mock-' + depositAddress, timestamp: new Date().toISOString(), signature: 'mock-signature', quoteRequest: req, quote };
  },
  async status(depositAddress) {
    const s = mockSwaps.get(depositAddress);
    if (!s) { const e = new Error('unknown deposit address'); e.status = 404; throw e; }
    if (s.phase === 'PROCESSING' && Date.now() - s.at > 4000) s.phase = 'SUCCESS';
    return { status: s.phase, swapDetails: s.phase === 'SUCCESS' ? { destinationChainTxHashes: [{ hash: 'mock_tx_' + depositAddress, explorerUrl: '#' }] } : {} };
  },
  async submitDeposit(depositAddress) {
    const s = mockSwaps.get(depositAddress);
    if (s && s.phase === 'PENDING_DEPOSIT') { s.phase = 'PROCESSING'; s.at = Date.now(); }
    return { ok: true };
  },
};

function client() { return process.env.MOCK === '1' ? mock : live; }

/** Tokens a customer might hold, trimmed to a sane list for the UI. */
function payable(tokens) {
  return tokens
    .filter(t => PAYABLE_SYMBOLS.has(t.symbol))
    .map(t => ({ assetId: t.assetId, symbol: t.symbol, blockchain: t.blockchain, decimals: t.decimals, price: t.price }))
    .sort((a, b) => (a.symbol + a.blockchain).localeCompare(b.symbol + b.blockchain));
}

/** Find the merchant's settlement token (default: USDC on NEAR). */
function findSettlement(tokens, symbol, chain) {
  return tokens.find(t => t.symbol.toUpperCase() === symbol.toUpperCase() && t.blockchain === chain);
}

module.exports = { client, payable, findSettlement, live, mock };
