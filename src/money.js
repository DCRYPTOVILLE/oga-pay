'use strict';
// Money helpers. All token math uses BigInt so we never lose precision.

/** NGN -> USD cents, rounded UP so the merchant is never underpaid. */
function ngnToUsdCents(ngn, ngnPerUsd) {
  if (!(ngn > 0) || !(ngnPerUsd > 0)) throw new Error('invalid amount or rate');
  return Math.ceil((ngn / ngnPerUsd) * 100);
}

/** USD cents -> smallest unit of a token whose decimals are `decimals` (1 token == 1 USD, e.g. USDC). */
function usdCentsToBaseUnits(cents, decimals) {
  if (decimals < 2) throw new Error('decimals too small');
  return (BigInt(cents) * 10n ** BigInt(decimals - 2)).toString();
}

/** Base units string -> human readable decimal string. */
function formatUnits(baseUnits, decimals, maxFrac = 6) {
  const neg = String(baseUnits).startsWith('-');
  const s = String(baseUnits).replace('-', '').padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  let frac = s.slice(s.length - decimals).slice(0, maxFrac).replace(/0+$/, '');
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
}

function formatNgn(n) {
  return '\u20A6' + Number(n).toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

module.exports = { ngnToUsdCents, usdCentsToBaseUnits, formatUnits, formatNgn };
