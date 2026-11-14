# Oga Pay

**Naira-priced invoices that anyone in the world can pay from any chain. The merchant receives stablecoins on NEAR.**

NEAR HACKATHON 2026 · Track: **Real-World Money** (also uses NEAR AI Cloud)

## The problem

I run a gadget shop in Onitsha, Nigeria (Dahnny's Tech Ville). Customers abroad, diaspora family buying for relatives, and crypto-native buyers want to pay me, but bank transfers across borders are slow and expensive, and the naira moves fast. Merchants in markets like mine quote in naira, get paid in whatever the buyer has, and lose money on conversion and delays.

## What it does

1. **Paste a WhatsApp order.** An AI agent on **NEAR AI Cloud** (TEE-backed private inference) turns the messy text into a structured invoice. If the model is unavailable, a built-in parser takes over.
2. **Guardrails, not blind trust.** The merchant defines hard limits (max invoice total, max quantity). Every AI draft is validated against them, and the server re-checks on creation. A draft that breaks a limit cannot become an invoice.
3. **Locked price.** The naira total is converted to USD at the current rate (rounded up so the merchant is never underpaid) and locked on the invoice.
4. **Pay from anything.** The customer opens a payment link, picks the asset and network they hold (USDC on Base/Ethereum/Solana, ETH, BTC, SOL, NEAR...) and gets a deposit address and exact amount. This uses the **NEAR Intents 1Click API** with an `EXACT_OUTPUT` quote, so the merchant receives exactly the invoice value in **USDC on NEAR** and slippage is absorbed on the customer's side. Failed swaps refund to the customer automatically.
5. **Live status and receipt.** The page tracks `PENDING_DEPOSIT → PROCESSING → SUCCESS`, marks the invoice paid, and issues a printable receipt that stores the 1Click correlation ID and quote signature for dispute resolution.

## NEAR tools used

- **NEAR Intents (1Click API):** `/v0/tokens`, `/v0/quote` (EXACT_OUTPUT, ORIGIN_CHAIN deposit, DESTINATION_CHAIN recipient), `/v0/deposit/submit`, `/v0/status`
- **NEAR AI Cloud:** OpenAI-compatible chat completions at `https://cloud-api.near.ai/v1` for order-to-invoice drafting
- Settlement to a NEAR account (default asset: USDC on NEAR)

## Try it (no keys, no funds, 60 seconds)

Requires Node 18+. No dependencies to install.

```bash
# or download the ZIP from GitHub and unzip it
cd oga-pay
npm run demo          # runs MOCK=1 with a simulated 1Click
```

Open http://localhost:3000

| Do this | You should see |
|---|---|
| Click **Let the AI draft the invoice** (sample order is pre-filled) | A table with 3 items and a total of ₦918,500. "Drafted by" says built-in parser unless `NEARAI_API_KEY` is set. |
| Edit the message so one price is `99999999` and draft again | A red message that the total exceeds the merchant limit, and **Create payment link** is disabled. |
| Draft the sample again and click **Create payment link** | You land on `/pay/<id>` showing ₦918,500 ≈ $592.59. |
| Pick **USDC on base**, enter any refund address, click **Get payment details** | An exact amount to send, a deposit address, and a "Waiting for your deposit" status. |
| Click **Simulate my deposit (demo)** | Steps move to "Swapping" then, after about 4 seconds, the "Payment received" card. |
| Click **View receipt** | A receipt showing the locked rate, what the customer paid, what the merchant received, and the quote signature. |
| Go back to `/` | The invoice shows as PAID. |

Run the tests: `npm test` (10 tests including a full draft → pay → PAID flow).

## Run it live

```bash
cp .env.example .env     # set MERCHANT_NEAR_ACCOUNT, optionally NEARAI_API_KEY and ONECLICK_API_KEY
export $(grep -v '^#' .env | xargs) && MOCK=0 npm start
```

In live mode the customer sends a real deposit to the 1Click deposit address. Start with a very small amount; the 1Click docs recommend a test amount first. The merchant NEAR account must be able to receive the settlement token.

## How it works

```
WhatsApp text ──► NEAR AI Cloud ──► draft ──► guardrails ──► invoice (NGN locked to USD)
                                                                  │
customer picks asset ──► 1Click /v0/quote (EXACT_OUTPUT) ──► deposit address
                                                                  │
customer sends funds ──► /v0/status polling ──► SUCCESS ──► PAID + receipt
```

Files: `server.js` (API + pages), `src/oneclick.js` (client + mock), `src/agent.js` (AI drafting + guardrails), `src/money.js` (BigInt amount math), `public/` (UI), `test/`.

## Honest limitations

- Demo mode simulates 1Click so judges can run the whole flow without funds. The live client follows the published OpenAPI spec, but I could only test the live path against the docs, not with real money, inside the hackathon window.
- Storage is a JSON file. A production version would use a database and webhooks instead of polling.
- No authentication on the merchant dashboard yet; it is meant to run on the merchant's own machine.
- The NGN/USD rate comes from a public rate API (or `NGN_PER_USD`); the informal Nigerian market rate can differ.

## Built at NEAR HACKATHON

Built by Daniel Onyekwere (solo) during NEAR HACKATHON, Nov 2026. All code was written in the hackathon window with AI assistance (Claude). No pre-existing code or libraries beyond Node.js built-ins; there are no npm dependencies.

## License

MIT
