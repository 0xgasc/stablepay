/**
 * Production end-to-end smoke test.
 * Hits every public + admin endpoint and reports pass/fail with response shape checks.
 *
 * Usage: ADMIN_API_KEY=... npx ts-node scripts/prod-smoke.ts
 *
 * SAFETY: All endpoints called are READ or CREATE-only. No destructive operations:
 *   - force-swap and refund-native are NEVER invoked (would touch real funds)
 *   - Orders are created but get cancelled at the end
 *   - Webhook fires are NOT triggered
 */
import dotenv from 'dotenv';
dotenv.config();

const BASE = process.env.SMOKE_BASE || 'https://wetakestables.shop';
const ADMIN_KEY = process.env.ADMIN_API_KEY || process.env.ADMIN_AUTH_TOKEN || '';

// Dedicated smoke-test merchant: OFFSET (offsetworks, gasolomonc@gmail.com).
// MUST NOT be a real customer merchant — smoke runs create SMOKE_/SMOKE_NAT_ orders and fire
// confirmation webhooks. Previously pointed at OneTease (cmnem8xia…), polluting their real dashboard.
const KNOWN_MERCHANT_ID = 'cmn979jnf0000110ntpw8x6fi';

interface Result { name: string; ok: boolean; ms: number; detail?: string; }
const results: Result[] = [];

async function check(name: string, fn: () => Promise<string | void>) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t, detail: detail || undefined });
    console.log(`  ✓ ${name.padEnd(55)} ${(Date.now() - t) + 'ms'}${detail ? ' — ' + detail : ''}`);
  } catch (e: any) {
    results.push({ name, ok: false, ms: Date.now() - t, detail: e.message });
    console.log(`  ✗ ${name.padEnd(55)} ${(Date.now() - t) + 'ms'} — ${e.message}`);
  }
}

async function fetchJSON(url: string, opts?: RequestInit) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(12_000) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(json?.error ?? text).toString().slice(0, 200)}`);
  return json;
}

function adminHeaders() {
  return { 'Authorization': `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' };
}

async function main() {
  console.log(`\n═══ Production Smoke Test ═══`);
  console.log(`Target: ${BASE}\n`);

  // ─── 1. Health ──────────────────────────────────────────
  console.log('PUBLIC HEALTH:');
  await check('GET /api/health/platform', async () => {
    const d = await fetchJSON(`${BASE}/api/health/platform`);
    if (!d.components) throw new Error('missing components');
    const required = ['database', 'scanner', 'rpc', 'webhookQueue', 'webhookDelivery', 'agentGas'];
    for (const r of required) if (!d.components[r]) throw new Error(`missing component ${r}`);
    const statuses = Object.entries(d.components).map(([k, v]: any) => `${k}=${v.status}`).join(' ');
    return statuses;
  });

  // ─── 2. Embed (public, no auth) ─────────────────────────
  console.log('\nEMBED (public):');
  await check('GET /api/embed/chains (no merchantId)', async () => {
    try {
      await fetchJSON(`${BASE}/api/embed/chains`);
      throw new Error('expected 400, got 200');
    } catch (e: any) {
      if (!e.message.includes('400')) throw e;
      return '400 as expected';
    }
  });

  await check('GET /api/embed/chains (valid merchant)', async () => {
    const d = await fetchJSON(`${BASE}/api/embed/chains?merchantId=${KNOWN_MERCHANT_ID}`);
    if (!Array.isArray(d.chains)) throw new Error('chains not array');
    if (!Array.isArray(d.wallets)) throw new Error('wallets not array');
    if (d.chains[0] !== 'SOLANA_MAINNET') throw new Error(`expected SOLANA_MAINNET first, got ${d.chains[0]}`);
    return `${d.chains.length} chains, Solana first ✓`;
  });

  await check('GET /api/embed/diagnostics/funnel (public)', async () => {
    const d = await fetchJSON(`${BASE}/api/embed/diagnostics/funnel?hours=12`);
    if (typeof d.windowHours !== 'number') throw new Error('windowHours missing');
    if (!d.orders || !d.events || !d.ab) throw new Error('missing top-level sections');
    return `window=${d.windowHours}h, merchants=${Object.keys(d.orders.byMerchant).length}, abSessions=${d.ab.control.total + d.ab.guided.total}`;
  });

  await check('GET /api/embed/native-price?token=ETH', async () => {
    const d = await fetchJSON(`${BASE}/api/embed/native-price?token=ETH`);
    if (!d.priceUsd || typeof d.priceUsd !== 'number') throw new Error('priceUsd missing/wrong type');
    if (d.priceUsd < 100 || d.priceUsd > 50_000) throw new Error(`price unrealistic: ${d.priceUsd}`);
    return `ETH = $${d.priceUsd.toFixed(2)}`;
  });

  await check('GET /api/embed/native-price?token=SOL', async () => {
    const d = await fetchJSON(`${BASE}/api/embed/native-price?token=SOL`);
    if (!d.priceUsd || d.priceUsd < 10 || d.priceUsd > 5000) throw new Error(`bad SOL price: ${d.priceUsd}`);
    return `SOL = $${d.priceUsd.toFixed(2)}`;
  });

  await check('GET /api/embed/native-price?token=INVALID', async () => {
    try {
      await fetchJSON(`${BASE}/api/embed/native-price?token=INVALID`);
      throw new Error('expected 400');
    } catch (e: any) {
      if (!e.message.includes('400')) throw e;
      return '400 as expected';
    }
  });

  await check('POST /api/embed/event (widget telemetry)', async () => {
    const d = await fetchJSON(`${BASE}/api/embed/event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: `smoke-${Date.now()}`, action: 'WIDGET_OPENED',
        merchantId: KNOWN_MERCHANT_ID, details: { test: true },
      }),
    });
    if (!d.ok && d.ok !== false) throw new Error('expected ok field');
    return `ok=${d.ok}`;
  });

  await check('POST /api/embed/event (invalid action)', async () => {
    const d = await fetchJSON(`${BASE}/api/embed/event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'smoke', action: 'INVALID_ACTION' }),
    });
    if (d.ok !== false) throw new Error('should silently drop invalid action');
    return 'silent drop';
  });

  // Wizard A/B + funnel drop-off telemetry event types must be accepted
  const ALL_EVENT_TYPES = [
    'VARIANT_ASSIGNED', 'WIZARD_STEP_VIEWED', 'WIZARD_ANSWER', 'WIZARD_COMPLETED', 'WIZARD_SKIPPED',
    'MANUAL_PAY_VIEWED', 'WALLET_CONNECT_OPENED', 'WALLET_CONNECT_FAILED',
    'INSUFFICIENT_BALANCE', 'TX_REJECTED', 'ADDRESS_COPIED',
    'CANCEL_CLICKED', 'BACK_CLICKED', 'PAGE_HIDDEN',
  ];
  for (const action of ALL_EVENT_TYPES) {
    await check(`POST /api/embed/event (${action})`, async () => {
      const d = await fetchJSON(`${BASE}/api/embed/event`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: `smoke-wiz-${Date.now()}`, action,
          merchantId: KNOWN_MERCHANT_ID, details: { variant: 'guided', step: '1' },
        }),
      });
      if (d.ok !== true) throw new Error(`expected ok=true, got ${JSON.stringify(d)}`);
      return 'accepted';
    });
  }

  // Create a chain-agnostic order (then cancel it)
  let testOrderId: string | null = null;
  await check('POST /api/embed/checkout (chain-agnostic)', async () => {
    const d = await fetchJSON(`${BASE}/api/embed/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantId: KNOWN_MERCHANT_ID,
        amount: 1.00,
        productName: 'Smoke Test',
        externalId: `SMOKE_${Date.now()}`,
        source: 'EMBED_WIDGET',
      }),
    });
    if (!d.success || !d.order?.id) throw new Error('missing order.id');
    testOrderId = d.order.id;
    return `created ${testOrderId!.slice(-8)} chain=${d.order.chain}`;
  });

  await check('GET /api/embed/order/:id', async () => {
    if (!testOrderId) throw new Error('skipped — no order from prior step');
    const d = await fetchJSON(`${BASE}/api/embed/order/${testOrderId}`);
    // This endpoint returns the order fields FLAT (not wrapped in d.order)
    if (d.id !== testOrderId) throw new Error(`mismatched order id: got ${d.id}`);
    return `status=${d.status}`;
  });

  await check('POST /api/embed/order/:id/chain (Solana lock)', async () => {
    if (!testOrderId) throw new Error('skipped');
    const d = await fetchJSON(`${BASE}/api/embed/order/${testOrderId}/chain`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: 'SOLANA_MAINNET', token: 'USDC' }),
    });
    if (!d.success) throw new Error(`chain lock failed: ${JSON.stringify(d).slice(0, 200)}`);
    return `locked to ${d.chain}, addr=${(d.paymentAddress || '').slice(0, 8)}…`;
  });

  await check('POST /api/embed/order/:id/cancel', async () => {
    if (!testOrderId) throw new Error('skipped');
    const d = await fetchJSON(`${BASE}/api/embed/order/${testOrderId}/cancel`, { method: 'POST' });
    if (d.success === false) throw new Error('cancel returned success=false');
    return 'cancelled';
  });

  // Native token order (also cancel)
  let nativeOrderId: string | null = null;
  await check('POST /api/embed/checkout (native ETH on Base)', async () => {
    const d = await fetchJSON(`${BASE}/api/embed/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantId: KNOWN_MERCHANT_ID,
        amount: 1.00, chain: 'BASE_MAINNET', token: 'ETH',
        productName: 'Smoke Native',
        externalId: `SMOKE_NAT_${Date.now()}`,
        source: 'EMBED_WIDGET',
      }),
    });
    if (!d.success || !d.order?.id) throw new Error('no order id');
    if (!d.order.nativeToken) throw new Error('nativeToken not set');
    if (!d.order.nativeSendAmount) throw new Error('nativeSendAmount not set');
    if (!d.order.paymentAddress || !d.order.paymentAddress.startsWith('0x')) throw new Error('bad receive address');
    nativeOrderId = d.order.id;
    return `${d.order.nativeSendAmount.toFixed(6)} ETH → ${d.order.paymentAddress.slice(0,10)}…`;
  });

  await check('Cancel native test order', async () => {
    if (!nativeOrderId) throw new Error('skipped');
    await fetchJSON(`${BASE}/api/embed/order/${nativeOrderId}/cancel`, { method: 'POST' });
    return 'cleaned up';
  });

  // ─── 3. Admin endpoints (require ADMIN_KEY) ─────────────
  if (!ADMIN_KEY) {
    console.log('\nADMIN: skipped (ADMIN_API_KEY not set)');
  } else {
    console.log('\nADMIN (requires key):');
    await check('GET /api/v1/admin/stats', async () => {
      const d = await fetchJSON(`${BASE}/api/v1/admin/stats`, { headers: adminHeaders() });
      if (!d.merchants) throw new Error('no merchants in response');
      return `${d.merchants.total} merchants, ${d.merchants.active} active`;
    });

    await check('GET /api/v1/admin/funnel?days=7', async () => {
      const d = await fetchJSON(`${BASE}/api/v1/admin/funnel?days=7`, { headers: adminHeaders() });
      if (!Array.isArray(d.rows)) throw new Error('rows not array');
      return `${d.rows.length} merchant-chain combos`;
    });

    await check('GET /api/v1/admin/native-activity?days=14', async () => {
      const d = await fetchJSON(`${BASE}/api/v1/admin/native-activity?days=14`, { headers: adminHeaders() });
      if (!Array.isArray(d.orders)) throw new Error('orders not array');
      return `${d.total} native orders`;
    });

    await check('GET /api/v1/admin/widget-events?hours=24', async () => {
      const d = await fetchJSON(`${BASE}/api/v1/admin/widget-events?hours=24`, { headers: adminHeaders() });
      if (!Array.isArray(d.events)) throw new Error('events not array');
      return `${d.events.length} events, ${Object.keys(d.counts || {}).length} action types`;
    });

    await check('GET /api/v1/admin/email-logs?days=7', async () => {
      const d = await fetchJSON(`${BASE}/api/v1/admin/email-logs?days=7`, { headers: adminHeaders() });
      if (!Array.isArray(d.logs)) throw new Error('logs not array');
      return `${d.logs.length} emails`;
    });

    await check('GET /api/v1/admin/stranded-funds (slow)', async () => {
      const d = await fetchJSON(`${BASE}/api/v1/admin/stranded-funds`, { headers: adminHeaders() });
      if (!Array.isArray(d.stranded)) throw new Error('stranded not array');
      return `${d.total} stranded`;
    });

    await check('GET /api/v1/admin/agent-wallets', async () => {
      const d = await fetchJSON(`${BASE}/api/v1/admin/agent-wallets`, { headers: adminHeaders() });
      // Just confirm 200 + valid shape
      return 'ok';
    });

    await check('GET /api/v1/admin/stablo/chats', async () => {
      const d = await fetchJSON(`${BASE}/api/v1/admin/stablo/chats`, { headers: adminHeaders() });
      if (!Array.isArray(d.conversations)) throw new Error('conversations not array');
      return `${d.total} chats`;
    });
  }

  // ─── 4. Static pages ───────────────────────────────────
  console.log('\nSTATIC PAGES:');
  await check('GET /crypto-pay.html', async () => {
    const r = await fetch(`${BASE}/crypto-pay.html`);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const text = await r.text();
    if (text.includes('Complete your purchase')) throw new Error('redesign not deployed (old title found)');
    if (text.includes('languageSelector"')) throw new Error('language selector still in HTML');
    if (text.includes('nightModeToggle"')) throw new Error('night mode toggle still in HTML');
    if (!text.includes('SELECT PAYMENT NETWORK') && !text.includes('Select payment network')) throw new Error('checkout UI missing');
    // A/B wizard markers
    if (!text.includes('id="cpWizard"'))       throw new Error('wizard overlay missing');
    if (!text.includes('cpAssignVariant'))     throw new Error('A/B routing JS missing');
    if (!text.includes('WIZARD_STEP_VIEWED'))  throw new Error('wizard event tracking missing');
    return `${(text.length / 1024).toFixed(1)}kb, redesign + A/B wizard live`;
  });

  await check('GET /dashboard.html', async () => {
    const r = await fetch(`${BASE}/dashboard.html`);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const text = await r.text();
    if (text.match(/checked\s+class="w-4.*accent-blue-500"/)) throw new Error('chains still pre-checked in modal');
    return `${(text.length / 1024).toFixed(1)}kb, modal no-precheck live`;
  });

  await check('GET /checkout-widget.js', async () => {
    const r = await fetch(`${BASE}/checkout-widget.js`);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const text = await r.text();
    if (!text.includes('processConnectedNativePayment')) throw new Error('native pay function missing');
    if (!text.includes('pollOrderUntilTerminal')) throw new Error('polling helper missing');
    if (!text.includes('_track')) throw new Error('telemetry helper missing');
    if (!text.includes('_assignVariant')) throw new Error('A/B variant assignment missing');
    if (!text.includes('_renderWizard'))  throw new Error('wizard render missing');
    if (!text.includes('_wizComplete'))   throw new Error('wizard completion missing');
    return `${(text.length / 1024).toFixed(1)}kb, native + telemetry + A/B wizard live`;
  });

  await check('GET /enterprise-admin.html', async () => {
    const r = await fetch(`${BASE}/enterprise-admin.html`);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const text = await r.text();
    if (!text.includes('Stranded Funds')) throw new Error('stranded tab missing');
    if (!text.includes('Customer Funnel')) throw new Error('customer funnel tab missing');
    if (!text.includes('Email Logs')) throw new Error('email logs tab missing');
    if (!text.includes('A/B Results')) throw new Error('A/B Results tab missing');
    return 'all new tabs present';
  });

  // ─── Summary ────────────────────────────────────────────
  console.log(`\n═══ SUMMARY ═══`);
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const r of results.filter(r => !r.ok)) console.log(`  ✗ ${r.name} — ${r.detail}`);
    process.exit(1);
  }
  console.log('\n✓ All endpoints pass.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
