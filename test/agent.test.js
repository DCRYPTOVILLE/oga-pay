const test = require('node:test');
const assert = require('node:assert');
const { regexParse, parseNaira, validate } = require('../src/agent');

test('parseNaira handles k/m suffix and commas', () => {
  assert.strictEqual(parseNaira('450k'), 450000);
  assert.strictEqual(parseNaira('1.2m'), 1200000);
  assert.strictEqual(parseNaira('15,000'), 15000);
  assert.strictEqual(parseNaira('\u20A63500'), 3500);
});
test('regexParse reads a WhatsApp order', () => {
  const d = regexParse('Hi, this is for Chidi Okafor\n2x HP EliteBook 840 G5 @ 450k\n1 Original 65W charger - 15,000\nScreen guard @ 3500');
  assert.strictEqual(d.items.length, 3);
  assert.deepStrictEqual(d.items[0], { name: 'HP EliteBook 840 G5', qty: 2, unit_price_ngn: 450000 });
  assert.strictEqual(d.items[2].unit_price_ngn, 3500);
});
test('guardrails block oversized or priceless drafts', () => {
  const limits = { maxInvoiceNgn: 1000000, maxQty: 10 };
  assert.strictEqual(validate({ items: [{ name: 'x', qty: 1, unit_price_ngn: 500 }] }, limits).ok, true);
  assert.strictEqual(validate({ items: [{ name: 'x', qty: 1, unit_price_ngn: 2000000 }] }, limits).ok, false);
  assert.strictEqual(validate({ items: [{ name: 'x', qty: 99, unit_price_ngn: 5 }] }, limits).ok, false);
  assert.strictEqual(validate({ items: [{ name: 'x', qty: 1, unit_price_ngn: 0 }] }, limits).ok, false);
  assert.strictEqual(validate({ items: [] }, limits).ok, false);
});
