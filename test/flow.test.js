// End-to-end in MOCK mode: draft -> invoice -> quote -> deposit -> PAID
process.env.MOCK = '1';
process.env.DATA_FILE = require('path').join(require('os').tmpdir(), 'ogapay-test-' + process.pid + '.json');
const test = require('node:test');
const assert = require('node:assert');
const { server } = require('../server');

let base;
test.before(() => new Promise(ok => server.listen(0, () => { base = 'http://localhost:' + server.address().port; ok(); })));
test.after(() => server.close());
const j = (p, body) => fetch(base + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}).then(async r => ({ status: r.status, body: await r.json() }));

test('full payment flow', async () => {
  const d = await j('/api/draft', { message: '2x Laptop @ 450k\nCharger - 15,000' });
  assert.ok(d.body.validation.ok);
  assert.strictEqual(d.body.validation.total, 915000);

  const inv = await j('/api/invoices', { ...d.body.draft });
  assert.strictEqual(inv.status, 201);
  assert.strictEqual(inv.body.usdCents, Math.ceil(915000 / 1550 * 100));

  const toks = await j('/api/tokens');
  const usdcBase = toks.body.find(t => t.symbol === 'USDC' && t.blockchain === 'base');
  const pay = await j(`/api/invoices/${inv.body.id}/pay`, { originAsset: usdcBase.assetId, refundTo: '0xabc' });
  assert.strictEqual(pay.status, 200);
  assert.ok(pay.body.payment.depositAddress);
  assert.strictEqual(pay.body.status, 'AWAITING_PAYMENT');
  assert.ok(Number(pay.body.payment.amountInUsd) >= inv.body.usdCents / 100); // customer covers the invoice

  assert.strictEqual((await j(`/api/invoices/${inv.body.id}/status`)).body.swapStatus, 'PENDING_DEPOSIT');
  await j(`/api/invoices/${inv.body.id}/simulate-deposit`, {});
  assert.strictEqual((await j(`/api/invoices/${inv.body.id}/status`)).body.swapStatus, 'PROCESSING');
  await new Promise(r => setTimeout(r, 4200));
  const done = await j(`/api/invoices/${inv.body.id}/status`);
  assert.strictEqual(done.body.status, 'PAID');
});

test('merchant limit is enforced server-side', async () => {
  const r = await j('/api/invoices', { items: [{ name: 'x', qty: 1, unit_price_ngn: 999999999 }] });
  assert.strictEqual(r.status, 400);
});
test('pages render', async () => {
  for (const p of ['/', '/pay/abc', '/receipt/abc']) assert.strictEqual((await fetch(base + p)).status, 200);
});
