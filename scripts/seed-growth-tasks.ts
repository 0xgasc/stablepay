/**
 * Seed initial growth plan tasks. Idempotent — won't duplicate.
 */
import { db } from '../src/config/database';

const TASKS: { title: string; description?: string; category: string; week: number; priority: number }[] = [
  // ===== Week 1 — Set up shop =====
  { title: 'Ship /vs/stripe comparison page', description: 'SEO bait targeting "stripe alternative" queries. Real numbers, calculator showing savings.', category: 'setup', week: 1, priority: 1 },
  { title: 'Ship /vs/coinbase-commerce comparison page', description: 'Similar SEO play targeting Coinbase Commerce searchers.', category: 'setup', week: 1, priority: 1 },
  { title: 'Public stats counter on landing page', description: 'Show real merchant + payment counts. Already have /api/embed/stats — needs prominent placement.', category: 'setup', week: 1, priority: 2 },
  { title: 'List on ProductHunt', description: 'Schedule a Tuesday launch for max visibility. Prep assets (gif, screenshots, tagline).', category: 'setup', week: 1, priority: 2 },
  { title: 'List on alternatives.to', description: 'Add as Stripe / Coinbase Commerce alternative. Free, takes 10 min.', category: 'setup', week: 1, priority: 3 },
  { title: 'List on G2 + Capterra', description: 'B2B SaaS directories. Helps procurement-driven sales.', category: 'setup', week: 1, priority: 4 },
  { title: 'List on Indie Hackers showcase', description: 'Tag with crypto + payment processor. Community-driven discovery.', category: 'setup', week: 1, priority: 3 },
  { title: 'List on CryptoSlate / CoinGecko directory', description: 'Web3-native discovery surfaces.', category: 'setup', week: 1, priority: 3 },
  { title: 'Create + brand Twitter/X account', description: 'Handle: @wetakestables or @stablepay_io if available. Avatar, banner, pinned tweet with demo.', category: 'setup', week: 1, priority: 2 },
  { title: 'Post FB slides to Twitter', description: 'Repurpose the carousel + Spanish caption already built. Add English variant.', category: 'setup', week: 1, priority: 2 },

  // ===== Week 2 — Direct outreach =====
  { title: 'Daily Twitter search: "Stripe banned" / "Stripe froze"', description: 'DM 5 accounts per day with a 2-sentence pitch. Expect 1-2% conversion.', category: 'outreach', week: 2, priority: 1 },
  { title: 'Post in r/argentina', description: 'Mention Stripe pull-out, frame as "cobrar en dólares desde Argentina". Don\'t be spammy — be helpful in the comments first.', category: 'outreach', week: 2, priority: 1 },
  { title: 'Post in r/Guatemala / r/Mexico', description: 'Same playbook, local framing about POS fees being 4.5%+.', category: 'outreach', week: 2, priority: 2 },
  { title: 'Post in IndieHackers / Hacker News', description: 'Hacker News loves stripe alternatives. Show HN with a real demo + numbers.', category: 'outreach', week: 2, priority: 2 },
  { title: 'Reach out to 10 LatAm crypto Twitter accounts', description: 'Pick people with 1k–50k followers building in crypto. Pitch a partnership or just ask for feedback.', category: 'outreach', week: 2, priority: 3 },

  // ===== Week 3-4 — Content =====
  { title: 'Write: "How to accept crypto payments without KYC in 2026"', description: 'Long-tail SEO. 1500-2000 words. Real comparison + StablePay setup walkthrough.', category: 'content', week: 3, priority: 2 },
  { title: 'Write: "Stripe Alternatives for High-Risk Businesses"', description: 'Targeted at adult-adjacent, gambling, crypto-native verticals. List 5 alternatives including us.', category: 'content', week: 3, priority: 2 },
  { title: 'Write (Spanish): "Cómo cobrar en dólares desde Argentina sin Stripe"', description: 'Spanish-language SEO is way less competitive. Stripe pulled out of Argentina, huge opening.', category: 'content', week: 3, priority: 1 },
  { title: 'Write: case study with One Tease or UnlockRiver', description: 'After getting their permission. "How [merchant] saved 60% on payment fees switching to USDC."', category: 'content', week: 3, priority: 3 },

  // ===== Partner =====
  { title: 'Outreach: Tienda Nube (LatAm Shopify)', description: 'Pitch as a payment app on their marketplace. Their merchants pay 3-5% on cards.', category: 'partner', week: 4, priority: 2 },
  { title: 'Outreach: Empretienda', description: 'Argentina ecommerce platform, big crypto-curious user base.', category: 'partner', week: 4, priority: 2 },
  { title: 'Design affiliate / referral program', description: '10% of first-year fees for devs/agencies who refer merchants. Use Stablo to onboard.', category: 'partner', week: 4, priority: 3 },
  { title: 'Find LatAm crypto influencer for paid integration review', description: 'Budget ~$500. Target 10k+ follower bilingual influencer in finance/crypto.', category: 'partner', week: 4, priority: 4 },
];

(async () => {
  let inserted = 0, skipped = 0;
  for (const t of TASKS) {
    const existing = await db.growthTask.findFirst({ where: { title: t.title } });
    if (existing) { skipped++; continue; }
    await db.growthTask.create({ data: t });
    inserted++;
  }
  console.log(`Growth tasks seeded: ${inserted} new, ${skipped} already existed`);
  await db.$disconnect();
})();
