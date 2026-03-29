import { db } from '../config/database';
import { logger } from '../utils/logger';

// ─── Sanctioned / known-bad addresses ────────────────────────────────────────
// Tornado Cash sanctioned addresses (OFAC, August 2022)
const SANCTIONED_ADDRESSES = new Set([
  '0x8589427373d6d84e98730d7795d8f6f8731fda16',
  '0x722122df12d4e14e13ac3b6895a86e84145b6967',
  '0xdd4c48c0b24039969fc16d1cdf626eab821d3384',
  '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b',
  '0xd96f2b1c14db8458374d9aca76e26c3d18364307',
  '0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfbfa9',
  '0xd4b88df4d29f5cedd6857912842cff3b20c8cfa3',
  '0x910cbd523d972eb0a6f4cae4618ad62622b39dbf',
  '0xa160cdab225685da1d56aa342ad8841c3b53f291',
  '0xfd8610d20aa15b7b2e3be39b396a1bc3516c7144',
  '0xf60dd140cff0706bae9cd734ac3683f29023ecd2',
  '0x22aaa7720ddd5388a3c0a3333430953c68f1849b',
  '0xba214c1c1928a32bffe790263e38b4af9bfcd659',
  '0xb1c8094b234dce6e03f10a5b673c1d8c69739a00',
  '0x527653ea119f3e6a1f5bd18fbf4714081d7b31ce',
  '0x58e8dcc13be9780fc42e8723d8ead4cf46943df2',
  '0xd691f27f38b395864ea86cfc7253969b409c362d',
  '0xaeaac358560e11f52454d997aaff2c5731b6f8a6',
  '0x1356c899d8c9467c7f71c195612f8a395abf2f0a',
  '0xa7e5d5a720f06526557c513402f2e6b5fa20b008',
  '0x03893a7c7463ae47d46bc7f091665f1893656003',
  '0x2717c5e28cf931733106c913e4f11ffcc56b465a',
  '0x178169b423a011fff22b9e3f3abea13414ddd0f1',
  '0x610b717796ad172b316836ac95a2ffad065ceab4',
  '0xdf231d99ff8b6c6d7bea1f81d76ac27c7c89f2a3',
].map(a => a.toLowerCase()));

// Known mixer / privacy protocol contracts
const KNOWN_MIXERS = new Set([
  '0xd90e2f925da726b50c4ed8d0fb90ad053324f31b', // Tornado Cash Router
  '0x905b63fff5e043076cdef9e736c0038dd5c3154a', // Tornado Cash Relayer
].map(a => a.toLowerCase()));

// Known major hack/exploit addresses (add as they're identified)
const KNOWN_EXPLOITS = new Set<string>([
  // Add known exploit addresses here as they emerge
]);

// ─── Risk scoring ────────────────────────────────────────────────────────────
export interface ScreeningResult {
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
  flags: string[];
  details: Record<string, any>;
}

class ComplianceService {
  /**
   * Screen a wallet address for risk
   */
  async screenWallet(address: string, chain: string): Promise<ScreeningResult> {
    const addr = address.toLowerCase();
    const flags: string[] = [];
    let riskScore = 0;
    const details: Record<string, any> = { address: addr, chain, screenedAt: new Date().toISOString() };

    // 1. Sanctions check (OFAC)
    if (SANCTIONED_ADDRESSES.has(addr)) {
      flags.push('OFAC_SANCTIONED');
      riskScore = 100;
      details.sanctionMatch = true;
    }

    // 2. Known mixer check
    if (KNOWN_MIXERS.has(addr)) {
      flags.push('KNOWN_MIXER');
      riskScore = Math.max(riskScore, 90);
      details.mixerMatch = true;
    }

    // 3. Known exploit check
    if (KNOWN_EXPLOITS.has(addr)) {
      flags.push('KNOWN_EXPLOIT');
      riskScore = Math.max(riskScore, 85);
      details.exploitMatch = true;
    }

    // 4. Contract address check (Solana addresses skip this)
    if (chain !== 'SOLANA_MAINNET' && chain !== 'SOLANA_DEVNET') {
      // Simple heuristic: if address is in our sanctioned list neighborhood
      // In production, you'd query etherscan/basescan API to check if it's a contract
    }

    // Determine risk level
    let riskLevel: ScreeningResult['riskLevel'];
    if (riskScore >= 81) riskLevel = 'BLOCKED';
    else if (riskScore >= 61) riskLevel = 'HIGH';
    else if (riskScore >= 31) riskLevel = 'MEDIUM';
    else riskLevel = 'LOW';

    // Store the screening
    await db.walletScreen.create({
      data: { address: addr, chain, riskScore, riskLevel, flags, details },
    });

    return { riskScore, riskLevel, flags, details };
  }

  /**
   * Screen a transaction / order
   */
  async screenTransaction(orderId: string, fromAddress: string): Promise<ScreeningResult> {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { merchant: true },
    });

    if (!order) {
      return { riskScore: 0, riskLevel: 'LOW', flags: [], details: { error: 'Order not found' } };
    }

    // Screen the sender wallet
    const walletResult = await this.screenWallet(fromAddress, order.chain);
    const flags = [...walletResult.flags];
    let riskScore = walletResult.riskScore;

    // Transaction-level checks
    const amount = Number(order.amount);

    // Large transaction flag
    if (amount > 10000) {
      flags.push('LARGE_TRANSACTION');
      riskScore = Math.max(riskScore, 40);
    }

    // Suspicious round amount (common in laundering)
    if (amount >= 1000 && amount % 1000 === 0) {
      flags.push('ROUND_AMOUNT');
      riskScore = Math.max(riskScore, 20);
    }

    // Burst detection: >10 payments to same merchant in 1 hour
    if (order.merchantId) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentCount = await db.order.count({
        where: {
          merchantId: order.merchantId,
          createdAt: { gte: oneHourAgo },
        },
      });
      if (recentCount > 10) {
        flags.push('BURST_DETECTED');
        riskScore = Math.max(riskScore, 50);
      }
    }

    // Same sender repeat: >3 payments from same wallet to same merchant in 1 day
    if (order.merchantId && fromAddress) {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const repeatCount = await db.order.count({
        where: {
          merchantId: order.merchantId,
          customerWallet: fromAddress.toLowerCase(),
          createdAt: { gte: oneDayAgo },
        },
      });
      if (repeatCount > 3) {
        flags.push('REPEAT_SENDER');
        riskScore = Math.max(riskScore, 45);
      }
    }

    // Determine risk level
    let riskLevel: ScreeningResult['riskLevel'];
    if (riskScore >= 81) riskLevel = 'BLOCKED';
    else if (riskScore >= 61) riskLevel = 'HIGH';
    else if (riskScore >= 31) riskLevel = 'MEDIUM';
    else riskLevel = 'LOW';

    // Update order with risk info
    await db.order.update({
      where: { id: orderId },
      data: { riskScore, riskFlags: flags },
    });

    // Store screening linked to order
    await db.walletScreen.create({
      data: {
        address: fromAddress.toLowerCase(),
        chain: order.chain,
        riskScore,
        riskLevel,
        flags,
        details: { orderId, amount, transactionFlags: flags },
        orderId,
      },
    });

    // Audit log
    await this.log(order.merchantId || undefined, 'WALLET_SCREENED', {
      orderId,
      fromAddress,
      riskScore,
      riskLevel,
      flags,
    });

    if (riskLevel === 'BLOCKED') {
      await this.log(order.merchantId || undefined, 'PAYMENT_BLOCKED', {
        orderId,
        fromAddress,
        reason: flags.join(', '),
      });
    } else if (riskLevel === 'HIGH') {
      await this.log(order.merchantId || undefined, 'PAYMENT_FLAGGED', {
        orderId,
        fromAddress,
        riskScore,
        flags,
      });
    }

    return { riskScore, riskLevel, flags, details: { orderId, fromAddress, amount } };
  }

  /**
   * Get compliance overview for a merchant
   */
  async getMerchantCompliance(merchantId: string) {
    const [totalScreened, flagged, blocked, recentScreenings] = await Promise.all([
      db.walletScreen.count({
        where: { orderId: { not: null } },
      }),
      db.order.count({
        where: { merchantId, riskScore: { gte: 31 } },
      }),
      db.order.count({
        where: { merchantId, riskScore: { gte: 81 } },
      }),
      db.walletScreen.findMany({
        where: { orderId: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const merchant = await db.merchant.findUnique({
      where: { id: merchantId },
      select: { kycStatus: true, country: true, businessType: true },
    });

    return {
      kycStatus: merchant?.kycStatus || 'PENDING',
      country: merchant?.country,
      businessType: merchant?.businessType,
      totalScreened,
      flagged,
      blocked,
      recentScreenings,
    };
  }

  /**
   * Get screening history for export
   */
  async getScreenings(merchantId: string, limit = 100) {
    return db.walletScreen.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        address: true,
        chain: true,
        riskScore: true,
        riskLevel: true,
        flags: true,
        orderId: true,
        createdAt: true,
      },
    });
  }

  /**
   * Log an audit event
   */
  async log(merchantId: string | undefined, action: string, details: Record<string, any>, ip?: string) {
    await db.auditLog.create({
      data: {
        merchantId: merchantId || null,
        action,
        details,
        ip: ip || null,
      },
    });
  }
}

export const complianceService = new ComplianceService();
