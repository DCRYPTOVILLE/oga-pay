const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ngn = n => '\u20A6' + Number(n).toLocaleString('en-NG');
let draft = null, cfg = null;

async function api(p, o) { const r = await fetch(p, o); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; }

async function init() {
  cfg = await api('/api/config');
  $('merchant').textContent = `${cfg.merchantName} \u00B7 ${cfg.merchantCity} \u00B7 settles to ${cfg.settleSymbol} on ${cfg.settleChain} \u00B7 \u20A6${Math.round(cfg.ngnPerUsd)}/$`;
  $('mode').textContent = cfg.mock ? 'DEMO MODE (simulated 1Click)' : 'LIVE \u00B7 NEAR Intents';
  $('mode').className = 'tag ' + (cfg.mock ? 'mock' : 'live');
  load();
}

async function load() {
  const list = await api('/api/invoices');
  $('list').innerHTML = '<tr><th>Customer</th><th class="n">Amount</th><th>Status</th><th></th></tr>' + (list.length ? list.map(i =>
    `<tr><td>${esc(i.customer || 'Walk-in')}<div class="mute">${esc(i.items.map(x => x.qty + 'x ' + x.name).join(', ').slice(0, 60))}</div></td>
     <td class="n">${ngn(i.totalNgn)}<div class="mute">$${(i.usdCents / 100).toFixed(2)}</div></td>
     <td><span class="pill ${i.status}">${i.status.replace('_', ' ')}</span></td>
     <td><a href="/pay/${i.id}">Pay link</a>${i.status === 'PAID' ? ` \u00B7 <a href="/receipt/${i.id}">Receipt</a>` : ''}</td></tr>`).join('') : '<tr><td class="mute" colspan="4">No invoices yet.</td></tr>');
}

$('draftBtn').onclick = async () => {
  $('draftErr').textContent = ''; $('draftBtn').disabled = true;
  try {
    const r = await api('/api/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: $('msg').value }) });
    draft = r.draft;
    $('draftCard').style.display = '';
    $('draftMeta').textContent = `Drafted by: ${r.draft.source === 'near-ai-cloud' ? 'NEAR AI Cloud (' + r.draft.model + ')' : 'built-in parser (no NEARAI_API_KEY set or model unavailable)'}${r.aiError ? ' \u00B7 AI error: ' + r.aiError : ''}`;
    $('draftTable').innerHTML = '<tr><th>Item</th><th class="n">Qty</th><th class="n">Unit</th><th class="n">Line</th></tr>' +
      draft.items.map(i => `<tr><td>${esc(i.name)}</td><td class="n">${i.qty}</td><td class="n">${ngn(i.unit_price_ngn)}</td><td class="n">${ngn(i.qty * i.unit_price_ngn)}</td></tr>`).join('') +
      `<tr><td colspan="3"><b>Total</b></td><td class="n"><b>${ngn(r.validation.total)}</b></td></tr>`;
    $('valErr').innerHTML = r.validation.ok ? '<span class="ok">Within your limits.</span>' : r.validation.errors.map(esc).join('<br>');
    $('createBtn').disabled = !r.validation.ok;
  } catch (e) { $('draftErr').textContent = e.message; }
  $('draftBtn').disabled = false;
};

$('createBtn').onclick = async () => {
  const inv = await api('/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, aiSource: draft.source }) });
  $('draftCard').style.display = 'none';
  await load();
  location.href = '/pay/' + inv.id;
};
init();
