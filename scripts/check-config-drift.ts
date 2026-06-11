/**
 * Config-drift tripwire (CI + pre-push). The token/mint config lives in FOUR places that must
 * stay in sync (see CLAUDE.md): scanner (CHAIN_STABLES / SOLANA_TOKEN_MINTS), swap targets,
 * widget offers, page offers. This script verifies every scanner-known contract address and
 * Solana mint appears in BOTH checkout surfaces — the failure mode it kills is "added/changed
 * a token in the scanner, forgot one of the frontends, customer pays to a token we don't show
 * or shows a token we don't scan."
 *
 * Exit 0 = in sync. Exit 1 = drift (lists every missing pair).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { CHAIN_STABLES, SOLANA_TOKEN_MINTS, TRON_TOKEN_CONTRACTS } from '../src/services/blockchainService';

const root = join(__dirname, '..');
const widget = readFileSync(join(root, 'public/checkout-widget.js'), 'utf8');
const page = readFileSync(join(root, 'public/crypto-pay.html'), 'utf8');

const problems: string[] = [];

function mustAppear(label: string, needle: string) {
  const needleLower = needle.toLowerCase();
  if (!widget.toLowerCase().includes(needleLower)) problems.push(`${label} missing from checkout-widget.js: ${needle}`);
  if (!page.toLowerCase().includes(needleLower)) problems.push(`${label} missing from crypto-pay.html: ${needle}`);
}

for (const [chain, tokens] of Object.entries(CHAIN_STABLES)) {
  for (const [token, addr] of Object.entries(tokens)) {
    if (addr) mustAppear(`${chain} ${token}`, addr);
  }
}
for (const [token, mint] of Object.entries(SOLANA_TOKEN_MINTS)) {
  mustAppear(`SOLANA ${token}`, mint);
}
for (const [token, contract] of Object.entries(TRON_TOKEN_CONTRACTS)) {
  mustAppear(`TRON ${token}`, contract);
}

if (problems.length) {
  console.error(`✗ CONFIG DRIFT — ${problems.length} mismatch(es):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('✓ Token/mint config in sync across scanner + widget + hosted page');
