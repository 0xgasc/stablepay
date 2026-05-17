# StablePay Operations Runbook

**Last updated:** 2026-05-17 (commit `ab31910`)

Single source of truth for "how does this thing run and what do I do when X happens." Replaces having to dig through the 30 other `.md` files in this repo, most of which are stale.

---

## 1. What this is

Stablecoin payment gateway. Merchants embed a checkout widget, customers pay in USDC/USDT/EURC on 7 blockchains, money lands directly in the merchant's wallet, we take 1–2%.

**Stack:**

| Layer | Tech | Where it runs |
|---|---|---|
| Web + APIs | TypeScript / Express | Vercel (serverless functions) |
| Worker | TypeScript scanner + webhook retries + cron | Railway (`mellow-surprise` service) |
| Database | Postgres (Prisma) | Railway proxy (`maglev.proxy.rlwy.net:45251`) |
| Email | Resend (transactional) | external |
| Errors | Sentry | external |
| AI agent ("Stablo") | Claude API | external |
| Frontend | Vanilla HTML + Tailwind CDN | static, served via Vercel |

Production URL: **https://wetakestables.shop** (canonical) · `stablepay-nine.vercel.app` is the auto-generated Vercel alias for the same project.

---

## 2. Production state

| Metric | Current |
|---|---|
| Active merchants | 7 (Day 1 cohort) |
| Confirmed lifetime payments | 60+ |
| Supported chains | Base, Ethereum, Polygon, Arbitrum, BNB, Solana, TRON |
| Supported stablecoins | USDC, USDT, EURC |
| Languages | English, Spanish, French, Portuguese (customer-facing surfaces) |

**Live verification:**

```bash
curl -s https://wetakestables.shop/api/embed/stats
curl -s https://wetakestables.shop/api/health/platform
```

---

## 3. Pricing

| Audience | Rate | How to set |
|---|---|---|
| **Day 1** (existing 7 merchants) | Flat 1.0% regardless of volume | `Merchant.isDayOne = true` |
| **Public** (new signups) | 2.0% → 1.5% → 1.2% → 1.0% sliding by 30-day volume | Default, no flag needed |
| **Enterprise** (negotiated) | Whatever was agreed | `Merchant.customFeePercent = 0.005` (etc.) |

**Precedence in `calculateFee`:** `customFeePercent` > `isDayOne` > volume tiers.

Tier definitions live in `src/config/pricing.ts:DEFAULT_VOLUME_TIERS`. Can be overridden at runtime via admin: `PUT /api/v1/admin/fee-tiers` (writes to `SystemConfig`).

---

## 4. Where things live

### Hosting

- **Vercel project:** `gs-projects-1311714b/stablepay` — serves web + `/api/*` routes
- **Railway project:** `stablepay` → service `mellow-surprise` (env `production`) — runs `src/scanner.ts` 24/7

### Env vars (Vercel)

Cared-about ones:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (Railway proxy) |
| `ADMIN_PASSWORD` | Admin panel password (login + 2FA) |
| `ADMIN_EMAIL` | Where 2FA codes go (`g@offsetworks.xyz`) |
| `FROM_EMAIL` | Sender used by Resend (`StablePay <donotreply@wetakestables.shop>`) |
| `RESEND_API_KEY` | Email send |
| `SENTRY_DSN` | Error reporting (opt-in — no DSN = no-op) |
| `CRON_SECRET` | Gates `/api/cron/*` routes (also used by Railway worker via shared infra) |
| `ANTHROPIC_API_KEY` | Powers Stablo AI agent |
| Per-chain `*_RPC_URL` | Optional overrides; otherwise public fallbacks |

Inspect: `vercel env ls production`  ·  Pull values: `vercel env pull .env.tmp --environment=production`

### Domain config

- Resend verified domain: `wetakestables.shop` (required for `donotreply@` sends to deliver)
- Vercel rewrites in `vercel.json` map clean URLs and language-prefixed routes (`/es/foo` → static `/foo.html`)

---

## 5. Day 1 program

What it is: merchants onboarded before public-rate launch get a permanent flat 1% as a perk. Not advertised publicly.

**Flag a merchant Day 1:**

```bash
npx tsx scripts/backfill-day-one.ts   # flags every existing merchant (idempotent)
# Or one-off via DB:
# UPDATE merchants SET "isDayOne" = true WHERE id = '<id>';
```

**Currently flagged (7):** OFFSET, test almost april, One Tease Tech B.V., UnlockRiver, Acme corp, Personal, Selena.

---

## 6. Merchant alerter (overnight support)

Runs every 60 min on the Railway worker (see `src/scanner.ts` and `src/services/merchantAlerter.ts`).

What it does: when a merchant has **5+ consecutive same-class webhook failures** in the last 6 hours and we haven't emailed them about that class in the last 12 hours, send them a diagnosis email with fix hint.

Classes detected:
- `webhook_tls` — cert mismatch / expired / untrusted
- `webhook_connection` — DNS fail / refused / unreachable
- `webhook_timeout` — endpoint slow (>10s response)
- `webhook_5xx` — endpoint returns 500-class
- `webhook_4xx` — endpoint rejects requests (often signature mismatch)
- `webhook_other` — fallback

Every alert is logged to `merchant_alerts` table and CC's `ADMIN_EMAIL`.

**Manually trigger** (testing):
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://wetakestables.shop/api/cron/merchant-alerts
```

**Recent alert history:**
```sql
SELECT * FROM merchant_alerts ORDER BY "createdAt" DESC LIMIT 20;
```

---

## 7. Common operations

### Onboard a new merchant (manually)

Right now: signup flow at `/signup`. They get a magic link, complete profile, paste a wallet address, copy widget code into their site. No KYC currently.

### Check a merchant's health

```bash
npx tsx scripts/check-merchants-health.ts
# Edit the script's WHERE clause to filter to specific merchants.
```

Output: last 48h of orders, webhooks (delivered vs failed), recent alerts.

### Force webhook retry for a stuck merchant

Webhooks auto-retry every 60s via the Railway worker. To force NOW:
```bash
# (just hits processRetries via the worker — same code path)
railway logs --service mellow-surprise --environment production | grep webhooks
```

To replay a specific failed log:
```sql
UPDATE webhook_logs SET "nextRetryAt" = NOW(), attempts = 0 WHERE id = '<logId>';
```

### Reset admin password

If forgotten: update env var on Vercel + redeploy, OR set in DB:
```sql
-- For env-based password, no DB change needed
-- For DB-stored (bcrypt) password:
UPDATE system_config SET value = '<bcrypt-hash>' WHERE key = 'admin_password';
```

The auth code checks DB first, falls back to env. Both work.

### Update fee tiers

Admin panel → Settings tab → Fee Matrix. Or via API:
```bash
curl -X PUT https://wetakestables.shop/api/v1/admin/fee-tiers \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"tiers":[{"feePercent":0.02},{"feePercent":0.015},{"feePercent":0.012},{"feePercent":0.01}]}'
```

---

## 8. Common issues & playbook

### "Merchant's webhook URL is failing TLS"

1. Verify their cert: `echo | openssl s_client -showcerts -servername <host> -connect <host>:443 2>/dev/null | openssl x509 -noout -text | grep DNS:`
2. Message them: their cert doesn't cover the hostname we're calling
3. Either they fix their cert or update their `webhookUrl` in our DB to a hostname their cert does cover

### "Customer paid but order shows PENDING"

1. Check the order: `SELECT * FROM orders WHERE id = '<id>'` — was the tx detected?
2. Check transactions: `SELECT * FROM transactions WHERE "orderId" = '<id>'` — what's the confirmation count?
3. Check chain confs: each chain has `requiredConfirms` in `src/config/chains.ts`. ETH = 6 confs = ~72s. Solana = 32 confs = ~13s but feels instant.
4. If a tx exists with `confirmations >= requiredConfirms` but order is still PENDING, scanner's `checkConfirmations` loop didn't run. Restart Railway worker.

### "Order confirmed but merchant didn't get webhook"

1. Check `webhook_logs WHERE "orderId" data path` for that order — was it created?
2. Check `deliveredAt` — null = still trying, not-null with `httpStatus` 200 = they got it
3. If null after many attempts: merchant's endpoint is the problem. Merchant alerter should have emailed them already.

### "Sentry got noisy"

Most infra errors are now classified as transient in `src/utils/logger.ts:error()` and reported as `warning` level to Sentry instead of `error`. If a NEW pattern shows up persistently:
1. Find where it's thrown
2. If it's an infra blip that auto-recovers via retry, add the pattern to the `isTransientInfra` regex in `logger.ts`
3. If it's a real bug, fix it

### "Database can't reach server" errors

Supabase recycles idle connections. The watcher script and long-lived Prisma clients occasionally trip. Mitigations already in place:
- `logger.error` demotes these to Sentry warning level
- Retry queue + retry-driver on Railway re-runs anything that failed
- Health endpoint reads through, gives an accurate picture of REAL DB availability

Don't restart the worker unless `consecutive=20+` failures persist for >5 min.

---

## 9. Useful commands

```bash
# Healthcheck
curl https://wetakestables.shop/api/health/platform | python3 -m json.tool

# Public stats
curl https://wetakestables.shop/api/embed/stats

# Tail Railway scanner logs
railway logs --service mellow-surprise --environment production

# Tail Vercel logs
vercel logs --follow

# Run a one-off diagnostic
npx tsx scripts/check-merchants-health.ts
npx tsx scripts/inspect-OTT444033.ts   # (any of the inspect-* scripts)

# Run tests
npm test

# Deploy
git push origin main   # → Vercel auto, Railway auto

# Schema change
# 1. edit prisma/schema.prisma
# 2. npx prisma db push --skip-generate
# 3. npx prisma generate
# 4. commit + push
```

---

## 10. Not yet shipped (parking lot, prioritized)

### Tier 1 — high-ROI

- **Recurring payments / subscriptions** (~2 weeks). Biggest market unlock (SaaS, gyms, content).
- **Local currency display** (GTQ, MXN, COP, BRL, ARS) — show local price, accept USDC. ~3 days. LatAm differentiator.
- **WhatsApp payment link button** on payment-links UI. ~1 hour. Massive LatAm cultural fit.
- **Testimonials section** (already built, hidden) — needs real quotes from Day 1 merchants. Email outreach template lives in this session's history.

### Tier 2 — defensive

- Email receipts to customers (Resend already wired)
- Comparison landing pages (`/vs/stripe`, `/vs/coinbase-commerce`) for SEO
- Per-merchant analytics tab in dashboard

### Tier 3 — quick wins when you have a free hour

- OpenAPI spec + Postman collection
- "Try without signup" sandbox checkout
- Bulk CSV import for payment links
- Status page email subscription

### Tier 4 — bigger bets, defer

- Fiat off-ramp partnership (Bitso/Lemon/MoonPay)
- Mobile app / PWA
- SOC 2 / formal compliance (only when enterprise prospects ask)

---

## 11. Known limitations

- **Vercel Hobby plan crons** are once-a-day max — that's why the merchant alerter runs on the Railway worker instead.
- **Public Solana RPC** rate-limits browsers; balance checks are proxied through `/api/embed/balance` which has server-side fallback rotation.
- **TRON balance check** is intentionally a no-op (proxy returns 503) since TRON is manual-send only — no connect-wallet flow.
- **Dashboard is English-only** — translation deferred. Merchants currently all read English. Revisit if a Spanish/French-first merchant signs.

---

## 12. Contact / emergencies

- **Sentry alerts** → live at the configured DSN, mirror to `ADMIN_EMAIL`
- **Merchant alerter emails** → CC `g@offsetworks.xyz`
- **Health alerter** (`src/services/healthAlerter.ts`) → emails on platform component state changes
- **No on-call rotation** — solo operator
