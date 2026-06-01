# StablePay / WeTakeStables — Claude working notes

Crypto checkout / stablecoin payment gateway. Express + Prisma + Railway (scanner worker) + Vercel (API `/api` + static `public/`).

## ⛔ RULE #1 — VERIFY chain / token / gas facts. NEVER assert them from memory.

Crypto reality drifts fast and training intuitions go stale. This has burned us repeatedly this
project — claimed "brutal L1 gas" when Ethereum L1 was 0.18 gwei; claimed "no EURC on Solana" when
it's fully supported. **Before stating any** gas cost, fee, token availability, mint/contract
address, finality, or "chain X is expensive/cheap":

- **Gas / price:** `curl` the chain's RPC (`eth_gasPrice`) + a price feed (CoinGecko), compute USD.
- **Token / mint support:** grep this repo's config (see file map). Don't recall it.

If you can't verify it right now, say "let me check" — do **not** wing it. (See global memory
`feedback_verify_chain_facts`.)

## Critical facts (the non-obvious ones that keep biting)

- **Tokens: USDC, USDT, and EURC on ALL chains — including Solana.** EURC on Solana is real
  (Circle), mint `HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr`. A token's mint/address must be
  consistent across FOUR places — keep them in sync when adding/checking a token:
  - scanner detection — `src/services/blockchainService.ts` (CHAIN_STABLES + SOL mints, ~line 27/46)
  - swap targets — `src/services/swapService.ts` (`EVM_CHAIN[chain].stables`, `SOL_STABLES`)
  - widget offers — `public/checkout-widget.js` (CHAIN_TOKENS)
  - page offers — `public/crypto-pay.html` (CHAIN_CONFIG)
- **Gas is CHEAP now.** Ethereum L1 ≈ sub-1 gwei for most of 2025-26 (post-Dencun); a native send
  is sub-cent, a swap a few cents. Don't design around "expensive L1 gas."
- **Bootstrap gas model — do NOT tell the user to pre-fund the agent on every chain.** Native
  payments fund their own gas from the customer's deposit; `ensureGas`/`ensureSolGas` (swapService)
  self-bootstrap, and the forward-sweep seeds the agent wallet over time. The agent wallet
  (`0xa0Be…6BE`, AGENT_WALLET_KEY / AGENT_SOLANA_KEY) is a FALLBACK. The health-monitor
  "agentGas WARNING" is informational, not a blocker.
- **The scanner MUST hold the wallet-encryption key to process native.**
  `ENC_KEY = MANAGED_WALLET_ENCRYPTION_KEY || JWT_SECRET || AGENT_WALLET_KEY`, used **untrimmed**
  for AES. If the Railway scanner lacks it, native swaps silently fail with "No encryption key
  configured" — this WAS why native never settled. It must be **byte-identical** to the web tier's
  value (beware trailing `\n` from `echo`-set Vercel vars). Scanner also needs AGENT_WALLET_KEY
  (EVM gas) + AGENT_SOLANA_KEY (SOL gas).

## Architecture quickref

- **Two checkout surfaces — keep in sync.** `public/checkout-widget.js` = the embedded widget (what
  merchants embed, e.g. unlockriver.com — the primary surface). `public/crypto-pay.html` = the
  hosted page. Both serve the **`fast`** variant to 100% of traffic (control/guided retired, behind
  `?sp_variant=` QA override only).
- **Default rail = Solana-preferred** (fast/cheap/gas-funded/proven) when the merchant supports it,
  else the merchant's first-configured chain.
- **Edit-payment-options panel = INSTANT apply.** Pick a chain/coin → address + amount update
  immediately. Do NOT re-introduce stage-until-Save — it reads as broken ("I picked Solana, nothing
  changed"). The green "Done" button just collapses the panel.
- **Clean gray/white, no chromatic color** in the fast checkout, except the one green action button.
- **Native swap path** (`swapService`): customer pays ETH/SOL/BNB/MATIC → per-order receive wallet
  (AES-encrypted) → `swapAndForward` (LiFi for EVM / Jupiter for SOL) → merchant gets USDC.
  Confirm paths: scanner poll (`blockchainService`, Railway worker "mellow-surprise") + manual
  `/tx`. `recoveryService` reconciles stranded native funds (retry swap → refund known wallet →
  flag manual). Solana swaps must reserve wSOL-wrap + ATA rent + fee overhead or they hit SPL Token
  `0x1`.

## Before you push (checkout / payment code)

1. `node --check public/checkout-widget.js`
2. Extract `crypto-pay.html` inline `<script>` (no `src`) and `node --check` it.
3. `npx tsc --noEmit`
4. Verify every chain/token/gas claim against code or RPC (Rule #1).
5. Telemetry: any event the frontend fires must be in `ALLOWED_WIDGET_EVENTS`
   (`src/routes/embed.ts`) or the `/event` endpoint silently drops it. Events land in the
   `widget_events` table; aggregation is `GET /api/v1/admin/ab-results`.
6. Money-moving changes: run an adversarial review before shipping — it has caught real
   double-spend / double-refund / misroute bugs that `tsc` + read-through missed.

## Deploy

Push to `main` → Railway auto-deploys the scanner; Vercel auto-deploys API + static. Static files
(widget/page) propagate in ~20-60s; hard-refresh to test. Set Vercel/Railway env vars with
`printf`, **not** `echo` — a trailing `\n` broke `MERCHANT_ID` once and is a silent decryption
hazard for `JWT_SECRET`.
