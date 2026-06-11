# Key rotation runbook — 2026-06-11

**Why:** during the repo audit, a sub-process quoted live `.env` values into a chat transcript:
Railway DB password, AGENT_WALLET_KEY (EVM), AGENT_SOLANA_KEY, ANTHROPIC_API_KEY. `.env` is NOT
in git (verified) — this is transcript exposure only, but rotate anyway.

Order matters. Do these top-to-bottom.

## 1. ANTHROPIC_API_KEY — easy, do first
1. console.anthropic.com → API keys → create new, revoke old.
2. `printf 'sk-ant-…'` into: Vercel env (`vercel env rm/add ANTHROPIC_API_KEY production`) and
   Railway scanner variables. **Never `echo`** (trailing newline).
3. Redeploy both. Verify: send a Stablo message on the live page, expect a reply.

## 2. Railway DB password
1. Railway → Postgres service → reset credentials (or create new user+password).
2. Update `DATABASE_URL` (and `DIRECT_URL` if set) in: Vercel env, Railway scanner env, local `.env`.
3. Redeploy. Verify: `curl https://wetakestables.shop/api/health/platform` → database ok;
   scanner heartbeat fresh.

## 3. Agent wallets (EVM + Solana) — the careful one
These are GAS wallets (fallback funding), not custody of merchant funds.
1. Generate fresh keypairs locally (`scripts/generate-secrets.js` or ethers/solana-keygen).
2. Sweep balances old → new (they hold small gas amounts; check first:
   `npx tsx scripts/check-platform-wallets.ts`).
3. Update AGENT_WALLET_KEY / AGENT_WALLET_ADDRESS / AGENT_SOLANA_KEY / AGENT_SOLANA_ADDRESS in
   Vercel + Railway + local `.env`.
4. ⚠️ **TRAP:** `ENC_KEY = MANAGED_WALLET_ENCRYPTION_KEY || JWT_SECRET || AGENT_WALLET_KEY`.
   If `MANAGED_WALLET_ENCRYPTION_KEY` and `JWT_SECRET` are BOTH unset anywhere, wallet
   encryption silently keys off AGENT_WALLET_KEY — rotating it would brick decryption of
   every managed/receive wallet. **Before rotating, confirm on BOTH tiers:**
   `MANAGED_WALLET_ENCRYPTION_KEY` is set (or at minimum JWT_SECRET is set and identical).
   If not: set MANAGED_WALLET_ENCRYPTION_KEY to the CURRENT effective key value first —
   that pins encryption independent of the rotation.
5. Verify: create a native test order (smoke does this) — receive wallet generates; health
   `agentGas` only ever WARNs (informational).

## 4. JWT_SECRET / ADMIN_KEY — precautionary
- Same ENC_KEY trap as above: pin `MANAGED_WALLET_ENCRYPTION_KEY` BEFORE touching JWT_SECRET.
- Rotating JWT_SECRET invalidates merchant login sessions (they re-login — fine).
- Rotating ADMIN_KEY: update your own tooling + the scanner env (fee-check driver sends it).

## Post-rotation
`npx ts-node scripts/prod-smoke.ts` → 33/33. Delete this file's checklist marks when done.
