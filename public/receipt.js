const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ngn = n => '\u20A6' + Number(n).toLocaleString('en-NG');
(async () => {
  const id = location.pathname.split('/').pop();
  const [cfg, i] = await Promise.all([fetch('/api/config').then(r => r.json()), fetch('/api/invoices/' + id).then(r => r.json())]);
  if (i.error) return document.getElementById('r').textContent = i.error;
  const p = i.payment || {};
  document.getElementById('r').innerHTML = `
  <h1>Receipt</h1><div class="mute">${esc(cfg.merchantName)} \u00B7 ${esc(cfg.merchantCity)}</div>
  <p><b>${esc(i.customer || 'Walk-in customer')}</b> \u00B7 Invoice ${esc(i.id)} \u00B7 <span class="pill ${i.status}">${i.status}</span></p>
  <table>${i.items.map(x => `<tr><td>${esc(x.name)}</td><td class="n">${x.qty} \u00D7 ${ngn(x.unit_price_ngn)}</td></tr>`).join('')}
  <tr><td><b>Total</b></td><td class="n"><b>${ngn(i.totalNgn)}</b></td></tr></table>
  <p class="mute">Locked at \u20A6${Math.round(i.rate)}/$ = $${(i.usdCents / 100).toFixed(2)}. Customer paid ${esc(p.amountInFormatted)} ${esc(p.originSymbol)} on ${esc(p.originChain)}; merchant received ${esc(cfg.settleSymbol)} on ${esc(cfg.settleChain)} at ${esc(cfg.merchantAccount)}.</p>
  <p class="mute" style="font-size:12px;word-break:break-all">Paid: ${esc(i.paidAt || '-')}<br>Deposit address: ${esc(p.depositAddress)}<br>1Click correlation ID: ${esc(p.correlationId)}<br>1Click quote signature: ${esc(p.quoteSignature)}<br>Invoice drafted by: ${esc(i.aiSource)}</p>`;
})();
