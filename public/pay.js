const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ngn = n => '\u20A6' + Number(n).toLocaleString('en-NG');
const id = location.pathname.split('/').pop();
let cfg, inv, timer;
async function api(p, o) { const r = await fetch(p, o); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; }

function show(i) {
  inv = i;
  $('ngn').textContent = ngn(i.totalNgn);
  $('usd').textContent = `\u2248 $${(i.usdCents / 100).toFixed(2)} at \u20A6${Math.round(i.rate)}/$`;
  $('items').innerHTML = i.items.map(x => `<tr><td>${esc(x.name)}</td><td class="n">${x.qty} \u00D7 ${ngn(x.unit_price_ngn)}</td></tr>`).join('');
  if (i.status === 'PAID') return done();
  if (i.payment) return showPayment();
}

function showPayment() {
  const p = inv.payment;
  $('choose').style.display = 'none'; $('pay').style.display = '';
  $('amt').textContent = `${p.amountInFormatted} ${p.originSymbol}`;
  $('amtusd').textContent = `\u2248 $${p.amountInUsd}`;
  $('chain').textContent = p.originChain.toUpperCase();
  $('addr').textContent = p.depositAddress;
  $('memo').textContent = p.depositMemo ? 'Memo required: ' + p.depositMemo : '';
  $('dl').textContent = p.deadline ? new Date(p.deadline).toLocaleTimeString() : '';
  if (cfg.mock) $('sim').style.display = '';
  const sw = inv.swapStatus || 'PENDING_DEPOSIT';
  $('s2').className = 'step' + (['KNOWN_DEPOSIT_TX', 'PROCESSING', 'SUCCESS'].includes(sw) ? ' on' : '');
  $('state').textContent = { PENDING_DEPOSIT: 'Waiting for your deposit\u2026', KNOWN_DEPOSIT_TX: 'Deposit detected\u2026', PROCESSING: 'Swapping via NEAR Intents\u2026', INCOMPLETE_DEPOSIT: 'Deposit received but too small. Send the remainder.', REFUNDED: 'Refunded to your address.', FAILED: 'Swap failed.' }[sw] || sw;
  clearInterval(timer);
  timer = setInterval(async () => { try { show(await api(`/api/invoices/${id}/status`)); } catch (e) { $('state').textContent = e.message; } }, 3000);
}

function done() {
  clearInterval(timer);
  $('choose').style.display = 'none'; $('pay').style.display = 'none'; $('paid').style.display = '';
  $('settle').textContent = `${cfg.settleSymbol} on ${cfg.settleChain}`;
  $('rc').href = '/receipt/' + id;
}

async function init() {
  cfg = await api('/api/config');
  $('who').textContent = 'Pay ' + cfg.merchantName;
  $('sub').textContent = cfg.merchantCity;
  $('mode').textContent = cfg.mock ? 'DEMO MODE' : 'LIVE \u00B7 NEAR Intents';
  $('mode').className = 'tag ' + (cfg.mock ? 'mock' : 'live');
  const tokens = await api('/api/tokens');
  $('asset').innerHTML = tokens.map(t => `<option value="${esc(t.assetId)}">${esc(t.symbol)} on ${esc(t.blockchain)}</option>`).join('');
  show(await api('/api/invoices/' + id));
}

$('payBtn').onclick = async () => {
  $('err').textContent = ''; $('payBtn').disabled = true;
  try {
    show(await api(`/api/invoices/${id}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originAsset: $('asset').value, refundTo: $('refund').value.trim() }) }));
  } catch (e) { $('err').textContent = e.message; }
  $('payBtn').disabled = false;
};
$('copy').onclick = () => navigator.clipboard.writeText(inv.payment.depositAddress);
$('sim').onclick = () => api(`/api/invoices/${id}/simulate-deposit`, { method: 'POST' });
init().catch(e => { document.body.insertAdjacentHTML('beforeend', '<p class="err">' + esc(e.message) + '</p>'); });
