const test = require('node:test');
const assert = require('node:assert');
const { ngnToUsdCents, usdCentsToBaseUnits, formatUnits } = require('../src/money');

test('NGN to USD cents rounds up', () => {
  assert.strictEqual(ngnToUsdCents(1550, 1550), 100);
  assert.strictEqual(ngnToUsdCents(1551, 1550), 101); // never underpay the merchant
});
test('USD cents to USDC base units (6 decimals)', () => {
  assert.strictEqual(usdCentsToBaseUnits(12345, 6), '123450000');
});
test('formatUnits', () => {
  assert.strictEqual(formatUnits('123450000', 6), '123.45');
  assert.strictEqual(formatUnits('1', 6), '0.000001');
});
test('rejects bad input', () => {
  assert.throws(() => ngnToUsdCents(0, 1500));
  assert.throws(() => ngnToUsdCents(100, 0));
});
