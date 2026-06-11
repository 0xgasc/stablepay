# StablePay (WeTakeStables)

Production multi-chain stablecoin payment gateway. Merchants embed a checkout widget or link a
hosted page; customers pay USDC / USDT / EURC (or native ETH/SOL/BNB/MATIC, auto-swapped) on
**Base, Ethereum, Polygon, Arbitrum, BNB Chain, Solana, and TRON — mainnet**. A scanner worker
matches on-chain transfers to orders and fires signed webhooks.

**Live:** https://wetakestables.shop · API on Vercel (serverless) · scanner on Railway (worker)

## Read this first, by audience

| You are… | Read |
|----------|------|
| Working on this codebase (incl. Claude) | **[CLAUDE.md](CLAUDE.md)** — critical invariants, pre-push checklist |
| Operating production | **[OPS_RUNBOOK.md](OPS_RUNBOOK.md)** — health checks, alerting, common ops |
| A merchant integrating | **[MERCHANT_INTEGRATION_GUIDE.md](MERCHANT_INTEGRATION_GUIDE.md)** |
| Curious about past incidents | [LEARNINGS.md](LEARNINGS.md) · `docs/_archive/` (historical docs) |

## Architecture

```
Vercel (serverless)                        Railway worker ("mellow-surprise")
  api/index.js → dist/index.js (Express)     src/scanner.ts
  public/  checkout-widget.js  (embed)         payment scan loop (15s)
           crypto-pay.html     (hosted)        order expiry (single path)
           dashboard.html      (merchants)     webhook retries + fee check
                     \                         health/merchant alerters
                      \— shared PostgreSQL —— recovery + data retention
```

- **Two checkout surfaces** that must stay in sync — CI runs `scripts/check-config-drift.ts`
  to enforce token/contract parity between scanner, widget, and hosted page.
- **All schedulers live on the scanner.** Never add node-cron to the web tier — serverless
  functions only fire crons on warm instances ("sometimes" is worse than never).

## Development

```bash
npm install
cp .env.example .env       # fill in values — see comments in the file
npm run dev                # web tier on :3000
npx tsx src/scanner.ts     # scanner worker (separate terminal)
npm test                   # vitest — 124 tests, money-core covered
npx tsc --noEmit           # type check
npx tsx scripts/check-config-drift.ts
```

⚠️ `DATABASE_URL` in a copied `.env` may point at **production**. For local experiments use a
local Postgres or a branch database.

### Before pushing checkout / payment code

See the checklist in [CLAUDE.md](CLAUDE.md). CI (`.github/workflows/ci.yml`) enforces
type-check, tests, frontend syntax, and config drift on every push; money-moving changes
additionally get an adversarial review per CLAUDE.md rule 6.

## Deploy

Push to `main` → Vercel builds API + statics, Railway builds the scanner. Post-deploy:
`npx ts-node scripts/prod-smoke.ts` (33 endpoint checks).
