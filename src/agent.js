'use strict';
// Turns a messy WhatsApp-style order message into a structured invoice draft.
// Primary: NEAR AI Cloud (OpenAI-compatible, TEE-backed private inference).
// Fallback: deterministic regex parser, so the app never blocks on the model.
// Guardrails: every draft is validated against merchant-defined limits before it can become an invoice.

const NEARAI_BASE = process.env.NEARAI_BASE || 'https://cloud-api.near.ai/v1';
const MODEL = process.env.NEARAI_MODEL || 'zai-org/GLM-5.1-FP8';

const SYSTEM = `You convert a customer order message from a Nigerian gadget shop into JSON.
Return ONLY JSON, no prose, no markdown fences:
{"customer": string|null, "items":[{"name": string, "qty": integer, "unit_price_ngn": integer}], "note": string|null}
Prices are in Nigerian Naira. "450k" = 450000, "1.2m" = 1200000. If a price is missing, use 0.
Never invent items that are not in the message.`;

function parseNaira(s) {
  const m = String(s).toLowerCase().replace(/[\u20A6,\s]/g, '').match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  return Math.round(m[2] === 'k' ? n * 1e3 : m[2] === 'm' ? n * 1e6 : n);
}

/** Deterministic fallback: lines like "2x HP EliteBook 840 @ 450k" or "Charger - 15,000". */
function regexParse(message) {
  const items = [];
  let customer = null;
  const cm = message.match(/(?:for|customer|name)[:\s]+([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)?)/);
  if (cm) customer = cm[1];
  for (const raw of message.split(/\n|;/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(?:(\d+)\s*[x\u00D7]?\s+)?(.+?)\s*(?:@|at|-|:)\s*\u20A6?\s*([\d.,]+\s*[km]?)\s*(?:each|ea)?$/i);
    if (!m) continue;
    const price = parseNaira(m[3]);
    if (Number.isNaN(price)) continue;
    items.push({ name: m[2].trim(), qty: m[1] ? parseInt(m[1], 10) : 1, unit_price_ngn: price });
  }
  return { customer, items, note: null, source: 'regex' };
}

async function aiParse(message) {
  const key = process.env.NEARAI_API_KEY;
  if (!key) return null;
  const res = await fetch(NEARAI_BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: message }],
    }),
  });
  if (!res.ok) throw new Error('NEAR AI Cloud ' + res.status);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const json = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(json.slice(json.indexOf('{'), json.lastIndexOf('}') + 1));
  return { ...parsed, source: 'near-ai-cloud', model: MODEL, chatId: data.id };
}

/** Merchant-defined constraints the agent can never exceed. */
function validate(draft, limits) {
  const errors = [];
  if (!draft.items?.length) errors.push('No items found in the message.');
  let total = 0;
  for (const it of draft.items || []) {
    if (!it.name || !Number.isInteger(it.qty) || it.qty < 1 || it.qty > limits.maxQty) errors.push(`Bad quantity for "${it.name}".`);
    if (!Number.isFinite(it.unit_price_ngn) || it.unit_price_ngn <= 0) errors.push(`Missing or invalid price for "${it.name}".`);
    total += (it.qty || 0) * (it.unit_price_ngn || 0);
  }
  if (total > limits.maxInvoiceNgn) errors.push(`Total exceeds the merchant limit of ${limits.maxInvoiceNgn} NGN; needs manual approval.`);
  return { ok: errors.length === 0, errors, total };
}

async function draftInvoice(message, limits) {
  let draft = null;
  let aiError = null;
  try { draft = await aiParse(message); } catch (e) { aiError = e.message; }
  if (!draft || !draft.items?.length) draft = regexParse(message);
  const v = validate(draft, limits);
  return { draft, validation: v, aiError };
}

module.exports = { draftInvoice, regexParse, parseNaira, validate };
