# Engineering Learnings

Running log of non-obvious things we've learned the hard way. When you hit an incident, write it up here.

---

## 2026-04-17 — One Tease webhook onboarding gap

### What broke

One Tease Tech integrated as a merchant, started accepting payments successfully, but never received a single webhook. When they built their endpoint based on our docs, they:
- Had no webhook secret (`webhookSecret` was `null` in DB the whole time)
- Had no signature verification code sample
- Didn't know the `X-StablePay-Signature` header even existed
- Returned a 404 from their endpoint for days before telling us, because their dashboard didn't flag "0 confirmed orders" as anomalous

At the time we investigated, 59 webhooks were stuck in our retry queue for them, plus a deeper bug: **the retry loop itself wasn't running** (node-cron in Vercel serverless never fires), so no webhook on the platform was actually being retried after initial failure. 226 stuck deliveries total.

### Root causes

1. **Docs were incomplete.** `public/docs/API.md` referenced `/api/v1/*` endpoints that were deprecated months ago, marked chains as "coming soon" that were live, and had zero webhook-signing guidance. Merchants integrating from the docs would hit 404s on every example.

2. **Onboarding didn't auto-generate a webhook secret.** A merchant could save a `webhookUrl`, enable webhooks, start receiving payments, and their `webhookSecret` stays `null`. We sent unsigned webhooks that no reasonable backend should trust, and the merchant had no secret to verify with even if they wanted to.

3. **Retry cron was silently broken.** `cron.schedule(...)` was registered in `src/index.ts` which runs on Vercel serverless — functions die between requests, so node-cron schedules set up but never fire. Scanner on Railway (long-running) didn't have the retry driver. Every initial webhook failure went to `attempts=2` via the in-process retry and stopped forever.

4. **No monitoring on delivery success rate.** A merchant at `0% webhook success` should page someone. We found out because the merchant emailed us.

### Fixes shipped to prod

- `docs: rewrite API reference...` (commit `2d017e7`) — full API.md rewrite with webhook section, signature verification in Node and Python, chain/token table, idempotency docs.
- `scanner: drive webhook retries from Railway worker` (commit `72fab50`) — moved the retry loop to `src/scanner.ts`, which actually runs continuously.
- Connected the `mellow-surprise` Railway service to the GitHub repo so pushes auto-deploy (was previously deployed via CLI one-offs).

### Fix staged in working tree, shipping with audit batch

- Auto-generate webhook secret on first `updateConfig` call that sets a `webhookUrl` (in `src/services/webhookService.ts`). The secret is returned in the response exactly once. Not pushed yet because webhookService.ts also contains the new signing scheme from the audit (`hmac(${timestamp}.${body})`) — shipping that mid-integration would break One Tease. Bundled for the coordinated audit deploy.

### Guardrails to add (not yet done — track in issues/next session)

- **Dashboard alert when webhooks fail 5+ times in a row for any merchant.** Page us or at least email the merchant.
- **Don't allow enabling webhooks without a secret.** Refuse `webhookEnabled: true` at the API layer unless a secret exists.
- **Onboarding step: "Test your webhook"** button in the merchant dashboard that sends a synthetic `webhook.test` event and shows what our signed request looks like (headers + body) so merchants can verify their endpoint works before going live.
- **Prisma migration for audit/idempotency tables** still pending. Deploy the full audit PR once migration is run.
- **Move the retry loop OR keep the scanner + web on the same infra** — currently we have a split-brain where webhook signing scheme changes depend on both tiers being updated together. Consider a dedicated "background worker" Railway service that owns ALL crons.

### Generic lessons

1. **If a cron depends on a long-running process, don't put it in a serverless file.** Always ask: "Is this host a stateful worker or a request-response function?" before `cron.schedule`, `setInterval`, or anything with a timer.

2. **Docs are part of the product.** Every merchant integration touches them. Stale "coming soon" labels or missing signature code = support tickets and broken integrations. When a feature ships, the same PR updates the docs.

3. **Auth secrets should be generated the moment a resource exists that needs them, not on-demand.** If webhooks are enabled, a secret MUST exist. Defaults that null out auth material are footguns.

4. **Monitor integration health per-merchant, not just aggregate.** A platform-wide 99% webhook delivery rate still means one merchant is at 0%. Always break down by customer.

5. **When a client reports "it's not working," check our own logs BEFORE defending the system.** In this case, we had 59 stuck webhooks logged; we just weren't looking at them. `webhookLog` table + a SELECT query is faster than a back-and-forth.
