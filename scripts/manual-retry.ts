// Manually invoke processRetries — rules out whether the code path itself works.
import { webhookService } from '../src/services/webhookService';
import { db } from '../src/config/database';

async function main() {
  console.log('Running processRetries()...');
  const n = await webhookService.processRetries();
  console.log(`processed ${n} deliveries`);
  await db.$disconnect();
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
