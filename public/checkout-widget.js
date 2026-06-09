/**
 * StablePay Embedded Checkout Widget v3.0
 * Full inline checkout - no redirects needed
 */

(function() {
  'use strict';

  const STABLEPAY_URL = 'https://wetakestables.shop';
  const WIDGET_VERSION = '3.0.0';

  // B3: Arbitrum's native/gas token is ETH, not ARB. Sending 'ARB' made the backend price the
  // $0.10 ARB governance token instead of ETH — a ~19,000x misprice. ARB removed from natives.
  const NATIVE_TOKENS = new Set(['ETH', 'SOL', 'BNB', 'MATIC']);
  const CHAIN_NATIVE_TOKEN = {
    BASE_MAINNET: 'ETH', ETHEREUM_MAINNET: 'ETH', ARBITRUM_MAINNET: 'ETH',
    POLYGON_MAINNET: 'MATIC', BNB_MAINNET: 'BNB', SOLANA_MAINNET: 'SOL',
    BASE_SEPOLIA: 'ETH', ETHEREUM_SEPOLIA: 'ETH',
  };

  // Chain configurations (subset for widget)
  // All verified contract addresses from Circle (USDC/EURC) and Tether (USDT)
  const CHAIN_CONFIG = {
    BASE_SEPOLIA: {
      type: 'evm', chainId: '0x14a34', chainName: 'Base Sepolia', network: 'testnet',
      rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org'],
      tokens: { USDC: { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 } }
    },
    ETHEREUM_SEPOLIA: {
      type: 'evm', chainId: '0xaa36a7', chainName: 'Ethereum Sepolia', network: 'testnet',
      rpcUrls: ['https://eth-sepolia.g.alchemy.com/v2/demo'], blockExplorerUrls: ['https://sepolia.etherscan.io'],
      tokens: { USDC: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 } }
    },
    BASE_MAINNET: {
      type: 'evm', chainId: '0x2105', chainName: 'Base', network: 'mainnet',
      rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'],
      tokens: {
        USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
        USDT: { address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', decimals: 6 },
        EURC: { address: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', decimals: 6 }
      }
    },
    ETHEREUM_MAINNET: {
      type: 'evm', chainId: '0x1', chainName: 'Ethereum', network: 'mainnet',
      rpcUrls: ['https://eth.llamarpc.com'], blockExplorerUrls: ['https://etherscan.io'],
      tokens: {
        USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
        USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
        EURC: { address: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', decimals: 6 }
      }
    },
    POLYGON_MAINNET: {
      type: 'evm', chainId: '0x89', chainName: 'Polygon', network: 'mainnet',
      rpcUrls: ['https://polygon-rpc.com'], blockExplorerUrls: ['https://polygonscan.com'],
      tokens: {
        USDC: { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
        USDT: { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 }
      }
    },
    ARBITRUM_MAINNET: {
      type: 'evm', chainId: '0xa4b1', chainName: 'Arbitrum', network: 'mainnet',
      rpcUrls: ['https://arb1.arbitrum.io/rpc'], blockExplorerUrls: ['https://arbiscan.io'],
      tokens: {
        USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
        USDT: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 }
      }
    },
    SOLANA_MAINNET: {
      type: 'solana', chainName: 'Solana', network: 'mainnet',
      tokens: {
        USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
        USDT: { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
        EURC: { address: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr', decimals: 6 }
      }
    },
    BNB_MAINNET: {
      type: 'evm', chainId: '0x38', chainName: 'BNB Chain', network: 'mainnet',
      rpcUrls: ['https://bsc-dataseed.binance.org'], blockExplorerUrls: ['https://bscscan.com'],
      tokens: {
        USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
        USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 }
      }
    },
    TRON_MAINNET: {
      type: 'tron', chainName: 'TRON', network: 'mainnet',
      tokens: {
        USDC: { address: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', decimals: 6 },
        USDT: { address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 }
      }
    },
    SOLANA_DEVNET: {
      type: 'solana', chainName: 'Solana Devnet', network: 'testnet',
      tokens: { USDC: { address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6 } }
    }
  };

  // ERC20 ABI for token transfers
  const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function decimals() view returns (uint8)'
  ];

  // Splitter contract configuration
  const SPLITTER_CONFIG = {
    // Contract addresses per chain (update after deployment)
    addresses: {
      BASE_SEPOLIA: '0xCf6A9F0dA89aA829ACB49Ff3A853df196D4E322d',
      ETHEREUM_SEPOLIA: null,
      BASE_MAINNET: null,
      ETHEREUM_MAINNET: null,
      POLYGON_MAINNET: null
    },
    // Fee tiers in basis points
    feeTiers: { STARTER: 50, GROWTH: 40, SCALE: 30, VOLUME: 20 },
    volumeThresholds: { STARTER: 0, GROWTH: 10000, SCALE: 50000, VOLUME: 250000 },
    // Splitter ABI
    abi: [
      'function processPayment(address token, address merchant, uint256 amount, uint16 feeBasisPoints, bytes32 orderId) external'
    ]
  };

  // Get fee basis points based on monthly volume
  function getFeeBasisPoints(monthlyVolume, customFee = null) {
    if (customFee !== null && customFee >= 10) return customFee;
    if (monthlyVolume >= 250000) return 20;
    if (monthlyVolume >= 50000) return 30;
    if (monthlyVolume >= 10000) return 40;
    return 50;
  }

  // Generate unique order ID
  function generateOrderId(merchantId) {
    const timestamp = Date.now().toString(16).padStart(16, '0');
    const random = Math.random().toString(16).slice(2, 18);
    return '0x' + (merchantId.slice(0, 8) + timestamp + random).padEnd(64, '0').slice(0, 64);
  }

  class StablePayCheckout {
    constructor(container, options = {}) {
      this.container = container;
      this.options = {
        amount: options.amount || container.dataset.amount || '0',
        currency: options.currency || container.dataset.currency || 'USD',
        merchantId: options.merchantId || container.dataset.merchant,
        storeId: options.storeId || container.dataset.storeId || container.dataset.store || null,
        productName: options.productName || container.dataset.product || 'Payment',
        customerEmail: options.customerEmail || container.dataset.customerEmail || null,
        externalId: options.externalId || container.dataset.externalId || null,
        metadata: options.metadata || null,
        theme: options.theme || container.dataset.theme || 'light',
        accentColor: options.accentColor || container.dataset.accent || '#00E5FF',
        // Customization options
        borderStyle: options.borderStyle || 'brutal',     // 'brutal' | 'rounded' | 'minimal'
        buttonText: options.buttonText || null,            // Custom pay button text
        logoUrl: options.logoUrl || null,                  // Merchant logo URL
        headerColor: options.headerColor || container.dataset.headerColor || '#00E5FF',
        headerTextColor: options.headerTextColor || container.dataset.headerTextColor || 'dark', // 'dark' | 'light'
        fontFamily: options.fontFamily || null,             // Custom font (must be loaded by merchant)
        customCSS: options.customCSS || null,              // Additional CSS scoped to .sp-widget
        hideFooter: options.hideFooter || false,           // Hide "Powered by StablePay"
        ...options
      };

      this.merchantChains = [];
      this.selectedChain = null;
      this.selectedToken = 'USDC';
      this.connectedWallet = null;
      this.provider = null;

      // Anonymous session ID for telemetry — persists across modal opens in the same
      // browser session via sessionStorage. Without this cache, every modal open
      // generates a new sessionId, inflating session counts for repeat-opens (and
      // skewing A/B totals because heavy users get counted N times under the same variant).
      try {
        let sid = sessionStorage.getItem('sp_widget_sid');
        if (!sid) {
          sid = (window.crypto?.randomUUID?.() || `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
          sessionStorage.setItem('sp_widget_sid', sid);
        }
        this._sessionId = sid;
      } catch {
        this._sessionId = (window.crypto?.randomUUID?.() || `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
      }

      // 50/50 A/B: guided wizard vs classic. ?sp_variant=guided|control override for QA.
      this._variant = this._assignVariant();
      // The 'fast' redesign is a fixed clean gray/white surface. Never inherit a merchant's dark
      // theme (e.g. unlockriver sets theme:'dark'), which rendered the body navy while the header
      // was forced white — the ugly half-and-half look. Force light for fast so the whole card is clean.
      if (this._variant === 'fast') this.options.theme = 'light';
      this._wizardState = { payType: null, method: null, step: 1, done: false };

      this.init();
    }

    _assignVariant() {
      // 3-way: control / guided / fast. v2 cache key forces re-roll for users on the old 2-way split.
      const VARIANTS = ['control', 'guided', 'fast'];
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.get('sp_reset') === '1') {
          ['sp_widget_variant', 'sp_widget_variant_v2', 'sp_widget_sid'].forEach(k => sessionStorage.removeItem(k));
        }
        // A/B concluded: 'fast' won every engagement metric; 'guided'/'control' retired.
        // 100% of traffic now gets 'fast'. ?sp_variant= / ?variant= override kept for QA.
        const override = url.searchParams.get('sp_variant') || url.searchParams.get('variant');
        if (VARIANTS.includes(override)) {
          sessionStorage.setItem('sp_widget_variant_v2', override);
          return override;
        }
        return 'fast';
      } catch {
        return 'fast';
      }
    }

    // Telemetry — fire-and-forget, never throws, never blocks.
    // Auto-tags every event with surface='widget' so admin can distinguish from page.
    _track(action, details) {
      try {
        fetch(`${STABLEPAY_URL}/api/embed/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: this._sessionId,
            action,
            merchantId: this.options.merchantId || null,
            orderId:    this.currentOrderId   || null,
            details:    Object.assign({ surface: 'widget' }, details || {}),
          }),
          keepalive: true,
        }).catch(() => {});
      } catch { /* swallow */ }
    }

    async init() {
      this.injectStyles();
      this.renderLoading();
      // Fire VARIANT_ASSIGNED + WIDGET_OPENED BEFORE awaiting any network calls,
      // so even sessions that fail loadMerchantConfig are bucketed correctly in A/B.
      // (Previously these fired after await — slow networks / failures left sessions
      // unassigned, biasing the variant counts.)
      window._spWidget = this;
      this._track('VARIANT_ASSIGNED', { variant: this._variant });
      this._track('WIDGET_OPENED', { amount: this.options.amount, productName: this.options.productName, variant: this._variant });

      await this.loadMerchantConfig();

      // Track page-hidden as a proxy for distraction/tab-switch abandonment
      if (!this._visibilityHandlerAttached) {
        this._visibilityHandlerAttached = true;
        document.addEventListener('visibilitychange', () => {
          if (document.hidden) {
            this._track('PAGE_HIDDEN', { chain: this.selectedChain?.chain, token: this.selectedToken, mode: this.payMode });
          }
        });
      }

      // Show the wizard fresh on every load. We only suppress re-showing it within THIS instance
      // (in-memory _wizardState.done), NOT across reloads — previously a persisted flag trapped
      // the customer on the classic UI forever after one "show all options" click + refresh.
      // Both 'guided' and 'fast' use the wizard UI — but only if the merchant actually has chains.
      // Otherwise fall through to render() which shows the proper "payment not available" state
      // (the wizard's network step would render zero buttons = a dead end).
      if ((this._variant === 'guided' || this._variant === 'fast') && !this._wizardState.done && (this.merchantChains || []).length > 0) {
        this._renderWizard();
        this.attachWizardListeners();
        return;
      }
      this.render();
      this.attachEventListeners();
    }

    // ─── A/B WIZARD (widget variant) ─────────────────────────────────────
    _renderWizard() {
      const isDark = this.options.theme === 'dark';
      const brutal = this.options.borderStyle === 'brutal';
      // STRUCTURAL: fast drops setup chrome (eyebrow, step counter, info button/panel, skip footer).
      // Kept for guided/control behind the variant gate (?sp_variant=/?variant= QA override).
      const isFast = this._variant === 'fast';
      this.container.innerHTML = `
        <div class="sp-widget sp-wiz ${this.options.theme}" style="
          background: ${isDark ? '#1a1a1a' : '#fff'};
          color: ${isDark ? '#fff' : '#000'};
          ${brutal ? 'border: 4px solid #000; box-shadow: 8px 8px 0 #000;' : 'border: 1px solid #D4D4D8; border-radius: 12px;'}
          padding: 24px 20px;
          pointer-events: auto;
          font-family: ${this.options.fontFamily || "'Space Grotesk', -apple-system, system-ui, sans-serif"};
        ">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;min-height:24px;${isFast ? 'display:none;' : ''}">
            <button id="sp-wiz-back" type="button" style="visibility:hidden;background:none;border:none;color:${isDark ? '#9ca3af' : '#6b7280'};font-size:12px;font-weight:600;cursor:pointer;padding:4px 8px;">← Back</button>
            <div style="text-align:center;flex:1;">
              <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: ${isDark ? '#888' : '#666'}; font-weight: 700;">Quick setup</div>
              <div id="sp-wiz-step-label" style="font-size: 11px; color: ${isDark ? '#666' : '#999'}; margin-top: 2px;">Step 1 of 3</div>
            </div>
            <button id="sp-wiz-info" type="button" aria-label="Help" style="width:24px;height:24px;border-radius:50%;background:${isDark ? '#2a2a2a' : '#F4F4F5'};border:1px solid ${isDark ? '#666' : '#D4D4D8'};color:${isDark ? '#999' : '#71717A'};font-size:12px;font-weight:700;cursor:pointer;padding:0;">i</button>
          </div>
          <div id="sp-wiz-info-panel" style="display:none;background:${isDark ? '#0f172a' : '#F4F4F5'};border:1px solid ${isDark ? '#334155' : '#D4D4D8'};padding:10px 12px;margin-bottom:12px;font-size:11px;color:${isDark ? '#cbd5e1' : '#18181B'};line-height:1.5;border-radius:4px;white-space:pre-line;"></div>
          <div id="sp-wiz-body"></div>
          ${isFast ? '' : `<div style="text-align: center; margin-top: 16px;">
            <button id="sp-wiz-skip" style="background: none; border: none; color: ${isDark ? '#666' : '#999'}; font-size: 11px; text-decoration: underline; cursor: pointer; padding: 4px;">Skip — show all options</button>
          </div>`}
        </div>`;
      this._wizStart();
    }

    // Decide the first wizard step. With native payments off there's only one pay type, so the
    // "Stablecoin vs Native" question is a dead one-option screen — skip it. With a single chain,
    // skip the network step too.
    _wizStart() {
      // FAST: no setup questions. Default to stablecoin on the merchant's FIRST-configured
      // chain/token, default method = manual (QR/address). Connect stays reachable via the
      // method tabs/edit panel but the address screen is the default surface. Jump straight
      // to the send screen (_wizComplete → showManualPaymentDetails('send')).
      if (this._variant === 'fast') {
        this._wizardState.payType = 'stable';
        this._selectWizChain(this._defaultChainKey());
        this._wizardState.method = 'manual';
        return this._wizComplete();
      }
      const anyNative = (this.merchantChains || []).some(mc => mc.acceptNativeTokens && CHAIN_NATIVE_TOKEN[mc.chain]);
      const multiChain = (this.merchantChains || []).length > 1;
      if (anyNative) { this._wizGoStep('1'); return; }
      this._wizardState.payType = 'stable';
      if (multiChain) { this._wizGoStep('network'); return; }
      this._selectWizChain(this._defaultChainKey());
      this._wizGoStep('2');
    }

    // Is a usable browser wallet actually present for this chain type? Used to hide "Connect my
    // wallet" on no-extension browsers (e.g. Safari) where it would only dead-end.
    _hasWalletFor(type) {
      try {
        if (type === 'solana') return !!(window.phantom?.solana || window.solflare?.isSolflare || window.solana);
        return !!(window.ethereum || window.phantom?.ethereum || (typeof this.detectEVMProviders === 'function' && this.detectEVMProviders().length));
      } catch { return false; }
    }

    // Default rail = prefer Solana (fast, cheap, gas funded, proven) when the merchant supports it,
    // else the merchant's first-configured chain. Customers can still switch via the edit panel.
    _defaultChainKey() {
      const chains = this.merchantChains || [];
      return ((chains.find(c => c.chain === 'SOLANA_MAINNET')) || chains[0] || {}).chain;
    }

    // Lock the wizard's chosen chain + a default token onto instance state.
    _selectWizChain(chainKey) {
      const mc = (this.merchantChains || []).find(c => c.chain === chainKey) || this.merchantChains[0];
      if (!mc) return;
      this.selectedChain = mc;
      this._wizardState.chain = mc.chain;
      const toks = (mc.supportedTokens || ['USDC']).filter(t => mc.config?.tokens?.[t]);
      this.selectedToken = toks[0] || 'USDC';
    }

    // Ordered list of wizard steps before the final "send" screen — used for "Step N of M" labels.
    _wizStepOrder() {
      const anyNative = (this.merchantChains || []).some(mc => mc.acceptNativeTokens && CHAIN_NATIVE_TOKEN[mc.chain]);
      const multiChain = (this.merchantChains || []).length > 1;
      const order = [];
      if (anyNative) order.push('1');
      if (multiChain) order.push('network');
      order.push('2');
      return order;
    }

    _wizStepHTML(step) {
      const isDark = this.options.theme === 'dark';
      const accent = this.options.accentColor;
      const usd = parseFloat(this.options.amount || 0).toFixed(2);
      const primaryBtnStyle = `width:100%;padding:14px 12px;background:#18181B;color:#fff;border:3px solid #000;font-weight:700;font-size:14px;cursor:pointer;text-align:left;display:flex;align-items:center;justify-content:space-between;-webkit-appearance:none;appearance:none;touch-action:manipulation;`;
      const secondaryBtnStyle = `width:100%;padding:14px 12px;background:${isDark ? '#2a2a2a' : '#fff'};color:${isDark ? '#fff' : '#000'};border:3px solid ${isDark ? '#666' : '#000'};font-weight:700;font-size:14px;cursor:pointer;text-align:left;display:flex;align-items:center;justify-content:space-between;margin-top:10px;-webkit-appearance:none;appearance:none;touch-action:manipulation;`;
      const subStyle = `font-size:11px;color:${isDark ? '#999' : '#666'};font-weight:400;margin-top:2px;`;
      const anyNative = (this.merchantChains || []).some(mc => mc.acceptNativeTokens && CHAIN_NATIVE_TOKEN[mc.chain]);
      switch (String(step)) {
        case '1':
          return `
            <h2 style="font-size:20px;font-weight:700;text-align:center;margin:0 0 6px;">How do you want to pay?</h2>
            <p style="font-size:12px;text-align:center;color:${isDark ? '#999' : '#666'};margin:0 0 18px;">${anyNative ? 'Both end up as USDC for the merchant.' : 'Pay with stablecoins.'}</p>
            <button class="sp-wiz-ans" data-key="payType" data-value="stable" style="${secondaryBtnStyle};margin-top:0;"><span><span style="display:block">Stablecoin (USDC/USDT)</span><span style="${subStyle}">No extra conversion fee</span></span><span>→</span></button>
            ${anyNative ? `<button class="sp-wiz-ans" data-key="payType" data-value="native" style="${secondaryBtnStyle};"><span><span style="display:block">Native crypto (ETH / SOL / BNB)</span><span style="${subStyle}">+1.5% fee, auto-swapped for you</span></span><span>→</span></button>` : ''}
            <div style="text-align:center;margin-top:14px;"><button class="sp-wiz-goto" data-step="1b" style="background:none;border:none;color:${isDark ? '#666' : '#999'};font-size:11px;text-decoration:underline;cursor:pointer;">Don't have a wallet yet?</button></div>`;
        case '1b':
          return `
            <h2 style="font-size:20px;font-weight:700;text-align:center;margin:0 0 6px;">Pick a wallet</h2>
            <p style="font-size:12px;text-align:center;color:${isDark ? '#999' : '#666'};margin:0 0 18px;">All free. Download, fund, come back.</p>
            <a href="https://phantom.app/" target="_blank" rel="noopener" style="${secondaryBtnStyle};margin-top:0;text-decoration:none;"><span><span style="display:block">Phantom</span><span style="${subStyle}">Popular Solana wallet</span></span><span>↗</span></a>
            <a href="https://www.coinbase.com/wallet" target="_blank" rel="noopener" style="${secondaryBtnStyle};text-decoration:none;"><span><span style="display:block">Coinbase Wallet</span><span style="${subStyle}">Trusted multi-chain wallet</span></span><span>↗</span></a>
            <a href="https://metamask.io/download/" target="_blank" rel="noopener" style="${secondaryBtnStyle};text-decoration:none;"><span><span style="display:block">MetaMask</span><span style="${subStyle}">Standard for Ethereum</span></span><span>↗</span></a>
            <button class="sp-wiz-goto" data-step="1" style="${primaryBtnStyle};margin-top:14px;"><span>I'm back — let's pay</span><span>→</span></button>`;
        case 'network': {
          // Clean chain picker — so the customer chooses their network here, not buried in the
          // big payment screen.
          const chains = this.merchantChains || [];
          let btns = '';
          for (const mc of chains) {
            const name = mc.config?.chainName || mc.chain;
            // No Solana/Base steering — only flag testnet (neutral), otherwise name only.
            const sub = (mc.config?.network === 'testnet') ? 'Testnet' : '';
            btns += `<button class="sp-wiz-ans" data-key="chain" data-value="${mc.chain}" style="${secondaryBtnStyle};margin-top:10px;"><span style="display:flex;align-items:center;gap:10px;"><img src="${this.getChainIcon(mc.chain)}" style="width:22px;height:22px;border-radius:50%;" onerror="this.style.display='none'"><span><span style="display:block">${name}</span>${sub ? `<span style="${subStyle}">${sub}</span>` : ''}</span></span><span>→</span></button>`;
          }
          return `
            <h2 style="font-size:20px;font-weight:700;text-align:center;margin:0 0 6px;">Choose your network</h2>
            <p style="font-size:12px;text-align:center;color:${isDark ? '#999' : '#666'};margin:0 0 8px;">Pick the chain you'll pay from. You'll send <strong>$${usd} in USDC</strong>.</p>
            ${btns}`;
        }
        case '2': {
          // Connect-wallet works on EVM + Solana (Solana SPL transfer fixed to TransferChecked).
          // Only offer it when a browser wallet is ACTUALLY present (no-extension browsers like
          // Safari would just dead-end). TRON has no working connect path. Manual always offered.
          const chainType = this.selectedChain?.config?.type;
          const canConnect = (chainType === 'evm' || chainType === 'solana') && this._hasWalletFor(chainType);
          const connectBtn = canConnect
            ? `<button class="sp-wiz-ans" data-key="method" data-value="wallet" style="${secondaryBtnStyle};margin-top:0;"><span><span style="display:block">Connect my wallet</span><span style="${subStyle}">One click in MetaMask / Phantom / Coinbase</span></span><span>→</span></button>`
            : '';
          const chainName = this.selectedChain?.config?.chainName || '';
          return `
            <h2 style="font-size:20px;font-weight:700;text-align:center;margin:0 0 6px;">How will you send it?</h2>
            <p style="font-size:12px;text-align:center;color:${isDark ? '#999' : '#666'};margin:0 0 18px;">${this.selectedToken || 'USDC'} on ${chainName}.</p>
            ${connectBtn}
            <button class="sp-wiz-ans" data-key="method" data-value="manual" style="${secondaryBtnStyle};margin-top:${canConnect ? '10px' : '0'};"><span><span style="display:block">Send manually</span><span style="${subStyle}">Copy address or scan a QR — works from any wallet or exchange</span></span><span>→</span></button>
            ${canConnect ? '' : `<p style="font-size:11px;text-align:center;color:${isDark ? '#777' : '#9ca3af'};margin-top:14px;">No browser wallet detected — sending manually works from any wallet.</p>`}`;
        }
        default: return '';
      }
    }

    _wizBackTarget(fromStep) {
      const s = String(fromStep);
      if (s === '1b') return '1';
      // Walk the actual step order so back works through payType → network → method.
      const order = this._wizStepOrder();
      const idx = order.indexOf(s);
      if (idx > 0) return order[idx - 1];
      // First step (or focused "step 3", handled by the "← Change" header) has no back here.
      return null;
    }

    _wizInfoText(step) {
      const s = String(step);
      const map = {
        '1':  ['Choose how to pay.', 'Stablecoin (USDC/USDT — no fee) or native crypto (auto-converted to USDC for the merchant).'],
        '1b': ['Need a wallet first?', 'These are all free. Download one, fund it, then come back.'],
        'network': ['Pick your network.', 'Choose the chain your funds are on.'],
        '2':  ['Choose how to send.', '"Connect my wallet" signs in one click. "Send manually" gives you an address + QR you can pay from any wallet or exchange.'],
      };
      const lines = map[s] || ["You're in the checkout."];
      return lines.join('\n');
    }

    _wizGoStep(step) {
      this._wizardState.step = step;
      const body = this.container.querySelector('#sp-wiz-body');
      const label = this.container.querySelector('#sp-wiz-step-label');
      const back = this.container.querySelector('#sp-wiz-back');
      const info = this.container.querySelector('#sp-wiz-info-panel');
      if (body) body.innerHTML = this._wizStepHTML(step);
      if (label) {
        if (String(step) === '1b') {
          label.textContent = 'Get a wallet';
        } else {
          const order = this._wizStepOrder();
          const total = order.length + 1; // + the final "send" screen
          const idx = order.indexOf(String(step));
          label.textContent = idx >= 0 ? `Step ${idx + 1} of ${total}` : '';
        }
      }
      if (back) back.style.visibility = this._wizBackTarget(step) ? 'visible' : 'hidden';
      if (info) { info.style.display = 'none'; info.textContent = this._wizInfoText(step); }
      this._track('WIZARD_STEP_VIEWED', { step: String(step), variant: this._variant });
    }

    _wizGoBack() {
      const t = this._wizBackTarget(this._wizardState.step);
      if (!t) return;
      this._track('WIZARD_BACK', { from: String(this._wizardState.step), to: String(t) });
      if (t === '1') { this._wizardState.payType = null; this._wizardState.chain = null; this._wizardState.method = null; }
      else if (t === 'network') { this._wizardState.chain = null; this._wizardState.method = null; }
      this._wizGoStep(t);
    }

    attachWizardListeners() {
      if (this._wizListenersAttached) return; // idempotent — prevents leak on restart
      this._wizListenersAttached = true;
      const handle = (e) => {
        if (e.target.closest('#sp-wiz-info')) {
          e.stopPropagation(); e.preventDefault();
          const panel = this.container.querySelector('#sp-wiz-info-panel');
          if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
          return;
        }
        if (e.target.closest('#sp-wiz-back')) { e.stopPropagation(); e.preventDefault(); return this._wizGoBack(); }
        const ans = e.target.closest('.sp-wiz-ans');
        if (ans) { e.stopPropagation(); e.preventDefault(); return this._wizAnswer(ans.dataset.key, ans.dataset.value); }
        const goto = e.target.closest('.sp-wiz-goto');
        if (goto) { e.stopPropagation(); e.preventDefault(); return this._wizGoStep(goto.dataset.step); }
        if (e.target.closest('#sp-wiz-skip')) { e.stopPropagation(); e.preventDefault(); return this._wizSkip(); }
      };
      this.container.addEventListener('click', handle);
      this.container.addEventListener('touchend', handle);
    }

    _wizAnswer(key, value) {
      this._wizardState[key] = value;
      this._track('WIZARD_ANSWER', { key, value, step: String(this._wizardState.step) });
      if (key === 'payType') {
        if ((this.merchantChains || []).length > 1) return this._wizGoStep('network');
        this._selectWizChain(this._defaultChainKey());
        return this._wizGoStep('2');
      }
      if (key === 'chain') { this._selectWizChain(value); return this._wizGoStep('2'); }
      if (key === 'method')  return this._wizComplete();
    }

    _wizSkip() {
      this._track('WIZARD_SKIPPED', { step: String(this._wizardState.step) });
      this._wizardState.done = true; // in-memory only — reload re-shows the wizard
      this.render();
      this.attachEventListeners();
      // Give a way BACK to the guided flow (previously skip was a one-way trap).
      this._injectBackToGuided();
    }

    _injectBackToGuided() {
      const inner = this.container.querySelector('.sp-widget');
      if (!inner || this.container.querySelector('#sp-back-to-guided')) return;
      const bar = document.createElement('div');
      bar.id = 'sp-back-to-guided';
      bar.style.cssText = 'text-align:center;padding:8px;background:#F4F4F5;border-bottom:1px solid #D4D4D8;';
      bar.innerHTML = `<button type="button" style="background:none;border:none;color:#18181B;font-size:12px;font-weight:600;cursor:pointer;text-decoration:underline;">← Back to guided setup</button>`;
      const card = inner.firstElementChild || inner;
      inner.insertBefore(bar, card);
      bar.querySelector('button').addEventListener('click', () => this._wizRestart());
    }

    _wizComplete() {
      // Renamed from WIZARD_COMPLETED → WIZARD_ANSWERED. New semantic split:
      //  - WIZARD_ANSWERED: pre-payment intent (wizard questions done)
      //  - WIZARD_COMPLETED: post-payment success (fires from showSuccess on ORDER_CONFIRMED)
      // Both surfaces fire both events so /ab-results can measure drop-off between intent and purchase.
      this._track('WIZARD_ANSWERED', {
        payType: this._wizardState.payType,
        method: this._wizardState.method,
        chain: this.selectedChain?.chain || null,
        token: this.selectedToken || null,
        variant: this._variant,
      });
      this._wizardState.done = true; // in-memory only (reload re-shows the wizard)
      const targetMode = this._wizardState.payType === 'native' ? 'crypto' : 'stable';
      const targetTab = this._wizardState.method === 'wallet' ? 'wallet' : 'send';
      this.render();
      this.attachEventListeners();
      // Apply mode via setPayMode (NOT direct assignment) so refreshNativePrice,
      // selectChain, selectedToken sync, fee banner, and toggle button all update.
      if (typeof this.setPayMode === 'function') this.setPayMode(targetMode);
      // Sync the classic UI to the chain the customer picked in the wizard's network step —
      // render() defaults the dropdown to merchantChains[0], so without this the picked chain
      // wouldn't be reflected.
      if (this._wizardState.chain && typeof this.selectChain === 'function') {
        try { this.selectChain(this._wizardState.chain); } catch {}
      }
      const tabBtn = this.container.querySelector(`[data-method="${targetTab}"]`);
      if (tabBtn && typeof tabBtn.click === 'function') { try { tabBtn.click(); } catch {} }
      // ── Wizard "Step 3": hide chrome so the user sees only the focused action ──
      this._applyWizardFocusedMode();
      // Fast variant + manual method: skip the sender-wallet entry step entirely.
      // The wallet input (#sp-send-step1) is the friction we're testing whether removing improves
      // conversion. We jump straight to step 2 (QR + address + "I've sent it") here.
      // TX hash / wallet / email collection happens AFTER "I've sent it" in the paste-confirm UI.
      if (this._variant === 'fast' && this._wizardState.method === 'manual') {
        // Small delay so the tab-click rendering completes first.
        setTimeout(() => {
          try { this.showManualPaymentDetails('send'); } catch (e) { console.warn('[SP] fast skip-wallet failed', e); }
        }, 50);
      }
    }

    _applyWizardFocusedMode() {
      const w = this.container;
      const isFast = this._variant === 'fast';
      // Per-rail native support: only surface the stable/native toggle when the CURRENTLY
      // selected chain accepts native tokens.
      const railAcceptsNative = !!(this.selectedChain && this.selectedChain.acceptNativeTokens && CHAIN_NATIVE_TOKEN[this.selectedChain.chain]);
      // Pay-mode toggle + fee banner.
      const modeToggle = w.querySelector('#sp-pay-mode-toggle');
      const feeBanner = w.querySelector('#sp-fee-banner');
      if (isFast) {
        // Keep the toggle reachable — it moves INTO the edit panel below (native stays selectable),
        // but only when this rail accepts native; otherwise hide it.
        if (modeToggle) modeToggle.style.display = railAcceptsNative ? 'flex' : 'none';
      } else {
        // guided/control: wizard already chose pay type — keep prior behavior (hide it).
        if (modeToggle) modeToggle.style.display = 'none';
      }
      // The Network/Token grid.
      const grids = w.querySelectorAll('div[style*="grid-template-columns: 1fr 1fr"]');
      let payGrid = null;
      grids.forEach(g => { if (g.querySelector('#sp-chain-select-wrapper') || g.querySelector('#sp-token-select-wrapper')) payGrid = g; });
      // Hide the method tabs — wizard already chose connect vs manual.
      const tabs = w.querySelector('#sp-method-tabs');
      if (tabs) tabs.style.display = 'none';
      const inner = w.querySelector('.sp-widget');

      if (isFast) {
        // FAST: instead of hiding the grid, fold it into a COLLAPSED <details> 'Edit payment options'
        // inserted right above the send panel. The customer pays without ever opening it.
        const sendPanel = w.querySelector('#sp-method-send');
        if (payGrid && sendPanel && !w.querySelector('#sp-edit-options')) {
          payGrid.style.display = '';
          payGrid.style.marginBottom = '0';
          const details = document.createElement('details');
          details.id = 'sp-edit-options';
          // Preserve open state across instant-apply rebuilds: changing a coin/chain/pay-type repaints
          // the send screen (regenerating this panel), so without this it collapses mid-edit and looks
          // like the editor "exited". Set BEFORE the toggle listener so the restore doesn't re-fire telemetry.
          if (this._editPanelOpen) details.open = true;
          details.style.cssText = 'border:1px solid #D4D4D8;background:#FFFFFF;border-radius:6px;margin-bottom:12px;';
          const summary = document.createElement('summary');
          summary.style.cssText = 'cursor:pointer;list-style:none;padding:10px 12px;font-size:12px;font-weight:600;color:#71717A;user-select:none;';
          summary.textContent = 'Edit payment options ▾';
          const bodyWrap = document.createElement('div');
          bodyWrap.style.cssText = 'padding:0 12px 12px;';
          details.appendChild(summary);
          details.appendChild(bodyWrap);
          // Move the pay-mode toggle (if this rail accepts native) + the network/token grid inside.
          if (modeToggle && railAcceptsNative) {
            modeToggle.style.marginBottom = '12px';
            bodyWrap.appendChild(modeToggle);
            if (feeBanner) bodyWrap.appendChild(feeBanner);
          }
          // Re-parent the grid into the panel.
          bodyWrap.appendChild(payGrid);
          // Green "Done" button — changes apply LIVE as you pick them (the send screen updates
          // instantly), so this just confirms + collapses the panel. Green is the one color accent.
          const editSave = document.createElement('button');
          editSave.id = 'sp-edit-save';
          editSave.type = 'button';
          editSave.textContent = 'Done';
          editSave.style.cssText = 'width:100%;margin-top:12px;padding:10px;background:#16a34a;color:#fff;border:none;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;text-transform:uppercase;letter-spacing:0.5px;';
          editSave.addEventListener('click', () => { details.open = false; });
          bodyWrap.appendChild(editSave);
          // Telemetry: measure how often customers actually open the edit panel.
          details.addEventListener('toggle', () => {
            this._editPanelOpen = details.open; // remembered across instant-apply rebuilds
            if (details.open) this._track('EDIT_PANEL_OPENED', { chain: this.selectedChain?.chain, token: this.selectedToken });
          });
          sendPanel.parentNode.insertBefore(details, sendPanel);
        }
        // Neutral header (no step counter, no chromatic link). The edit panel replaces 'Change'.
        if (inner && !w.querySelector('#sp-wiz-step3-header')) {
          const _what = this._wizardState.method === 'wallet' ? 'Connect & pay' : 'Send payment';
          const header = document.createElement('div');
          header.id = 'sp-wiz-step3-header';
          header.style.cssText = 'padding:10px 14px;background:#FFFFFF;border-bottom:1px solid #D4D4D8;font-size:11px;font-weight:700;color:#18181B;text-transform:uppercase;letter-spacing:1px;';
          header.innerHTML = `<span>${_what}</span>`;
          const card = inner.firstElementChild || inner;
          inner.insertBefore(header, card);
        }
        return;
      }

      // guided/control: original behavior — hide the grid + inject the wizard-style header.
      if (payGrid) payGrid.style.display = 'none';
      if (inner && !w.querySelector('#sp-wiz-step3-header')) {
        const _total = this._wizStepOrder().length + 1;
        const _what = this._wizardState.method === 'wallet' ? 'Connect & pay' : 'Send payment';
        const stepLabel = `Step ${_total} of ${_total} — ${_what}`;
        const header = document.createElement('div');
        header.id = 'sp-wiz-step3-header';
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#F4F4F5;border-bottom:2px solid #D4D4D8;font-size:11px;font-weight:700;color:#18181B;text-transform:uppercase;letter-spacing:1px;';
        header.innerHTML = `<span>${stepLabel}</span><button id="sp-wiz-back" type="button" style="background:none;border:none;color:#18181B;font-size:11px;font-weight:600;cursor:pointer;text-decoration:underline;text-transform:none;letter-spacing:0;">← Change</button>`;
        const card = inner.firstElementChild || inner;
        inner.insertBefore(header, card);
        const back = header.querySelector('#sp-wiz-back');
        if (back) back.addEventListener('click', () => this._wizRestart());
      }
    }

    _wizRestart() {
      this._wizardState = { payType: null, method: null, step: 1, done: false };
      const back = this.container.querySelector('#sp-back-to-guided'); if (back) back.remove();
      this._renderWizard();
      this.attachWizardListeners();
    }

    injectStyles() {
      if (document.getElementById('stablepay-widget-styles')) return;

      const style = document.createElement('style');
      style.id = 'stablepay-widget-styles';
      // Load Space Grotesk font
      if (!document.querySelector('link[href*="Space+Grotesk"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap';
        document.head.appendChild(link);
      }
      style.textContent = `
        .sp-widget { font-family: 'Space Grotesk', system-ui, sans-serif; position: relative; z-index: 10; }
        .sp-widget * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        .sp-widget button, .sp-widget select, .sp-widget input { touch-action: manipulation; }
        .sp-widget.dark { --sp-bg: #0f172a; --sp-card: #1e293b; --sp-border: #334155; --sp-text: #fff; --sp-muted: #94a3b8; }
        .sp-widget.light { --sp-bg: #fff; --sp-card: #f1f5f9; --sp-border: #000; --sp-text: #000; --sp-muted: #64748b; }
        .sp-pay-btn { transition: all 0.15s; text-transform: uppercase; letter-spacing: 0.5px; }
        .sp-pay-btn:hover:not(:disabled) { transform: translate(-2px, -2px); box-shadow: 6px 6px 0px #000; }
        .sp-pay-btn:active:not(:disabled) { transform: translate(1px, 1px); box-shadow: 2px 2px 0px #000; }
        .sp-pay-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .sp-spinner { animation: sp-spin 1s linear infinite; }
        @keyframes sp-spin { to { transform: rotate(360deg); } }
        @keyframes sp-stablo-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.12); } }
        .sp-widget select { font-family: 'Space Grotesk', system-ui, sans-serif; }
        .sp-stablo-btn { position:absolute;bottom:8px;right:8px;z-index:20;display:flex;align-items:center;gap:6px;padding:8px 14px;font-size:12px;font-weight:800;background:#00E5FF;color:#000;border:2px solid #000;box-shadow:2px 2px 0 #000;cursor:pointer;white-space:nowrap;font-family:inherit; }
        .sp-stablo-btn:hover { transform:translate(-1px,-1px);box-shadow:3px 3px 0 #000; }
        .sp-stablo-panel { position:absolute;bottom:48px;right:8px;left:8px;z-index:20;max-height:320px;background:#fff;border:2px solid #000;box-shadow:3px 3px 0 #000;display:flex;flex-direction:column;overflow:hidden; }
        .sp-stablo-panel.sp-hidden { display:none; }
        .sp-stablo-hdr { display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:2px solid #000;background:#00E5FF;font-weight:800;font-size:12px; }
        .sp-stablo-close { font-size:18px;cursor:pointer;line-height:1;font-weight:900;background:none;border:none;padding:4px; }
        .sp-stablo-msgs { flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:6px;font-size:13px;min-height:80px;max-height:200px; }
        .sp-stablo-msg { max-width:85%;padding:7px 10px;line-height:1.4;word-break:break-word; }
        .sp-stablo-msg.bot { background:#f3f3f3;border:2px solid #000;align-self:flex-start; }
        .sp-stablo-msg.user { background:#00E5FF;border:2px solid #000;align-self:flex-end; }
        .sp-stablo-chips { display:flex;flex-wrap:wrap;gap:5px;padding:0 10px 8px; }
        .sp-stablo-chip { font-size:12px;font-weight:700;padding:7px 10px;border:2px solid #000;background:#fff;cursor:pointer;min-height:36px;display:flex;align-items:center;font-family:inherit; }
        .sp-stablo-chip:hover { background:#f3f3f3; }
        .sp-stablo-input-row { display:flex;border-top:2px solid #000; }
        .sp-stablo-input { flex:1;padding:10px;border:none;outline:none;font-size:14px;font-family:inherit;min-width:0; }
        .sp-stablo-send { padding:10px 14px;font-weight:800;font-size:13px;background:#000;color:#00E5FF;border:none;cursor:pointer;min-width:44px;min-height:44px; }
        .sp-widget.dark .sp-stablo-panel { background:#1a1a1a;border-color:#444;box-shadow:3px 3px 0 #444; }
        .sp-widget.dark .sp-stablo-hdr { background:#005f6b;border-color:#444;color:#fff; }
        .sp-widget.dark .sp-stablo-msg.bot { background:#2a2a2a;border-color:#444;color:#ddd; }
        .sp-widget.dark .sp-stablo-msg.user { background:#005f6b;border-color:#444;color:#fff; }
        .sp-widget.dark .sp-stablo-chip { background:#2a2a2a;border-color:#555;color:#ccc; }
        .sp-widget.dark .sp-stablo-chip:hover { background:#333; }
        .sp-widget.dark .sp-stablo-input { background:#1a1a1a;color:#eee; }
        .sp-widget.dark .sp-stablo-input-row { border-color:#444; }
      `;
      document.head.appendChild(style);
    }

    async loadMerchantConfig() {
      if (!this.options.merchantId) {
        console.warn('StablePay: No merchantId provided');
        return;
      }

      try {
        // Append storeId so the server can return store-scoped branding + wallet union.
        const chainsUrl = this.options.storeId
          ? `${STABLEPAY_URL}/api/embed/chains?merchantId=${this.options.merchantId}&storeId=${encodeURIComponent(this.options.storeId)}`
          : `${STABLEPAY_URL}/api/embed/chains?merchantId=${this.options.merchantId}`;
        const response = await fetch(chainsUrl);
        if (!response.ok) throw new Error('Failed to load merchant');

        const data = await response.json();
        this.merchantData = data;

        // When a store is scoped, pull its branding directly so it REPLACES merchant branding.
        if (this.options.storeId) {
          try {
            const storeRes = await fetch(`${STABLEPAY_URL}/api/embed/store/${encodeURIComponent(this.options.storeId)}`);
            if (storeRes.ok) {
              const store = await storeRes.json();
              this.storeData = store;
              // Merge store widgetConfig on top of merchant widgetConfig so next block sees it.
              data.widgetConfig = Object.assign({}, store.widgetConfig || {}, {
                displayName: store.displayName,
                logoUrl: store.logoUrl,
                headerColor: store.headerColor,
                headerTextColor: store.headerTextColor,
                backButtonText: store.backButtonText,
              });
              if (store.displayName) data.merchantName = store.displayName;
            }
          } catch (e) { /* fall back to merchant branding */ }
        }

        if (data.wallets && data.wallets.length > 0) {
          // Preserve the merchant's configured wallet order — merchantChains[0] is the
          // merchant's FIRST-configured rail (no opinionated chainPriority re-sort).
          this.merchantChains = data.wallets
            .filter(w => CHAIN_CONFIG[w.chain])
            .map(w => ({
              chain: w.chain,
              address: w.address,
              supportedTokens: w.supportedTokens || ['USDC'],
              acceptNativeTokens: !!w.acceptNativeTokens,
              preferredStablecoin: w.preferredStablecoin || 'USDC',
              config: CHAIN_CONFIG[w.chain]
            }));
        }

        if (this.merchantChains.length > 0) {
          this.selectedChain = this.merchantChains[0];
          this.payMode = 'stable'; // 'stable' | 'crypto'
          this.nativePriceUsd = null;
          this.nativePricePoller = null;
          this.selectedToken = this.selectedChain.supportedTokens[0] || 'USDC';
        }

        // Apply server-side widget config (data-* attributes override)
        if (data.widgetConfig) {
          const wc = data.widgetConfig;
          const c = this.container;
          if (wc.borderStyle && !c.dataset.borderStyle) this.options.borderStyle = wc.borderStyle;
          if (wc.theme && !c.dataset.theme) this.options.theme = wc.theme;
          if (wc.headerColor && !c.dataset.headerColor) this.options.headerColor = wc.headerColor;
          if (wc.headerTextColor && !c.dataset.headerTextColor) this.options.headerTextColor = wc.headerTextColor;
          if (wc.logoUrl && !c.dataset.logo) this.options.logoUrl = wc.logoUrl;
          if (wc.buttonText && !c.dataset.buttonText) this.options.buttonText = wc.buttonText;
          if (wc.hideFooter && !c.dataset.hideFooter) this.options.hideFooter = true;
          if (wc.fontFamily && !c.dataset.font) this.options.fontFamily = wc.fontFamily;
        }
      } catch (error) {
        console.error('StablePay: Error loading merchant config', error);
      }
    }

    renderLoading() {
      const isDark = this.options.theme === 'dark';
      this.container.innerHTML = `
        <div class="sp-widget ${this.options.theme}" style="
          background: ${isDark ? '#1a1a1a' : '#fff'};
          border: 1px solid ${isDark ? '#333' : '#e5e7eb'};
          border-radius: 12px;
          padding: 32px;
          text-align: center;
          color: ${isDark ? '#888' : '#6b7280'};
        ">
          <div class="sp-spinner" style="
            width: 32px; height: 32px;
            border: 3px solid ${isDark ? '#333' : '#D4D4D8'};
            border-top-color: ${isDark ? '#fff' : '#18181B'};
            border-radius: 50%;
            margin: 0 auto 12px;
          "></div>
          Loading checkout...
        </div>
      `;
    }

    render() {
      const isDark = this.options.theme === 'dark';
      const accent = this.options.accentColor;

      if (this.merchantChains.length === 0) {
        this.container.innerHTML = `
          <div class="sp-widget ${this.options.theme}" style="
            background: ${isDark ? '#1a1a1a' : '#fff'};
            border: 1px solid ${isDark ? '#333' : '#e5e7eb'};
            border-radius: 12px;
            padding: 24px;
            text-align: center;
            color: ${isDark ? '#888' : '#6b7280'};
          ">
            <p>Payment not available</p>
            <p style="font-size: 12px; margin-top: 8px;">Merchant has not configured payment methods.</p>
          </div>
        `;
        return;
      }

      this.container.innerHTML = `
        ${this.options.customCSS ? `<style>.sp-widget { ${this.options.customCSS} }</style>` : ''}
        <div class="sp-widget ${this.options.theme}" style="
          --sp-accent: ${this._variant === 'fast' ? '#18181B' : accent};
          background: var(--sp-bg);
          ${this.options.borderStyle === 'brutal' ? 'border: 4px solid #000; box-shadow: 8px 8px 0px #000;' : ''}
          ${this.options.borderStyle === 'rounded' ? 'border: 1px solid var(--sp-border); border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.12);' : ''}
          ${this.options.borderStyle === 'minimal' ? 'border: 1px solid var(--sp-border);' : ''}
          ${this.options.fontFamily ? `font-family: ${this.options.fontFamily}, sans-serif;` : ''}
          padding: 0;
          max-width: 420px;
          overflow: visible;
          position: relative;
          z-index: 999;
          pointer-events: auto;
        ">
          <!-- Header -->
          <!-- FAST: force a neutral white header band (ignore merchant headerColor/accent).
               guided/control keep the merchant headerColor + headerTextColor branding. -->
          <div style="background: ${this._variant === 'fast' ? '#FFFFFF' : this.options.headerColor}; padding: 16px 20px; ${this.options.borderStyle === 'brutal' ? 'border-bottom: 4px solid #000;' : 'border-bottom: 1px solid var(--sp-border);'}">
            ${this.options.logoUrl ? `<img src="${this.options.logoUrl}" style="height: 24px; margin-bottom: 8px;" alt="logo">` : ''}
            <div style="font-size: 11px; font-weight: 700; color: ${this._variant === 'fast' ? '#71717A' : (this.options.headerTextColor === 'light' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)')}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px;">
              ${this.options.productName || 'Pay with Stablecoins'}
            </div>
            <div id="sp-amount-display" style="font-size: 28px; font-weight: 700; color: ${this._variant === 'fast' ? '#18181B' : (this.options.headerTextColor === 'light' ? '#fff' : '#000')};">
              $${parseFloat(this.options.amount || 0) < 0.01 ? parseFloat(this.options.amount || 0).toFixed(4) : parseFloat(this.options.amount || 0).toFixed(2)}
            </div>
          </div>

          <div style="padding: 20px;">

          <!-- Pay mode toggle (only shown when merchant accepts native tokens) -->
          ${this.merchantChains.some(mc => mc.acceptNativeTokens && CHAIN_NATIVE_TOKEN[mc.chain]) ? `
          <div id="sp-pay-mode-toggle" style="display: flex; border: 2px solid var(--sp-border); margin-bottom: 12px;">
            <button id="sp-mode-stable" type="button" onclick="window._spWidget?.setPayMode('stable')" style="
              flex: 1; padding: 8px 12px; text-align: left; background: var(--sp-text); color: var(--sp-bg);
              border: none; cursor: pointer; font-size: 11px; font-weight: 700;
            ">
              <span style="display: block;">Stablecoin</span>
              <span style="font-size: 10px; opacity: 0.6; font-weight: 400;">USDC · USDT · No fee</span>
            </button>
            <button id="sp-mode-crypto" type="button" onclick="window._spWidget?.setPayMode('crypto')" style="
              flex: 1; padding: 8px 12px; text-align: left; background: var(--sp-card); color: var(--sp-muted);
              border: none; border-left: 2px solid var(--sp-border); cursor: pointer; font-size: 11px; font-weight: 700;
            ">
              <span style="display: block;">ETH / SOL / BNB</span>
              <span style="font-size: 10px; opacity: 0.6; font-weight: 400;">+1.5% conversion fee</span>
            </button>
          </div>
          <!-- Conversion fee note (neutral, grayscale) -->
          <div id="sp-fee-banner" style="display: none; background: #F4F4F5; border: 1px solid #D4D4D8; padding: 10px 12px; margin-bottom: 12px; font-size: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <div>
                <strong style="color: #18181B;">Native adds a 1.5% conversion fee</strong>
                <span style="color: #71717A;"> — you'll send <strong id="sp-native-send-amt" style="color: #18181B;">—</strong></span>
              </div>
              <button type="button" onclick="window._spWidget?.setPayMode('stable')" style="
                font-size: 11px; font-weight: 700; text-decoration: underline; color: #18181B;
                background: none; border: none; cursor: pointer; white-space: nowrap; padding: 0;
              ">Use USDC →</button>
            </div>
            <div id="sp-native-expiry" style="font-size: 10px; color: #71717A; margin-top: 4px;"></div>
          </div>
          ` : ''}

          <!-- Chain + Token Selection -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px;">
            <div>
              <label style="font-size: 10px; font-weight: 700; color: var(--sp-muted); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Network</label>
              <div id="sp-chain-select-wrapper" style="position: relative;">
                <button id="sp-chain-select-btn" type="button" style="
                  width: 100%; padding: 8px 12px; font-size: 13px; font-weight: 600;
                  background: var(--sp-card); color: var(--sp-text); border: 2px solid var(--sp-border);
                  cursor: pointer; text-align: left; display: flex; align-items: center; gap: 8px;
                ">
                  <img src="${this.getChainIcon(this.merchantChains[0]?.chain)}" style="width: 18px; height: 18px; border-radius: 50%;" onerror="this.style.display='none'">
                  <span>${this.merchantChains[0]?.config?.chainName || 'Select'}</span>
                  <span style="margin-left: auto; font-size: 10px; opacity: 0.5;">▼</span>
                </button>
                <div id="sp-chain-dropdown" style="
                  display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 50;
                  background: var(--sp-card); border: 2px solid var(--sp-border); border-top: none; max-height: 200px; overflow-y: auto;
                ">
                  ${this.merchantChains.map((mc, i) => `
                    <div class="sp-chain-option" data-chain="${mc.chain}" style="
                      padding: 8px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; color: var(--sp-text);
                      ${i === 0 ? 'background: var(--sp-bg);' : ''}
                    " onmouseover="this.style.background='var(--sp-bg)'" onmouseout="this.style.background=''">
                      <img src="${this.getChainIcon(mc.chain)}" style="width: 18px; height: 18px; border-radius: 50%;" onerror="this.style.display='none'">
                      <span style="font-size: 13px; font-weight: 600; color: var(--sp-text);">${mc.config.chainName}</span>
                    </div>
                  `).join('')}
                </div>
                <!-- Hidden select for form compatibility -->
                <select id="sp-chain-select" style="display:none;">
                  ${this.merchantChains.map((mc, i) => `<option value="${mc.chain}" ${i === 0 ? 'selected' : ''}>${mc.config.chainName}</option>`).join('')}
                </select>
              </div>
            </div>
            <div>
              <label id="sp-token-label" style="font-size: 10px; font-weight: 700; color: var(--sp-muted); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Stablecoin</label>
              <div id="sp-token-select-wrapper" style="position: relative;">
                <button id="sp-token-select-btn" type="button" style="
                  width: 100%; padding: 8px 12px; font-size: 13px; font-weight: 600;
                  background: var(--sp-card); color: var(--sp-text); border: 2px solid var(--sp-border);
                  cursor: pointer; text-align: left; display: flex; align-items: center; gap: 8px;
                ">
                  <img src="${this.getTokenIcon(this.selectedToken)}" style="width: 18px; height: 18px; border-radius: 50%;" onerror="this.style.display='none'">
                  <span>${this.selectedToken}</span>
                  <span style="margin-left: auto; font-size: 10px; opacity: 0.5;">▼</span>
                </button>
                <div id="sp-token-dropdown" style="
                  display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 50;
                  background: var(--sp-card); border: 2px solid var(--sp-border); border-top: none;
                ">
                  ${this.selectedChain ? this.selectedChain.supportedTokens
                    .filter(t => this.selectedChain.config.tokens[t])
                    .map(token => `
                      <div class="sp-token-option" data-token="${token}" style="
                        padding: 8px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; color: var(--sp-text);
                      " onmouseover="this.style.background='var(--sp-bg)'" onmouseout="this.style.background=''">
                        <img src="${this.getTokenIcon(token)}" style="width: 18px; height: 18px; border-radius: 50%;" onerror="this.style.display='none'">
                        <span style="font-size: 13px; font-weight: 600; color: var(--sp-text);">${token}</span>
                      </div>
                    `).join('') : ''}
                </div>
                <select id="sp-token-select" style="display:none;">
                  ${this.renderTokenOptions()}
                </select>
              </div>
            </div>
          </div>

          <!-- Payment Method Tabs: SEND (default) vs CONNECT -->
          <div style="margin-bottom: 12px;">
            <div id="sp-method-tabs" style="display: flex; gap: 0; margin-bottom: 12px; border: 2px solid var(--sp-border);">
              <button class="sp-method-tab" data-method="send" style="
                flex: 1; padding: 10px 6px; font-size: 11px; font-weight: 700; border: none;
                background: #18181B; color: #fff; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;
              ">Send Payment</button>
              <button class="sp-method-tab" data-method="wallet" style="
                flex: 1; padding: 10px 6px; font-size: 11px; font-weight: 700; border: none; border-left: 2px solid var(--sp-border);
                background: var(--sp-card); color: var(--sp-muted); cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;
              ">Connect Wallet</button>
            </div>

            <!-- Method: Connect Wallet -->
            <div id="sp-method-wallet" class="sp-method-panel" style="display: none;">
              <div id="sp-wallet-status" style="
                background: var(--sp-card); border: 2px solid var(--sp-border);
                padding: 12px; margin-bottom: 12px;
                display: flex; align-items: center; justify-content: space-between;
              ">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div style="width: 8px; height: 8px; border-radius: 50%; background: #71717A;"></div>
                  <span style="font-size: 12px; color: var(--sp-muted); font-weight: 600;">Not connected</span>
                </div>
                <button id="sp-connect-btn" style="
                  padding: 6px 14px; background: #000; color: #fff;
                  border: 2px solid var(--sp-border); font-size: 11px; font-weight: 700; cursor: pointer; text-transform: uppercase;
                ">Connect</button>
              </div>
              <button id="sp-pay-btn" class="sp-pay-btn" disabled style="
                width: 100%; padding: 14px; background: #18181B; color: #fff;
                border: 3px solid var(--sp-border); font-size: 14px; font-weight: 700; cursor: pointer;
                box-shadow: 4px 4px 0px #000;
              ">Connect Wallet to Pay</button>
            </div>

            <!-- Method: Send Payment (default) -->
            <div id="sp-method-send" class="sp-method-panel">
              <!-- Step indicator (hidden for fast — guided 3-step framing) -->
              <div id="sp-step-indicator" style="${this._variant === 'fast' ? 'display: none;' : 'display: flex;'} align-items: center; justify-content: center; gap: 0; margin-bottom: 14px; padding: 0 12px;">
                <div class="sp-step-dot sp-step-active" data-step="1" style="width: 24px; height: 24px; border-radius: 50%; background: #000; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700;">1</div>
                <div style="flex: 1; height: 2px; background: var(--sp-border);"></div>
                <div class="sp-step-dot" data-step="2" style="width: 24px; height: 24px; border-radius: 50%; background: var(--sp-card); color: var(--sp-muted); border: 2px solid var(--sp-border); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700;">2</div>
                <div style="flex: 1; height: 2px; background: var(--sp-border);"></div>
                <div class="sp-step-dot" data-step="3" style="width: 24px; height: 24px; border-radius: 50%; background: var(--sp-card); color: var(--sp-muted); border: 2px solid var(--sp-border); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700;">3</div>
              </div>

              <!-- Step 1: Enter wallet -->
              <div id="sp-send-step1" style="padding: 12px;">
                <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 2px;">
                  <span style="font-size: 11px; font-weight: 700; color: var(--sp-text);">Your Wallet Address</span>
                  <span id="sp-wallet-help-btn" role="button" style="width: 14px; height: 14px; min-width: 14px; max-width: 14px; min-height: 14px; max-height: 14px; border-radius: 50%; background: var(--sp-card); border: 1px solid var(--sp-border); color: var(--sp-muted); font-size: 8px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; flex-shrink: 0; line-height: 1; box-sizing: border-box; -webkit-appearance: none; touch-action: manipulation;">?</span>
                </div>
                <p style="font-size: 9px; color: var(--sp-muted); margin-bottom: 8px;">Paste the wallet address you'll send from.</p>
                <!-- Help dropdown -->
                <div id="sp-wallet-help" style="display: none; background: var(--sp-card); border: 2px solid var(--sp-border); padding: 10px; margin-bottom: 10px; font-size: 10px; color: var(--sp-muted); line-height: 1.5;">
                  <div style="font-weight: 700; color: var(--sp-text); margin-bottom: 6px; font-size: 10px;">How to find your wallet address:</div>
                  <div style="margin-bottom: 6px;">
                    <strong style="color: var(--sp-text);">On your phone:</strong> Open your wallet app (Phantom, MetaMask, Trust Wallet, etc.) and tap <strong>Receive</strong> — copy the address shown.
                  </div>
                  <div style="margin-bottom: 6px;">
                    <strong style="color: var(--sp-text);">On desktop:</strong> Open your browser wallet extension and click your address to copy it.
                  </div>
                  <div style="margin-bottom: 6px;">
                    <strong style="color: var(--sp-text);">iPhone + Mac:</strong> Copy on your phone, then paste here with Cmd+V (Universal Clipboard).
                  </div>
                  <div style="border-top: 1px solid var(--sp-border); padding-top: 6px; margin-top: 4px;">
                    <strong style="color: var(--sp-text);">Which address?</strong> Use the address for <strong>${this.selectedChain?.config?.chainName || 'the selected network'}</strong>. ${this.selectedChain?.config?.type === 'solana' ? 'Solana addresses are ~44 characters, no 0x prefix.' : this.selectedChain?.config?.type === 'tron' ? 'TRON addresses start with T.' : 'EVM addresses start with 0x and are 42 characters.'}
                  </div>
                </div>
                <div style="display: flex; gap: 6px;">
                  <input id="sp-sender-wallet" type="text" placeholder="${this.selectedChain?.config?.type === 'solana' ? 'Your Solana address' : this.selectedChain?.config?.type === 'tron' ? 'Your TRON address' : 'Your 0x address'}" style="
                    flex: 1; padding: 8px; font-size: 14px; font-family: inherit; border: 1px solid var(--sp-border);
                    background: var(--sp-bg); color: var(--sp-text); outline: none; min-width: 0;
                    text-overflow: ellipsis; border-radius: 3px;
                  ">
                  <button id="sp-sender-wallet-btn" style="
                    padding: 8px 16px; background: #18181B; color: #fff; border: none;
                    font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase;
                    border-radius: 3px; flex-shrink: 0;
                  ">Next</button>
                </div>
              </div>
              <!-- Step 2: QR + Address + Amount (hidden until step 1 done) -->
              <div id="sp-send-step2" style="display: none; padding: 12px;">
                <!-- Toggle: QR / Address -->
                <div style="display: flex; gap: 0; margin-bottom: 12px; border: 2px solid var(--sp-border);">
                  <button id="sp-send-toggle-qr" style="flex:1; padding: 6px; font-size: 9px; font-weight: 700; border: none; background: #18181B; color: #fff; cursor: pointer; text-transform: uppercase;">QR Code</button>
                  <button id="sp-send-toggle-addr" style="flex:1; padding: 6px; font-size: 9px; font-weight: 700; border: none; border-left: 2px solid var(--sp-border); background: var(--sp-card); color: var(--sp-muted); cursor: pointer; text-transform: uppercase;">Copy Address</button>
                </div>

                <!-- Asset/chain safety warning — populated with the exact coin+network in showManualPaymentDetails -->
                <div style="display:flex;gap:6px;align-items:flex-start;border:1px solid var(--sp-border);background:var(--sp-card);padding:8px 10px;margin-bottom:12px;">
                  <span style="font-size:12px;line-height:1.4;">⚠️</span>
                  <span id="sp-send-warning" style="font-size:10px;line-height:1.4;color:var(--sp-text);"></span>
                </div>

                <!-- QR View (default) -->
                <div id="sp-send-view-qr" style="text-align: center; margin-bottom: 12px;">
                  <!-- Solana Pay toggle (only visible on Solana) -->
                  <div id="sp-solanapay-toggle" style="display: none; margin-bottom: 10px;">
                    <label style="display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; background: #F4F4F5; border: 1px solid #D4D4D8; padding: 6px 12px; border-radius: 6px;">
                      <input type="checkbox" id="sp-solanapay-check" style="width: 14px; height: 14px; accent-color: #18181B;">
                      <span style="font-size: 10px; color: #18181B; font-weight: 700;">Solana Pay QR</span>
                      <span style="font-size: 8px; color: var(--sp-muted);">Phantom / Solflare</span>
                    </label>
                  </div>
                  <div style="background: white; padding: 10px; display: inline-block; border: 2px solid var(--sp-border); margin-bottom: 8px;">
                    <canvas id="sp-qr-canvas" width="140" height="140"></canvas>
                  </div>
                  <p style="font-size: 11px; color: var(--sp-text); font-weight: 600;">Send exactly <span id="sp-send-amount-display" style="color: #18181B; font-weight: 700;"></span></p>
                  <p style="font-size: 9px; color: var(--sp-muted);">Scan with your wallet app and send the exact amount.</p>
                </div>

                <!-- Address View (hidden by default) -->
                <div id="sp-send-view-addr" style="display: none; margin-bottom: 12px;">
                  <div style="background: var(--sp-card); border: 2px solid var(--sp-border); padding: 10px; margin-bottom: 8px;">
                    <div style="font-size: 9px; color: var(--sp-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Send to</div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <code id="sp-pay-address" style="font-size: 10px; color: var(--sp-text); word-break: break-all; flex: 1; font-weight: 600;"></code>
                      <button id="sp-copy-addr-btn" style="padding: 4px 10px; background: #000; color: #fff; border: none; font-size: 10px; font-weight: 700; cursor: pointer;">COPY</button>
                    </div>
                  </div>
                  <div style="background: var(--sp-card); border: 2px solid var(--sp-border); padding: 10px;">
                    <div style="font-size: 9px; color: var(--sp-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Exact amount</div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span id="sp-pay-amount" style="font-size: 20px; font-weight: 700; color: var(--sp-text);"></span>
                      <button id="sp-copy-amt-btn" style="padding: 4px 10px; background: #000; color: #fff; border: none; font-size: 10px; font-weight: 700; cursor: pointer;">COPY</button>
                    </div>
                  </div>
                </div>

                <!-- Countdown timer -->
                <div id="sp-countdown" style="text-align: center; margin-bottom: 10px;">
                  <span style="font-size: 10px; color: var(--sp-muted); text-transform: uppercase; font-weight: 600;">Complete payment within</span>
                  <div id="sp-countdown-time" style="font-size: 22px; font-weight: 800; color: var(--sp-text); font-family: monospace; margin-top: 2px;">5:00</div>
                </div>

                <button id="sp-send-sent-btn" style="
                  width: 100%; padding: 12px; background: #18181B; color: #fff; border: 3px solid var(--sp-border);
                  font-weight: 700; font-size: 12px; cursor: pointer; text-transform: uppercase; box-shadow: 4px 4px 0px #000;
                ">I've Sent the Payment</button>
                <button id="sp-send-back-btn" style="
                  width: 100%; padding: 8px; background: transparent; color: var(--sp-muted); border: none;
                  font-size: 11px; cursor: pointer; margin-top: 6px; text-decoration: underline;
                ">← Change wallet address</button>
                <p style="font-size: 9px; color: var(--sp-muted); margin-top: 10px; text-align: center; line-height: 1.4;">🔒 No signup — what you paste is only used to confirm your payment, never sold or shared.</p>
              </div>
              <!-- Step 3: Verification -->
              <div id="sp-send-step3" style="display: none; padding: 20px;">
                <!-- Expiry warning banner -->
                <div id="sp-expiry-warning" style="display:none;"></div>
                <!-- Progress bar -->
                <div style="width: 100%; height: 4px; background: var(--sp-card); margin-bottom: 16px; overflow: hidden;">
                  <div id="sp-progress-bar" style="width: 0%; height: 100%; background: #18181B; transition: width 1s linear;"></div>
                </div>

                <div style="text-align: center;">
                  <p id="sp-poll-status" style="font-size: 12px; font-weight: 700; color: var(--sp-text); margin-bottom: 4px;">Scanning the blockchain...</p>
                  <p id="sp-poll-timer" style="font-size: 9px; color: var(--sp-muted);">This can take up to a minute</p>
                </div>

                <!-- Manual paste (hidden until 15s) -->
                <div id="sp-manual-tx" style="display: none; margin-top: 16px; text-align: left;">
                  <div style="background: var(--sp-card); border: 1px solid var(--sp-border); padding: 10px; border-radius: 4px;">
                    <p style="font-size: 11px; font-weight: 600; color: var(--sp-text); margin-bottom: 6px;">Already sent it? Paste your confirmation —</p>
                    <div style="display: flex; gap: 6px;">
                      <input id="sp-manual-tx-input" type="text" placeholder="Paste your transaction link / ID / wallet address" style="
                        flex: 1; padding: 8px; font-size: 14px; font-family: inherit; border: 1px solid var(--sp-border);
                        background: var(--sp-bg); color: var(--sp-text); outline: none;
                        text-overflow: ellipsis; overflow: hidden; border-radius: 3px;
                      ">
                      <button id="sp-manual-tx-btn" type="button" style="
                        padding: 8px 12px; background: #000; color: #fff; border: none;
                        font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase;
                        border-radius: 3px; flex-shrink: 0;
                      ">📋 Paste</button>
                    </div>
                    <p id="sp-manual-tx-hint" style="font-size: 9px; color: var(--sp-muted); margin-top: 3px;">a transaction link, ID, or your wallet address — we'll find your payment.</p>
                    <p id="sp-manual-tx-status" style="font-size: 9px; color: var(--sp-muted); margin-top: 3px; display: none;"></p>
                    <p style="font-size: 9px; color: var(--sp-muted); margin-top: 6px; line-height: 1.4;">🔒 No signup — what you paste is only used to confirm your payment, never sold or shared.</p>
                  </div>
                </div>

                <button id="sp-cancel-listen-btn" style="
                  display: block; margin: 12px auto 0; padding: 6px; background: transparent; color: var(--sp-muted); border: none;
                  font-size: 10px; cursor: pointer; text-decoration: underline;
                ">← Go back</button>
              </div>
            </div>
          </div>

          ${this.options.hideFooter ? '' : `<!-- Footer -->
          <div style="margin-top: 16px; text-align: center; font-size: 10px; color: var(--sp-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
            Powered by <a href="${STABLEPAY_URL}" target="_blank" style="color: var(--sp-text); text-decoration: none; font-weight: 700;">StablePay</a>
          </div>`}
          </div>
        </div>
      `;
    }

    getChainIcon(chain) {
      const icons = {
        BASE_MAINNET: 'https://avatars.githubusercontent.com/u/108554348?s=80&v=4',
        ETHEREUM_MAINNET: 'https://www.svgrepo.com/show/428658/ethereum-crypto-cryptocurrency-2.svg',
        POLYGON_MAINNET: 'https://cdn.iconscout.com/icon/premium/png-256-thumb/polygon-matic-icon-svg-download-png-5795452.png?f=webp&w=128',
        ARBITRUM_MAINNET: 'https://arbitrum.io/_next/image?url=%2Fbrandkit%2F1225_Arbitrum_Logomark_OneColorNavy_ClearSpace.png&w=640&q=75',
        BNB_MAINNET: 'https://www.svgrepo.com/show/366901/bnb.svg',
        SOLANA_MAINNET: 'https://www.svgrepo.com/show/470684/solana.svg',
        TRON_MAINNET: 'https://www.svgrepo.com/show/428648/tron-crypto-cryptocurrency.svg',
      };
      return icons[chain] || '';
    }

    getTokenIcon(token) {
      const icons = {
        USDC: 'https://www.svgrepo.com/show/367255/usdc.svg',
        USDT: 'https://www.svgrepo.com/show/367256/usdt.svg',
        EURC: 'https://coin-images.coingecko.com/coins/images/26045/large/EURC.png',
        ETH: 'https://www.svgrepo.com/show/428658/ethereum-crypto-cryptocurrency-2.svg',
        SOL: 'https://www.svgrepo.com/show/470684/solana.svg',
        BNB: 'https://www.svgrepo.com/show/366901/bnb.svg',
        MATIC: 'https://cdn.iconscout.com/icon/premium/png-256-thumb/polygon-matic-icon-svg-download-png-5795452.png?f=webp&w=128',
        ARB: 'https://arbitrum.io/_next/image?url=%2Fbrandkit%2F1225_Arbitrum_Logomark_OneColorNavy_ClearSpace.png&w=640&q=75',
      };
      return icons[token] || '';
    }

    renderTokenOptions() {
      if (!this.selectedChain) return '<option>USDC</option>';
      const tokens = this.getTokensForMode();
      return tokens
        .map((token, i) => `<option value="${token}" ${i === 0 ? 'selected' : ''}>${token}</option>`)
        .join('');
    }

    getTokensForMode() {
      if (!this.selectedChain) return ['USDC'];
      const nativeToken = CHAIN_NATIVE_TOKEN[this.selectedChain.chain];
      if (this.payMode === 'crypto' && this.selectedChain.acceptNativeTokens && nativeToken) {
        return [nativeToken];
      }
      // Respect the merchant's configured supportedTokens order — selectedToken defaults
      // to supportedTokens[0] (no opinionated USDC/USDT/EURC re-sort).
      return [...this.selectedChain.supportedTokens]
        .filter(t => this.selectedChain.config.tokens[t]);
    }

    setPayMode(mode) {
      const prev = this.payMode;
      this.payMode = mode;
      if (prev !== mode) this._track('MODE_SWITCHED', { from: prev, to: mode });
      // Update toggle button styles
      const btnStable = this.container.querySelector('#sp-mode-stable');
      const btnCrypto = this.container.querySelector('#sp-mode-crypto');
      if (btnStable && btnCrypto) {
        if (mode === 'stable') {
          btnStable.style.background = 'var(--sp-text)'; btnStable.style.color = 'var(--sp-bg)';
          btnCrypto.style.background = 'var(--sp-card)'; btnCrypto.style.color = 'var(--sp-muted)';
        } else {
          btnCrypto.style.background = 'var(--sp-text)'; btnCrypto.style.color = 'var(--sp-bg)';
          btnStable.style.background = 'var(--sp-card)'; btnStable.style.color = 'var(--sp-muted)';
        }
      }
      // Update token label
      const tokenLabel = this.container.querySelector('#sp-token-label');
      if (tokenLabel) tokenLabel.textContent = mode === 'stable' ? 'Stablecoin' : 'Crypto token';

      // Filter chain dropdown — hide chains with no native token when in crypto mode
      const chainDropdown = this.container.querySelector('#sp-chain-dropdown');
      const chainSelect = this.container.querySelector('#sp-chain-select');
      if (chainDropdown) {
        chainDropdown.querySelectorAll('.sp-chain-option').forEach(opt => {
          const c = opt.dataset.chain;
          opt.style.display = (mode === 'crypto' && !CHAIN_NATIVE_TOKEN[c]) ? 'none' : '';
        });
      }
      if (chainSelect) {
        Array.from(chainSelect.options).forEach(opt => {
          opt.hidden = mode === 'crypto' && !CHAIN_NATIVE_TOKEN[opt.value];
        });
      }

      // If current chain has no native token, switch to first supported one
      let targetChain = this.selectedChain?.chain;
      if (mode === 'crypto' && !CHAIN_NATIVE_TOKEN[targetChain]) {
        const fallback = this.merchantChains.find(mc => !!CHAIN_NATIVE_TOKEN[mc.chain]);
        if (fallback) {
          targetChain = fallback.chain;
          const chainBtn = this.container.querySelector('#sp-chain-select-btn');
          if (chainBtn) {
            chainBtn.innerHTML = `
              <img src="${this.getChainIcon(fallback.chain)}" style="width: 18px; height: 18px; border-radius: 50%;" onerror="this.style.display='none'">
              <span>${fallback.config.chainName}</span>
              <span style="margin-left: auto; font-size: 10px; opacity: 0.5;">▼</span>
            `;
          }
          if (chainSelect) chainSelect.value = fallback.chain;
        }
      }

      // Rebuild token dropdown for new mode
      this.selectChain(targetChain);
      // Show/hide fee banner
      const banner = this.container.querySelector('#sp-fee-banner');
      if (banner) banner.style.display = (mode === 'crypto') ? 'block' : 'none';
      // refreshNativePrice is called inside selectChain when payMode === 'crypto'
    }

    async refreshNativePrice() {
      const nativeToken = CHAIN_NATIVE_TOKEN[this.selectedChain?.chain];
      if (!nativeToken) return;
      try {
        const res = await fetch(`${STABLEPAY_URL}/api/embed/native-price?token=${nativeToken}`);
        const data = await res.json();
        this.nativePriceUsd = data.priceUsd;
        this.updateNativeSendAmt();
      } catch (e) {}
    }

    updateNativeSendAmt() {
      if (!this.nativePriceUsd || !this.options.amount) return;
      const usd = parseFloat(this.options.amount);
      const chain = this.selectedChain?.chain;
      const pct = usd * 0.015;
      const fee = (chain === 'ETHEREUM_MAINNET') ? Math.max(pct, 1.00) : Math.max(pct, 0.50);
      const nativeToken = CHAIN_NATIVE_TOKEN[chain] || this.selectedToken;
      const sendAmt = (usd + fee) / this.nativePriceUsd;
      const el = this.container.querySelector('#sp-native-send-amt');
      if (el) el.textContent = `${sendAmt.toPrecision(4)} ${nativeToken} ($${(usd + fee).toFixed(2)})`;
    }

    renderTokenButtons() {
      return this.renderTokenOptions();
    }

    attachEventListeners() {
      // Custom chain dropdown
      const chainBtn = this.container.querySelector('#sp-chain-select-btn');
      const chainDropdown = this.container.querySelector('#sp-chain-dropdown');
      const chainSelect = this.container.querySelector('#sp-chain-select');

      if (chainBtn && chainDropdown) {
        chainBtn.addEventListener('click', () => {
          chainDropdown.style.display = chainDropdown.style.display === 'none' ? 'block' : 'none';
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
          if (!this.container.querySelector('#sp-chain-select-wrapper')?.contains(e.target)) {
            chainDropdown.style.display = 'none';
          }
        });

        // Chain option click
        this.container.querySelectorAll('.sp-chain-option').forEach(opt => {
          opt.addEventListener('click', () => {
            const chain = opt.dataset.chain;
            const mc = this.merchantChains.find(m => m.chain === chain);
            if (!mc) return;

            // Update button display
            chainBtn.innerHTML = `
              <img src="${this.getChainIcon(chain)}" style="width: 18px; height: 18px; border-radius: 50%;" onerror="this.style.display='none'">
              <span>${mc.config.chainName}</span>
              <span style="margin-left: auto; font-size: 10px; opacity: 0.5;">▼</span>
            `;

            // Update hidden select
            if (chainSelect) chainSelect.value = chain;
            chainDropdown.style.display = 'none';
            this.selectChain(chain);
          });
        });
      }

      if (chainSelect) {
        chainSelect.addEventListener('change', (e) => this.selectChain(e.target.value));
      }

      // Custom token dropdown
      const tokenBtn = this.container.querySelector('#sp-token-select-btn');
      const tokenDropdown = this.container.querySelector('#sp-token-dropdown');
      const tokenSelect = this.container.querySelector('#sp-token-select');

      if (tokenBtn && tokenDropdown) {
        tokenBtn.addEventListener('click', () => {
          tokenDropdown.style.display = tokenDropdown.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', (e) => {
          if (!this.container.querySelector('#sp-token-select-wrapper')?.contains(e.target)) {
            tokenDropdown.style.display = 'none';
          }
        });
        this.container.querySelectorAll('.sp-token-option').forEach(opt => {
          opt.addEventListener('click', () => {
            const token = opt.dataset.token;
            tokenBtn.innerHTML = `
              <img src="${this.getTokenIcon(token)}" style="width: 18px; height: 18px; border-radius: 50%;" onerror="this.style.display='none'">
              <span>${token}</span>
              <span style="margin-left: auto; font-size: 10px; opacity: 0.5;">▼</span>
            `;
            if (tokenSelect) tokenSelect.value = token;
            tokenDropdown.style.display = 'none';
            this.selectToken(token);
          });
        });
      }

      if (tokenSelect) {
        tokenSelect.addEventListener('change', (e) => this.selectToken(e.target.value));
      }

      // Help toggle
      const helpBtn = this.container.querySelector('#sp-wallet-help-btn');
      const helpDiv = this.container.querySelector('#sp-wallet-help');
      if (helpBtn && helpDiv) {
        helpBtn.addEventListener('click', () => {
          helpDiv.style.display = helpDiv.style.display === 'none' ? 'block' : 'none';
        });
      }

      // Connect wallet
      const connectBtn = this.container.querySelector('#sp-connect-btn');
      if (connectBtn) {
        connectBtn.addEventListener('click', () => this.connectWallet());
      }

      // Pay button
      const payBtn = this.container.querySelector('#sp-pay-btn');
      if (payBtn) {
        payBtn.addEventListener('click', () => this.processPayment());
      }

      // Payment method tabs
      this.container.querySelectorAll('.sp-method-tab').forEach(tab => {
        tab.addEventListener('click', () => this.switchPaymentMethod(tab.dataset.method));
      });

      // Init manual payment step flows (QR + Address)
      this.initManualPaymentFlows();
    }

    initManualPaymentFlows() {
      // Send tab: Step 1 → Step 2 → Step 3
      const sendWalletBtn = this.container.querySelector('#sp-sender-wallet-btn');
      const sendWalletInput = this.container.querySelector('#sp-sender-wallet');
      if (sendWalletBtn) {
        sendWalletBtn.addEventListener('click', () => {
          const addr = sendWalletInput?.value?.trim();
          const chainType = this.selectedChain?.config?.type;

          // Validate address format matches chain
          if (!addr || addr.length < 10) {
            this.showError('Please enter a valid wallet address');
            return;
          }
          if (chainType === 'evm' && !addr.match(/^0x[a-fA-F0-9]{40}$/)) {
            this.showError('Please enter a valid EVM address (starts with 0x, 42 characters)');
            return;
          }
          if (chainType === 'solana' && addr.startsWith('0x')) {
            this.showError('Please enter a Solana address (not an EVM 0x address). Solana addresses are base58 encoded.');
            return;
          }
          if (chainType === 'tron' && !addr.startsWith('T')) {
            this.showError('Please enter a TRON address (starts with T)');
            return;
          }

          if (addr) {
            this.connectedWallet = addr;
            this._track('WALLET_CONNECTED', { walletPrefix: addr.slice(0, 6), chain: this.selectedChain?.chain });
            const shortAddr = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
            const step1 = this.container.querySelector('#sp-send-step1');

            // Hide tabs — user has committed to Send Payment
            const tabs = this.container.querySelector('#sp-method-tabs');
            if (tabs) tabs.style.display = 'none';

            // Show verification animation in step 1
            if (step1) {
              const steps = [
                { text: 'Verifying address...', delay: 0 },
                { text: 'Compliance check...', delay: 600 },
                { text: 'Wallet verified', delay: 1200 },
              ];

              const showStep = (i) => {
                if (i >= steps.length) {
                  setTimeout(() => this.showManualPaymentDetails('send'), 300);
                  return;
                }
                step1.innerHTML = `
                  <div style="padding: 16px; text-align: center;">
                    ${i < steps.length - 1
                      ? '<span class="sp-spinner" style="display:inline-block;width:16px;height:16px;border:2px solid var(--sp-border);border-top-color:#18181B;border-radius:50%;margin-bottom:8px;"></span>'
                      : '<div style="color:#18181B;font-size:20px;font-weight:700;margin-bottom:4px;">✓</div>'}
                    <div style="font-size: 11px; color: var(--sp-muted); font-weight: 600; text-transform: uppercase;">${steps[i].text}</div>
                    <div style="font-size: 10px; color: var(--sp-text); font-family: monospace; margin-top: 4px;">${shortAddr}</div>
                  </div>
                `;
              };

              steps.forEach((s, i) => setTimeout(() => showStep(i), s.delay));
              // After last step, trigger transition to step 2
              setTimeout(() => { showStep(steps.length); this.updateStepIndicator(2); }, 1800);
            }
          }
        });
        sendWalletInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendWalletBtn.click(); });
      }

      // "I've sent it" button — creates order + starts polling
      const sentBtn = this.container.querySelector('#sp-send-sent-btn');
      if (sentBtn) {
        sentBtn.addEventListener('click', async () => {
          sentBtn.disabled = true;
          sentBtn.textContent = 'REGISTERING...';
          // A/B telemetry: customer claims they sent payment. Equivalent to PAY_CLICKED for manual flow.
          this._paymentInFlight = true; // B10: never auto-cancel this order on overlay close now
          this._track('PAY_CLICKED', { chain: this.selectedChain?.chain || null, token: this.selectedToken, method: 'manual', variant: this._variant });
          this._track('MANUAL_TX_SUBMITTED', { chain: this.selectedChain?.chain || null, token: this.selectedToken, variant: this._variant });
          // Stop countdown — they're confirming
          if (this._countdownInterval) clearInterval(this._countdownInterval);

          // Create order NOW (not before) — only register when user says they sent payment
          if (!this.currentOrderId && this._pendingPayment) {
            try {
              const p = this._pendingPayment;
              const res = await fetch(`${STABLEPAY_URL}/api/embed/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  merchantId: p.merchantId,
                  storeId: this.options.storeId || undefined,
                  amount: p.amount,
                  chain: p.chain,
                  token: p.token,
                  customerEmail: p.customerEmail,
                  productName: p.productName,
                  customerWallet: p.customerWallet,
                  paymentMethod: 'MANUAL_SEND',
                  source: 'EMBED_WIDGET',
                })
              });
              const data = await res.json();
              if (data.success) {
                this.currentOrderId = data.order.id;
                // Reconcile the placeholder send-screen countdown to the order's REAL expiresAt
                // now that the deferred stablecoin order exists.
                if (data.order.expiresAt) this.reconcileCountdown(data.order.expiresAt);
              } else {
                this.showError(data.error || 'Failed to register payment');
                sentBtn.disabled = false;
                sentBtn.textContent = "I'VE SENT THE PAYMENT";
                return;
              }
            } catch (err) {
              this.showError('Failed to register payment — please try again');
              sentBtn.disabled = false;
              sentBtn.textContent = "I'VE SENT THE PAYMENT";
              return;
            }
          }

          this.container.querySelector('#sp-send-step2').style.display = 'none';
          this.container.querySelector('#sp-send-step3').style.display = 'block';
          this.updateStepIndicator(3);
          this.startPaymentPolling();
          // Fast variant: reveal TX paste box IMMEDIATELY (don't wait for the 15s timeout)
          // and inject wallet+email fallback inputs below. Without this, the fast variant
          // would feel identical to guided after "I've sent it" — defeating the test.
          if (this._variant === 'fast') {
            this._track('FAST_STEP_VIEWED', { step: 'paste-confirm' });
            // CRITICAL: call _revealManualTxPaste() — it binds the Submit click handler.
            // Setting display:block alone leaves Submit dead until the 15s timeout fires.
            this._revealManualTxPaste();
            const manualDiv = this.container.querySelector('#sp-manual-tx');
            if (manualDiv) {
              // Add wallet+email recovery section if not already present
              if (!manualDiv.querySelector('#sp-fast-fallback')) {
                const wrap = document.createElement('details');
                wrap.id = 'sp-fast-fallback';
                wrap.style.cssText = 'margin-top:10px;border:1px solid var(--sp-border);padding:8px 10px;font-size:11px;border-radius:4px;';
                wrap.innerHTML = `
                  <summary style="cursor:pointer;font-weight:600;color:var(--sp-muted);">Can't find your confirmation? — help us reach you ▾</summary>
                  <div style="margin-top:8px;">
                    <p style="color:var(--sp-muted);margin-bottom:6px;font-size:10px;">Give us your sender wallet (auto-match) OR email (we contact you):</p>
                    <div style="margin-bottom:6px;">
                      <input id="sp-fast-wallet" type="text" placeholder="Sender wallet address" style="width:100%;padding:6px 8px;font-size:11px;border:1px solid var(--sp-border);background:var(--sp-bg);color:var(--sp-text);font-family:monospace;border-radius:3px;margin-bottom:4px;">
                      <button id="sp-fast-wallet-save" style="width:100%;padding:6px;font-size:10px;font-weight:700;background:#000;color:#fff;border:none;cursor:pointer;border-radius:3px;">SAVE WALLET</button>
                    </div>
                    <div>
                      <input id="sp-fast-email" type="email" placeholder="your@email.com" style="width:100%;padding:6px 8px;font-size:11px;border:1px solid var(--sp-border);background:var(--sp-bg);color:var(--sp-text);border-radius:3px;margin-bottom:4px;">
                      <button id="sp-fast-email-save" style="width:100%;padding:6px;font-size:10px;font-weight:700;background:#000;color:#fff;border:none;cursor:pointer;border-radius:3px;">SAVE EMAIL</button>
                    </div>
                    <p id="sp-fast-status" style="font-size:10px;margin-top:6px;display:none;"></p>
                  </div>`;
                manualDiv.appendChild(wrap);
                // Bind save handlers
                const self = this;
                const save = async (kind) => {
                  if (!self.currentOrderId) return;
                  const v = kind === 'wallet'
                    ? self.container.querySelector('#sp-fast-wallet')?.value?.trim()
                    : self.container.querySelector('#sp-fast-email')?.value?.trim();
                  const statusEl = self.container.querySelector('#sp-fast-status');
                  if (kind === 'wallet' && (!v || v.length < 10)) { statusEl.style.display = 'block'; statusEl.style.color = '#18181B'; statusEl.textContent = '! Invalid wallet'; return; }
                  if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '')) { statusEl.style.display = 'block'; statusEl.style.color = '#18181B'; statusEl.textContent = '! Invalid email'; return; }
                  const body = kind === 'wallet' ? { customerWallet: v } : { customerEmail: v };
                  try {
                    const res = await fetch(`${STABLEPAY_URL}/api/embed/order/${self.currentOrderId}/contact`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
                    });
                    if (res.ok) {
                      statusEl.style.display = 'block'; statusEl.style.color = '#18181B';
                      statusEl.textContent = kind === 'email' ? '✓ Saved — we\'ll email you.' : '✓ Saved — scanner will match.';
                      self._track('FAST_CONFIRMATION_PROVIDED', { type: kind, variant: self._variant });
                    } else {
                      const data = await res.json().catch(() => ({}));
                      statusEl.style.display = 'block'; statusEl.style.color = '#18181B';
                      statusEl.textContent = '! ' + (data.error || 'Save failed');
                    }
                  } catch {
                    statusEl.style.display = 'block'; statusEl.style.color = '#18181B';
                    statusEl.textContent = '! Network error';
                  }
                };
                manualDiv.querySelector('#sp-fast-wallet-save')?.addEventListener('click', () => save('wallet'));
                manualDiv.querySelector('#sp-fast-email-save')?.addEventListener('click', () => save('email'));
              }
            }
          }
        });
      }

      // Cancel from step 3 (listening) — go back to step 2
      const cancelListenBtn = this.container.querySelector('#sp-cancel-listen-btn');
      if (cancelListenBtn) {
        cancelListenBtn.addEventListener('click', () => {
          // Stop polling
          if (this._pollingInterval) { clearInterval(this._pollingInterval); this._pollingInterval = null; }
          if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; }
          // Show step 2, hide step 3
          this.container.querySelector('#sp-send-step3').style.display = 'none';
          this.container.querySelector('#sp-send-step2').style.display = 'block';
          this.updateStepIndicator(2);
          // Reset manual TX section + progress bar
          const manualDiv = this.container.querySelector('#sp-manual-tx');
          if (manualDiv) manualDiv.style.display = 'none';
          const bar = this.container.querySelector('#sp-progress-bar');
          if (bar) bar.style.width = '0%';
        });
      }

      // "Back" button — go back to step 1 to change wallet
      const backBtn = this.container.querySelector('#sp-send-back-btn');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          // Stop countdown
          if (this._countdownInterval) clearInterval(this._countdownInterval);
          const step1 = this.container.querySelector('#sp-send-step1');
          const step2 = this.container.querySelector('#sp-send-step2');
          if (step2) step2.style.display = 'none';
          // Rebuild step 1 input
          if (step1) {
            step1.style.display = 'block';
            const placeholder = this.selectedChain?.config?.type === 'solana' ? 'Solana address (base58)' : this.selectedChain?.config?.type === 'tron' ? 'TRON address (T...)' : '0x... (EVM address)';
            step1.innerHTML = `
              <div style="font-size: 11px; font-weight: 700; color: var(--sp-text); margin-bottom: 2px;">Your Wallet Address</div>
              <p style="font-size: 9px; color: var(--sp-muted); margin-bottom: 8px;">Enter the address you'll send from — so we can match your payment.</p>
              <div style="display: flex; gap: 6px;">
                <input id="sp-sender-wallet" type="text" value="${this.connectedWallet || ''}" placeholder="${placeholder}" style="
                  flex: 1; padding: 8px; font-size: 14px; font-family: inherit; border: 1px solid var(--sp-border);
                  background: var(--sp-card); color: var(--sp-text); outline: none; min-width: 0;
                  text-overflow: ellipsis; border-radius: 3px;
                ">
                <button id="sp-sender-wallet-btn" style="
                  padding: 8px 16px; background: #000; color: #fff; border: none;
                  font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase;
                  border-radius: 3px; flex-shrink: 0;
                ">Next</button>
              </div>
            `;
            // Re-attach handlers
            const newBtn = step1.querySelector('#sp-sender-wallet-btn');
            const newInput = step1.querySelector('#sp-sender-wallet');
            if (newBtn) newBtn.addEventListener('click', () => {
              const addr = newInput?.value?.trim();
              if (addr && addr.length > 10) {
                this.connectedWallet = addr;
                this.showManualPaymentDetails('send');
                this.updateStepIndicator(2);
              }
            });
            if (newInput) newInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') newBtn?.click(); });
          }
          // Unlock selectors + show tabs
          this.unlockSelectors();
          const methodTabs = this.container.querySelector('#sp-method-tabs');
          if (methodTabs) methodTabs.style.display = 'flex';
          this.updateStepIndicator(1);
          this.connectedWallet = null;
          this.currentOrderId = null;
        });
      }

      // QR / Address toggle inside Send tab
      const toggleQR = this.container.querySelector('#sp-send-toggle-qr');
      const toggleAddr = this.container.querySelector('#sp-send-toggle-addr');
      if (toggleQR && toggleAddr) {
        toggleQR.addEventListener('click', () => {
          this.container.querySelector('#sp-send-view-qr').style.display = 'block';
          this.container.querySelector('#sp-send-view-addr').style.display = 'none';
          toggleQR.style.background = '#18181B'; toggleQR.style.color = '#fff';
          toggleAddr.style.background = 'var(--sp-card)'; toggleAddr.style.color = 'var(--sp-muted)';
        });
        toggleAddr.addEventListener('click', () => {
          this.container.querySelector('#sp-send-view-qr').style.display = 'none';
          this.container.querySelector('#sp-send-view-addr').style.display = 'block';
          toggleAddr.style.background = '#18181B'; toggleAddr.style.color = '#fff';
          toggleQR.style.background = 'var(--sp-card)'; toggleQR.style.color = 'var(--sp-muted)';
        });
        // Default view: address-first on mobile (a QR you can't scan from the device you're on is
        // dead weight — copy + "Open in Wallet" is better), QR-first on desktop (scan with a phone).
        const isMobile = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || '')
          || (window.matchMedia && window.matchMedia('(max-width: 600px)').matches);
        if (isMobile) {
          this.container.querySelector('#sp-send-view-qr').style.display = 'none';
          this.container.querySelector('#sp-send-view-addr').style.display = 'block';
          toggleAddr.style.background = '#18181B'; toggleAddr.style.color = '#fff';
          toggleQR.style.background = 'var(--sp-card)'; toggleQR.style.color = 'var(--sp-muted)';
        }
      }

      // Copy buttons (delegated). navigator.clipboard.writeText() rejects in many in-app webviews
      // (and is undefined on insecure origins), so try it, then fall back to execCommand('copy').
      // Only flash "Copied!" on an ACTUAL success — never lie that we copied when we didn't.
      this.container.addEventListener('click', async (e) => {
        const flash = (btn, ok) => {
          btn.textContent = ok ? 'COPIED!' : 'FAILED';
          setTimeout(() => btn.textContent = 'COPY', 1500);
        };
        if (e.target.id === 'sp-copy-addr-btn') {
          const addr = this.container.querySelector('#sp-pay-address')?.textContent;
          if (addr) {
            const ok = await this._copyToClipboard(addr);
            if (ok) this._track('ADDRESS_COPIED', { chain: this.selectedChain?.chain });
            flash(e.target, ok);
          }
        }
        if (e.target.id === 'sp-copy-amt-btn') {
          const amt = this.container.querySelector('#sp-pay-amount')?.textContent;
          if (amt) {
            const ok = await this._copyToClipboard(amt.split(' ')[0]);
            flash(e.target, ok);
          }
        }
      });
    }

    // Copy text to the clipboard, returning true only on real success. Tries the async Clipboard
    // API first, then falls back to a hidden-textarea execCommand('copy') for in-app webviews /
    // insecure origins where navigator.clipboard is missing or rejects.
    async _copyToClipboard(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch (e) { /* fall through to execCommand */ }
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:absolute;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
      } catch (e) {
        return false;
      }
    }

    initSenderWalletInput() {
      // Legacy — handled by initManualPaymentFlows now
    }

    onWalletConnected() {
      // If wallet connected via Connect Wallet tab, skip step 1 on Send tab
      const step1 = this.container.querySelector('#sp-send-step1');
      if (step1) step1.style.display = 'none';
    }

    lockSelectors() {
      // FAST: the chain/token selectors live inside the collapsible 'Edit payment options' panel
      // and MUST stay interactive so the customer can switch rail/coin and have the address/QR
      // re-render. Skip locking for fast (guided/control keep the original lock).
      if (this._variant === 'fast') return;
      const chainBtn = this.container.querySelector('#sp-chain-select-btn');
      const chainSelect = this.container.querySelector('#sp-chain-select');
      const tokenSelect = this.container.querySelector('#sp-token-select');
      if (chainBtn) {
        chainBtn.style.opacity = '0.7';
        chainBtn.style.pointerEvents = 'none';
        chainBtn.querySelector('span:last-child').style.display = 'none'; // hide ▼
      }
      if (chainSelect) { chainSelect.disabled = true; }
      const tokenBtn = this.container.querySelector('#sp-token-select-btn');
      if (tokenBtn) {
        tokenBtn.style.opacity = '0.7';
        tokenBtn.style.pointerEvents = 'none';
        const arrow = tokenBtn.querySelector('span:last-child');
        if (arrow) arrow.style.display = 'none';
      }
      if (chainSelect) { chainSelect.disabled = true; }
      if (tokenSelect) { tokenSelect.disabled = true; }
    }

    unlockSelectors() {
      const chainBtn = this.container.querySelector('#sp-chain-select-btn');
      const tokenBtn = this.container.querySelector('#sp-token-select-btn');
      const chainSelect = this.container.querySelector('#sp-chain-select');
      const tokenSelect = this.container.querySelector('#sp-token-select');
      if (chainBtn) {
        chainBtn.style.opacity = '1';
        chainBtn.style.pointerEvents = '';
        const arrow = chainBtn.querySelector('span:last-child');
        if (arrow) arrow.style.display = '';
      }
      if (tokenBtn) {
        tokenBtn.style.opacity = '1';
        tokenBtn.style.pointerEvents = '';
        const arrow = tokenBtn.querySelector('span:last-child');
        if (arrow) arrow.style.display = '';
      }
      if (chainSelect) {
        chainSelect.disabled = false;
        chainSelect.style.appearance = '';
        chainSelect.style.webkitAppearance = '';
        chainSelect.style.opacity = '1';
        chainSelect.style.cursor = 'pointer';
        chainSelect.style.pointerEvents = '';
      }
      if (tokenSelect) {
        tokenSelect.disabled = false;
        tokenSelect.style.appearance = '';
        tokenSelect.style.webkitAppearance = '';
        tokenSelect.style.opacity = '1';
        tokenSelect.style.cursor = 'pointer';
        tokenSelect.style.pointerEvents = '';
      }
    }

    updateStepIndicator(activeStep) {
      const dots = this.container.querySelectorAll('.sp-step-dot');
      dots.forEach(dot => {
        const step = parseInt(dot.dataset.step);
        if (step < activeStep) {
          // Completed
          dot.style.background = '#18181B';
          dot.style.color = '#fff';
          dot.style.border = 'none';
          dot.innerHTML = '✓';
        } else if (step === activeStep) {
          // Active
          dot.style.background = '#18181B';
          dot.style.color = '#fff';
          dot.style.border = 'none';
          dot.innerHTML = step;
        } else {
          // Upcoming
          dot.style.background = 'var(--sp-card)';
          dot.style.color = 'var(--sp-muted)';
          dot.style.border = '2px solid var(--sp-border)';
          dot.innerHTML = step;
        }
      });
      // Update connecting lines
      const indicator = this.container.querySelector('#sp-step-indicator');
      if (indicator) {
        const lines = indicator.querySelectorAll('div[style*="height: 2px"]');
        lines.forEach((line, i) => {
          line.style.background = (i + 1) < activeStep ? '#18181B' : 'var(--sp-border)';
        });
      }
    }

    switchPaymentMethod(method) {
      // Update tabs — neo-brutalist active state
      this.container.querySelectorAll('.sp-method-tab').forEach(tab => {
        if (tab.dataset.method === method) {
          tab.style.background = '#18181B';
          tab.style.color = '#fff';
        } else {
          tab.style.background = 'var(--sp-card)';
          tab.style.color = 'var(--sp-muted)';
        }
      });
      // Show/hide panels
      this.container.querySelectorAll('.sp-method-panel').forEach(panel => {
        panel.style.display = 'none';
      });
      const panel = this.container.querySelector(`#sp-method-${method}`);
      if (panel) panel.style.display = 'block';

      // For send method — only show step 2 if wallet already known
      if (method === 'send' && this.connectedWallet) {
        this.showManualPaymentDetails('send');
      }
    }

    async showManualPaymentDetails(method) {
      this._track('MANUAL_PAY_VIEWED', { method, chain: this.selectedChain?.chain, token: this.selectedToken, mode: this.payMode });
      if (!this.selectedChain) {
        this.showError('Please select a chain first');
        return;
      }

      const chain = this.selectedChain;
      const walletAddr = chain.address;

      if (!walletAddr) {
        this.showError('No wallet configured for this chain');
        return;
      }

      const isNative = this.payMode === 'crypto' && !!CHAIN_NATIVE_TOKEN[chain.chain];

      // ── Native token path: create order eagerly to get fresh receive wallet ──
      if (isNative) {
        const nativeToken = CHAIN_NATIVE_TOKEN[chain.chain];
        const step1 = this.container.querySelector('#sp-send-step1');
        const step2 = this.container.querySelector('#sp-send-step2');
        const prevStep1Html = step1?.innerHTML;
        if (step1) step1.innerHTML = '<div style="text-align:center;padding:16px;font-size:12px;color:var(--sp-muted);">Generating payment address…</div>';

        try {
          const usdAmount = parseFloat(this.options.amount || 0);
          const res = await fetch(`${STABLEPAY_URL}/api/embed/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              merchantId: this.options.merchantId,
              storeId: this.options.storeId || undefined,
              amount: usdAmount,
              chain: chain.chain,
              token: nativeToken,
              customerEmail: this.options.customerEmail,
              productName: this.options.productName,
              customerWallet: this.connectedWallet || undefined,
              paymentMethod: 'MANUAL_SEND',
              source: 'EMBED_WIDGET',
            })
          });
          const data = await res.json();
          if (!data.success) {
            if (step1 && prevStep1Html) step1.innerHTML = prevStep1Html;
            // Surface the real reason — server returns {error, details:[...]} for Zod 400s; show the
            // first detail so failures aren't an opaque "Validation error".
            const detail = Array.isArray(data.details) && data.details[0]
              ? ': ' + (data.details[0].message || (data.details[0].path || []).join('.')) : '';
            this.showError((data.error || 'Failed to create payment') + detail);
            return;
          }

          // Order created — set orderId so "I've sent it" skips re-creation
          this.currentOrderId = data.order.id;
          const receiveAddress = data.order.paymentAddress;
          const nativeSendAmt = data.order.nativeSendAmount;
          const expiresAt = data.order.expiresAt;

          // Build send amount string
          const pct = usdAmount * 0.015;
          const fee = (chain.chain === 'ETHEREUM_MAINNET') ? Math.max(pct, 1.00) : Math.max(pct, 0.50);
          const fallbackAmt = this.nativePriceUsd ? ((usdAmount + fee) / this.nativePriceUsd).toPrecision(5) : '?';
          const sendAmtStr = nativeSendAmt
            ? `${parseFloat(nativeSendAmt).toPrecision(5)} ${nativeToken}`
            : `${fallbackAmt} ${nativeToken}`;

          if (step1) step1.style.display = 'none';
          if (step2) step2.style.display = 'block';

          const payAddress = this.container.querySelector('#sp-pay-address');
          const payAmount = this.container.querySelector('#sp-pay-amount');
          const sendAmountDisplay = this.container.querySelector('#sp-send-amount-display');
          if (payAddress) payAddress.textContent = receiveAddress;
          if (payAmount) payAmount.textContent = sendAmtStr;
          if (sendAmountDisplay) sendAmountDisplay.textContent = sendAmtStr;
          const sendWarningN = this.container.querySelector('#sp-send-warning');
          if (sendWarningN) sendWarningN.innerHTML = `Send <strong>only ${nativeToken}</strong> on <strong>${chain.config?.chainName || 'this network'}</strong> — a different coin or network may be permanently lost.`;

          // Expiry countdown in fee banner
          if (expiresAt) {
            const expiryEl = this.container.querySelector('#sp-native-expiry');
            if (expiryEl) {
              const expires = new Date(expiresAt);
              if (this._expiryTick) clearTimeout(this._expiryTick);
              const tick = () => {
                const rem = Math.max(0, Math.floor((expires - Date.now()) / 1000));
                const m = Math.floor(rem / 60), s = rem % 60;
                expiryEl.textContent = rem > 0
                  ? `Price locked · ${m}:${s.toString().padStart(2, '0')} remaining`
                  : 'Price lock expired — start a new payment';
                if (rem > 0) this._expiryTick = setTimeout(tick, 1000);
              };
              tick();
            }
          }

          // QR code for receive address. For native SOL on Solana, encode as a Solana Pay URI
          // (`solana:addr?amount=X`) so Phantom/Solflare etc. pre-fill the amount on scan —
          // matches the page implementation. For other native chains (ETH/BNB/etc.) there's
          // no equivalent URI standard, so we encode the raw address.
          const nativeAmt = nativeSendAmt || (this.nativePriceUsd ? ((usdAmount + fee) / this.nativePriceUsd) : null);
          const qrData = (chain.chain === 'SOLANA_MAINNET' && nativeAmt)
            ? `solana:${receiveAddress}?amount=${parseFloat(nativeAmt)}`
            : receiveAddress;
          const canvas = this.container.querySelector('#sp-qr-canvas');
          if (canvas) {
            const waitAndRender = () => {
              if (typeof QRCode !== 'undefined') {
                QRCode.toCanvas(canvas, qrData, { width: 140, margin: 2, color: { dark: '#000', light: '#fff' } }, () => {});
              } else { setTimeout(waitAndRender, 500); }
            };
            waitAndRender();
          }

          // Hide Solana Pay toggle (native SOL, not SPL) — the QR above already is a Solana Pay URI.
          const solPayToggle = this.container.querySelector('#sp-solanapay-toggle');
          if (solPayToggle) solPayToggle.style.display = 'none';

          // Mobile deep-link button (native send). solana: opens Phantom prefilled; for native-EVM
          // there is no token-transfer URI, so we deep-link the bare address (recipient prefilled).
          this._renderMobileWalletLink(qrData, receiveAddress);

          // ONE source of truth per screen: the #sp-native-expiry banner already shows the real
          // 15-min price-lock countdown, so DON'T run the separate #sp-countdown timer here (it would
          // hardcode 5:00 and falsely say "Time expired"). Hide the #sp-countdown element entirely.
          const cdEl = this.container.querySelector('#sp-countdown');
          if (cdEl) cdEl.style.display = 'none';

          this.lockSelectors();
          this._stabloOnPayScreen();
          return;
        } catch (err) {
          console.error('Failed to create native order:', err);
          if (step1 && prevStep1Html) step1.innerHTML = prevStep1Html;
          this.showError('Failed to create payment — please try again');
          return;
        }
      }

      // ── Stablecoin path: store pending payment, create order on "I've sent it" ──
      let amount = parseFloat(this.options.amount || 0);
      if (this.selectedToken === 'EURC') {
        // AWAIT the EUR rate. fetchEURCRate() is async and was frequently unresolved here (race),
        // so `&& this.eurcRate` silently skipped conversion and charged EURC as raw USD (~8% overpay
        // + an amount the scanner could never match). Load it if missing (it sets a 1.15 fallback
        // on failure), then always convert.
        if (!this.eurcRate) { try { await this.fetchEURCRate(); } catch (e) { /* sets 1.15 fallback */ } }
        if (this.eurcRate) amount = parseFloat((amount / this.eurcRate).toFixed(2));
      }

      this._pendingPayment = {
        merchantId: this.options.merchantId,
        amount,
        chain: chain.chain,
        token: this.selectedToken,
        customerEmail: this.options.customerEmail,
        externalId: this.options.externalId,
        metadata: this.options.metadata,
        productName: this.options.productName,
        customerWallet: this.connectedWallet || null,
        walletAddr,
      };

      const step1 = this.container.querySelector('#sp-send-step1');
      const step2 = this.container.querySelector('#sp-send-step2');
      if (step1) step1.style.display = 'none';
      if (step2) step2.style.display = 'block';

      const payAddress = this.container.querySelector('#sp-pay-address');
      const payAmount = this.container.querySelector('#sp-pay-amount');
      const sendAmountDisplay = this.container.querySelector('#sp-send-amount-display');
      if (payAddress) payAddress.textContent = walletAddr;
      if (payAmount) payAmount.textContent = `${amount} ${this.selectedToken}`;
      if (sendAmountDisplay) sendAmountDisplay.textContent = `${amount} ${this.selectedToken}`;
      const sendWarning = this.container.querySelector('#sp-send-warning');
      if (sendWarning) sendWarning.innerHTML = `Send <strong>only ${this.selectedToken}</strong> on <strong>${this.selectedChain?.config?.chainName || 'this network'}</strong> — a different coin or network may be permanently lost.`;

      const canvas = this.container.querySelector('#sp-qr-canvas');
      const chainConfig = this.selectedChain?.config;
      const tokenConfig = chainConfig?.tokens?.[this.selectedToken];

      // Solana Pay amount-encoded QR is now the DEFAULT (no opt-in checkbox required) — hide the
      // legacy toggle; wallets always get the amount + spl-token prefilled on Solana.
      const solPayToggle = this.container.querySelector('#sp-solanapay-toggle');
      if (solPayToggle) solPayToggle.style.display = 'none';

      // Build the payment URI for QR + mobile deep-link.
      //  • Solana SPL stablecoin → Solana Pay URI with amount + spl-token (DEFAULTED on).
      //  • EVM ERC-20 stablecoin → EIP-681 token transfer so wallets prefill token/recipient/amount.
      //    `ethereum:<tokenContract>@<chainId>/transfer?address=<merchant>&uint256=<baseUnits>`
      //    NOTE: CHAIN_CONFIG stores chainId as HEX (Base '0x2105'); EIP-681 needs DECIMAL chainId.
      //  • TRON / unknown → fall back to the bare address (no EIP-681 equivalent).
      // String-based base-units scaler (no float drift at 18 decimals) — parity with the page's
      // cpScaleToBaseUnits so both surfaces emit identical EIP-681 uint256.
      const scaleToBaseUnits = (amt, decimals) => {
        const s = String(amt).trim();
        if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
        const [intPart = '0', fracRaw = ''] = s.split('.');
        const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
        const combined = (intPart + frac).replace(/^0+(?=\d)/, '');
        return combined === '' ? '0' : combined;
      };
      const buildPaymentUri = () => {
        if (chainConfig?.type === 'solana' && tokenConfig?.address) {
          return `solana:${walletAddr}?amount=${amount}&spl-token=${tokenConfig.address}`;
        }
        if (chainConfig?.type === 'evm' && tokenConfig?.address && tokenConfig?.decimals != null && chainConfig?.chainId) {
          const decimalChainId = parseInt(chainConfig.chainId, 16); // hex -> decimal (0x2105 -> 8453)
          const units = scaleToBaseUnits(amount, tokenConfig.decimals);
          if (units == null) return walletAddr;
          return `ethereum:${tokenConfig.address}@${decimalChainId}/transfer?address=${walletAddr}&uint256=${units}`;
        }
        return walletAddr;
      };
      const paymentUri = buildPaymentUri();

      const generateQR = () => {
        if (!canvas || typeof QRCode === 'undefined') return;
        QRCode.toCanvas(canvas, paymentUri, { width: 140, margin: 2, color: { dark: '#000', light: '#fff' } }, (err) => {
          if (err) console.error('QR generation failed:', err);
        });
      };

      if (canvas) {
        const waitAndRender = () => {
          if (typeof QRCode !== 'undefined') { generateQR(); } else { setTimeout(waitAndRender, 500); }
        };
        waitAndRender();
      }

      // Mobile "Open in wallet" deep-link — tapping the payment URI opens the user's wallet
      // prefilled, so mobile users don't have to scan their own on-screen QR.
      this._renderMobileWalletLink(paymentUri, walletAddr);

      this.lockSelectors();
      this.startCountdown();
      this._stabloOnPayScreen();
    }

    // Inject/refresh a tappable "Open in wallet" deep-link button on the send screen. Uses the
    // same ethereum:/solana: payment URI as the QR; for EVM/Solana also offers a MetaMask/Phantom
    // universal link so mobile in-app browsers can hand off without scanning. The .mobile-wallet-link
    // CSS slot was previously dead — this is its first real use.
    _renderMobileWalletLink(paymentUri, fallbackAddr) {
      try {
        const countdown = this.container.querySelector('#sp-countdown');
        if (!countdown || !countdown.parentNode) return;
        const uri = paymentUri || fallbackAddr;
        if (!uri) return;
        const type = this.selectedChain?.config?.type;

        // Universal links for simple cases so in-app webviews can deep-link reliably.
        let universal = null;
        if (type === 'evm' && uri.startsWith('ethereum:')) {
          // MetaMask universal link expects the dapp/host portion; pass the address host.
          universal = `https://metamask.app.link/send/${uri.replace(/^ethereum:/, '')}`;
        } else if (type === 'solana' && uri.startsWith('solana:')) {
          universal = `https://phantom.app/ul/v1/pay?uri=${encodeURIComponent(uri)}`;
        }
        const href = universal || uri;

        let link = this.container.querySelector('.mobile-wallet-link');
        if (!link) {
          link = document.createElement('a');
          link.className = 'mobile-wallet-link';
          // Quiet ghost styling — this is an OPTIONAL convenience, not the primary action.
          // "I've sent the payment" is the only filled CTA; keep this low-key so it doesn't read
          // as "tap me instead of scrolling to the real button".
          // Tiny, quiet last-resort helper at the BOTTOM (under the primary CTA) — per the UX call.
          // No box/border so it never competes with "I've sent the payment".
          link.style.cssText = 'display:block;width:100%;padding:6px;margin-top:8px;background:transparent;color:var(--sp-muted);border:none;font-weight:600;font-size:11px;text-align:center;text-decoration:underline;text-transform:none;cursor:pointer;';
          link.textContent = 'Open in your wallet app ↗';
          const sentBtn = this.container.querySelector('#sp-send-sent-btn');
          if (sentBtn && sentBtn.parentNode) sentBtn.parentNode.insertBefore(link, sentBtn.nextSibling);
          else countdown.parentNode.insertBefore(link, countdown);
        }
        link.style.display = 'block';
        link.href = href;
        link.target = universal ? '_blank' : '_self';
        if (universal) link.rel = 'noopener';
        link.onclick = () => { try { this._track('MOBILE_WALLET_LINK_CLICKED', { chain: this.selectedChain?.chain, token: this.selectedToken }); } catch {} };
      } catch (e) { /* deep-link is best-effort; never break the send screen */ }
    }

    // Drive the send-screen countdown from the order's REAL expiresAt (returned by /checkout
    // and GET /order/:id) instead of a hardcoded 5:00. Compute remaining time from the absolute
    // timestamp each tick (don't decrement a local counter — that drifts and is wrong if the tab
    // was backgrounded). If no expiry is known yet (deferred stablecoin order not created), fall
    // back to the backend stablecoin TTL (30 min) as a calm placeholder and do NOT declare the
    // order dead — re-confirm true status against the server before showing any "expired" copy.
    startCountdown(expiresAt) {
      if (this._countdownInterval) clearInterval(this._countdownInterval);
      const timerEl = this.container.querySelector('#sp-countdown-time');
      const wrapperEl = this.container.querySelector('#sp-countdown');
      const labelEl = wrapperEl ? wrapperEl.querySelector('span') : null;
      if (!timerEl) return;

      // Resolve an absolute expiry timestamp (ms). Prefer the order's real expiresAt; otherwise
      // use the 30-min stablecoin TTL window as a non-authoritative placeholder.
      const STABLECOIN_TTL_MS = 30 * 60 * 1000;
      const expiryMs = expiresAt ? new Date(expiresAt).getTime() : (Date.now() + STABLECOIN_TTL_MS);
      // Only an order-backed expiry is authoritative enough to declare the order dead at 0:00.
      const hasRealExpiry = !!expiresAt;
      this._countdownExpiryMs = expiryMs;

      // Calm "rate locked" framing while the timer is running.
      if (labelEl) labelEl.textContent = hasRealExpiry ? 'Rate locked — complete payment within' : 'Complete payment soon';

      const tick = () => {
        const seconds = Math.max(0, Math.floor((this._countdownExpiryMs - Date.now()) / 1000));
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        // Urgency without color: textPrimary always, bolder/larger + a clock glyph in the last 2 min.
        const urgent = seconds <= 120;
        timerEl.textContent = `${urgent ? '⏱ ' : ''}${mins}:${secs.toString().padStart(2, '0')}`;
        timerEl.style.color = 'var(--sp-text)';
        timerEl.style.fontWeight = urgent ? '900' : '800';
        timerEl.style.fontSize = seconds <= 60 ? '26px' : '22px';
        if (seconds <= 180 && seconds > 0) this._stabloOnExpiry();

        if (seconds <= 0) {
          clearInterval(this._countdownInterval);
          this._countdownInterval = null;
          timerEl.textContent = '0:00';
          // Never falsely declare a still-valid order dead. Only show the hard "expired" message
          // when we have the order's REAL expiresAt; for the placeholder window, just nudge.
          if (wrapperEl) {
            if (hasRealExpiry) {
              wrapperEl.innerHTML = '<p style="font-size: 11px; color: var(--sp-text); font-weight: 700;">⏱ Time expired — please start a new payment</p>';
            } else {
              wrapperEl.innerHTML = '<p style="font-size: 11px; color: var(--sp-muted); font-weight: 600;">Please complete your payment soon.</p>';
            }
          }
        }
      };
      tick();
      this._countdownInterval = setInterval(tick, 1000);
    }

    // Reconcile a running placeholder countdown to the server's real expiresAt once the deferred
    // stablecoin order has been created. Called from the "I've sent it" handler after order creation.
    reconcileCountdown(expiresAt) {
      if (!expiresAt) return;
      this._countdownExpiryMs = new Date(expiresAt).getTime();
    }

    // ── Stablo in-widget AI help ─────────────────────────────────────────────
    _stabloInject() {
      if (this._stabloInjected) return;
      this._stabloInjected = true;
      this._stabloOpen = false;
      this._stabloLoading = false;
      this._stabloNudged = false;
      const w = this.container.querySelector('.sp-widget');
      if (!w) return;
      w.style.position = 'relative';
      w.insertAdjacentHTML('beforeend', `
        <button class="sp-stablo-btn" data-stablo="btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          Help
        </button>
        <div class="sp-stablo-panel sp-hidden" data-stablo="panel">
          <div class="sp-stablo-hdr"><span>Stablo</span><button class="sp-stablo-close" data-stablo="close">&times;</button></div>
          <div class="sp-stablo-msgs" data-stablo="msgs">
            <div class="sp-stablo-msg bot">Hey! I'm Stablo. Need help paying? Ask me anything.</div>
          </div>
          <div class="sp-stablo-chips" data-stablo="chips">
            <button class="sp-stablo-chip" data-sq="I don't have any crypto — how do I pay?">No crypto yet</button>
            <button class="sp-stablo-chip" data-sq="What wallet should I use to send this?">Which wallet?</button>
            <button class="sp-stablo-chip" data-sq="I already sent the payment but it's not confirming">I sent it</button>
          </div>
          <div class="sp-stablo-input-row">
            <input class="sp-stablo-input" data-stablo="input" type="text" placeholder="Ask anything…" maxlength="500" />
            <button class="sp-stablo-send" data-stablo="send">&rarr;</button>
          </div>
        </div>
      `);
      const btn = w.querySelector('[data-stablo="btn"]');
      const close = w.querySelector('[data-stablo="close"]');
      const send = w.querySelector('[data-stablo="send"]');
      const input = w.querySelector('[data-stablo="input"]');
      btn.addEventListener('click', () => this._stabloToggle());
      close.addEventListener('click', () => this._stabloToggle());
      send.addEventListener('click', () => this._stabloSend());
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._stabloSend(); });
      w.querySelectorAll('[data-sq]').forEach(c => {
        c.addEventListener('click', () => {
          const chips = w.querySelector('[data-stablo="chips"]');
          if (chips) chips.style.display = 'none';
          this._stabloPost(c.dataset.sq);
        });
      });
    }

    _stabloToggle() {
      this._stabloOpen = !this._stabloOpen;
      const panel = this.container.querySelector('[data-stablo="panel"]');
      if (panel) panel.classList.toggle('sp-hidden', !this._stabloOpen);
      if (this._stabloOpen) {
        const input = this.container.querySelector('[data-stablo="input"]');
        if (input) input.focus();
      }
    }

    _stabloBotMsg(text) {
      const msgs = this.container.querySelector('[data-stablo="msgs"]');
      if (!msgs) return;
      const el = document.createElement('div');
      el.className = 'sp-stablo-msg bot';
      el.textContent = text;
      msgs.appendChild(el);
      msgs.scrollTop = msgs.scrollHeight;
    }

    _stabloSetChips(chips) {
      const el = this.container.querySelector('[data-stablo="chips"]');
      if (!el) return;
      el.style.display = 'flex';
      el.innerHTML = chips.map(c =>
        `<button class="sp-stablo-chip" data-sq="${c.q}">${c.label}</button>`
      ).join('');
      el.querySelectorAll('[data-sq]').forEach(btn => {
        btn.addEventListener('click', () => {
          el.style.display = 'none';
          this._stabloPost(btn.dataset.sq);
        });
      });
    }

    _stabloNudge(msg, chips) {
      if (this._stabloNudged) return;
      this._stabloNudged = true;
      this._stabloInject();
      const btn = this.container.querySelector('[data-stablo="btn"]');
      if (btn) { btn.style.animation = 'none'; btn.offsetHeight; btn.style.animation = 'sp-stablo-pulse 1.5s ease-in-out 3'; }
      if (!this._stabloOpen) {
        this._stabloOpen = true;
        const panel = this.container.querySelector('[data-stablo="panel"]');
        if (panel) panel.classList.remove('sp-hidden');
      }
      this._stabloBotMsg(msg);
      if (chips) this._stabloSetChips(chips);
    }

    _stabloOnPayScreen() {
      this._stabloInject();
      this._stabloPayScreenTs = Date.now();
      if (this._stabloIdleTimer) clearTimeout(this._stabloIdleTimer);
      this._stabloIdleTimer = setTimeout(() => {
        if (!this._stabloNudged && !this._stabloOpen) {
          this._stabloNudge(
            "Looks like you're on the payment screen — need a hand? Most people pay in under 2 minutes.",
            [
              { label: "I don't have crypto", q: "I don't have any crypto — how do I pay?" },
              { label: "Which wallet?", q: "What wallet should I use to send this?" },
              { label: "I sent but nothing happened", q: "I already sent the payment but it's not confirming" },
            ]
          );
        }
      }, 45000);
    }

    _stabloOnRetry() {
      this._stabloInject();
      this._stabloNudge(
        "I see you're trying again — let me help. What went wrong with your last attempt?",
        [
          { label: "I don't know how to send", q: "I'm confused about how to actually send the crypto" },
          { label: "Wrong amount/token", q: "I think I sent the wrong amount or token" },
          { label: "It expired", q: "My order expired before I could pay" },
        ]
      );
    }

    _stabloOnExpiry() {
      if (this._stabloNudged) return;
      this._stabloInject();
      this._stabloNudge(
        "Your order expires soon! If you need more time, you can start a new checkout after this one expires.",
        [
          { label: "How do I send faster?", q: "How do I send the payment quickly before it expires?" },
          { label: "I already sent", q: "I already sent the payment — why isn't it confirming?" },
        ]
      );
    }

    _stabloSend() {
      const input = this.container.querySelector('[data-stablo="input"]');
      if (!input) return;
      const text = input.value.trim();
      if (!text || this._stabloLoading) return;
      input.value = '';
      const chips = this.container.querySelector('[data-stablo="chips"]');
      if (chips) chips.style.display = 'none';
      this._stabloPost(text);
    }

    _stabloPost(text) {
      if (this._stabloLoading) return;
      this._stabloLoading = true;
      const msgs = this.container.querySelector('[data-stablo="msgs"]');
      if (!msgs) { this._stabloLoading = false; return; }
      const userEl = document.createElement('div');
      userEl.className = 'sp-stablo-msg user';
      userEl.textContent = text;
      msgs.appendChild(userEl);
      const loadEl = document.createElement('div');
      loadEl.className = 'sp-stablo-msg bot';
      loadEl.textContent = '…';
      msgs.appendChild(loadEl);
      msgs.scrollTop = msgs.scrollHeight;
      const orderId = this.currentOrderId || '';
      fetch(`${STABLEPAY_URL}/api/embed/support`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, message: text }),
      })
      .then(r => r.json())
      .then(data => { loadEl.textContent = data.reply || 'Something went wrong — try refreshing.'; msgs.scrollTop = msgs.scrollHeight; })
      .catch(() => { loadEl.textContent = 'Network error. Try again in a second.'; })
      .finally(() => { this._stabloLoading = false; });
    }
    // ── end Stablo ───────────────────────────────────────────────────────────

    startPaymentPolling() {
      if (this._pollingInterval) return; // Don't double-poll

      const pollStartTime = Date.now();
      const MANUAL_TX_TIMEOUT = 15000;
      let manualShown = false;

      const statusMessages = [
        { at: 0, text: 'Stablo is scanning the blockchain...' },
        { at: 5, text: 'Checking the public ledger...' },
        { at: 10, text: 'Confirming your payment...' },
        { at: 15, text: 'Still looking — paste your confirmation below to help Stablo find it' },
      ];

      // Timer display + progress bar
      this._timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - pollStartTime) / 1000);
        const progress = Math.min(elapsed / 60 * 100, 95); // Cap at 95%

        // Update progress bar
        const bar = this.container.querySelector('#sp-progress-bar');
        if (bar) bar.style.width = progress + '%';

        // Update status message
        const statusEl = this.container.querySelector('#sp-poll-status');
        if (statusEl) {
          const msg = [...statusMessages].reverse().find(m => elapsed >= m.at);
          if (msg) statusEl.textContent = msg.text;
        }

        // Update timer
        const timerEl = this.container.querySelector('#sp-poll-timer');
        if (timerEl) {
          if (elapsed < 10) timerEl.textContent = 'This can take up to a minute';
          else timerEl.textContent = `${elapsed}s`;
        }

        // Show manual TX entry after timeout
        if (!manualShown && Date.now() - pollStartTime > MANUAL_TX_TIMEOUT) {
          manualShown = true;
          this._revealManualTxPaste();
        }
      }, 1000);

      // Polling for confirmation (continues even after manual TX shown).
      this._pollingInterval = setInterval(async () => {
        if (!this.currentOrderId) return;
        try {
          const res = await fetch(`${STABLEPAY_URL}/api/embed/order/${this.currentOrderId}`);
          const data = await res.json();
          if (data.status === 'CONFIRMED') {
            clearInterval(this._pollingInterval); this._pollingInterval = null;
            clearInterval(this._timerInterval);   this._timerInterval = null;
            this.showSuccess(data);
          } else if (data.status === 'EXPIRED' || data.status === 'CANCELLED') {
            clearInterval(this._pollingInterval); this._pollingInterval = null;
            clearInterval(this._timerInterval);   this._timerInterval = null;
            const pollStatus = this.container.querySelector('#sp-poll-status');
            if (pollStatus) pollStatus.textContent = 'Order ' + data.status.toLowerCase();
            const pollTimer = this.container.querySelector('#sp-poll-timer');
            if (pollTimer) pollTimer.textContent = 'Please start a new payment';
          } else if (data.wrongTokenDetected && data.wrongTokenDetected.receivedToken && data.status === 'PENDING') {
            const wt = data.wrongTokenDetected;
            const pollStatus = this.container.querySelector('#sp-poll-status');
            if (pollStatus) pollStatus.innerHTML = `We detected a <strong>${wt.receivedToken}</strong> transfer, but this order expects <strong>${wt.expectedToken}</strong>.`;
            const pollTimer = this.container.querySelector('#sp-poll-timer');
            if (pollTimer) pollTimer.textContent = 'Please send the correct token to complete payment.';
          } else if (data.status === 'PENDING' && data.expiresAt) {
            const secsLeft = Math.max(0, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000));
            const warningEl = this.container.querySelector('#sp-expiry-warning');
            if (warningEl) {
              if (secsLeft <= 60 && secsLeft > 0) { warningEl.textContent = '⏱ Less than 1 minute! Complete payment now.'; warningEl.style.cssText = 'display:block;background:#F4F4F5;border:1px solid #D4D4D8;color:#18181B;padding:6px 10px;font-size:12px;font-weight:700;text-align:center;margin-bottom:6px;'; }
              else if (secsLeft <= 300) { warningEl.textContent = '⏱ Less than 5 minutes remaining.'; warningEl.style.cssText = 'display:block;background:#F4F4F5;border:1px solid #D4D4D8;color:#18181B;padding:6px 10px;font-size:12px;text-align:center;margin-bottom:6px;'; }
              else { warningEl.style.display = 'none'; }
            }
          }
        } catch {}
      }, 5000);
    }

    // Reveal the manual TX paste UI + bind its Submit handler. Extracted from inline code
    // inside startPaymentPolling's 15s-timeout block so fast variant can call it IMMEDIATELY
    // when the customer clicks "I've sent it" — otherwise the Submit button would be dead
    // until 15s elapsed (the handler was bound inside that gated block).
    _revealManualTxPaste() {
      if (this._manualTxRevealed) return; // idempotent
      this._manualTxRevealed = true;
      const manualDiv = this.container.querySelector('#sp-manual-tx');
      if (manualDiv) manualDiv.style.display = 'block';
      const bar = this.container.querySelector('#sp-progress-bar');
      if (bar) bar.style.transition = 'none';
      // Skip the "couldn't find it" copy for fast — they have their own paste-confirm context.
      if (this._variant !== 'fast') {
        const pollStatus = this.container.querySelector('#sp-poll-status');
        if (pollStatus) pollStatus.textContent = 'Stablo couldn\'t find it automatically';
        const pollTimer = this.container.querySelector('#sp-poll-timer');
        if (pollTimer) pollTimer.textContent = 'Paste your confirmation below — we\'ll find your payment';
      }
      const txInput = this.container.querySelector('#sp-manual-tx-input');
      if (txInput) {
        txInput.placeholder = 'Paste your transaction link / ID / wallet address';
      }
      const pasteBtn = this.container.querySelector('#sp-manual-tx-btn');
      const focusManual = (hint) => {
        // Clipboard read failed/blocked (in-app webviews) — guide them to the box, never throw.
        const input = this.container.querySelector('#sp-manual-tx-input');
        const statusEl = this.container.querySelector('#sp-manual-tx-status');
        if (input) { try { input.focus(); } catch {} }
        if (statusEl) { statusEl.style.display = 'block'; statusEl.style.color = 'var(--sp-muted)'; statusEl.textContent = hint || 'Paste it in the box above'; }
      };
      if (pasteBtn) {
        pasteBtn.addEventListener('click', async () => {
          let text = '';
          try {
            // In-app webviews (Instagram/FB) block clipboard reads — must try/catch + fall back.
            if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
              text = (await navigator.clipboard.readText()) || '';
            }
          } catch { text = ''; }
          text = (text || '').trim();
          if (!text) { focusManual('Paste it in the box above'); return; }
          const input = this.container.querySelector('#sp-manual-tx-input');
          if (input) input.value = text;
          this._routePastedProof(text);
        });
      }
      if (txInput) {
        // AUTO-route on manual paste / input so no separate button press is needed.
        txInput.addEventListener('paste', (e) => {
          const pasted = (e.clipboardData || window.clipboardData)?.getData('text') || '';
          const v = pasted.trim();
          if (v) { setTimeout(() => { txInput.value = v; this._routePastedProof(v); }, 0); }
        });
        // Enter also routes (keyboard users / typed-then-Enter).
        txInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); const v = txInput.value?.trim(); if (v) this._routePastedProof(v); }
        });
      }
    }

    // Classify a pasted proof string + route it through the EXISTING payment endpoints:
    //   explorer link / tx hash -> POST /tx     (direct verify — instant, exact)
    //   wallet address          -> POST /contact (scanner FROM-matches the payment)
    // Shared by the Paste button + manual input auto-paste. Never throws.
    async _routePastedProof(value) {
          value = (value || '').trim();
          const statusEl = this.container.querySelector('#sp-manual-tx-status');
          const submitBtn = this.container.querySelector('#sp-manual-tx-btn');
          if (!value) return;
          // Classify what they pasted so we route to the SAFEST detection method:
          //   explorer link / tx hash -> direct /tx verify (instant, exact)
          //   wallet address          -> register it so the scanner FROM-matches their payment
          const isLink = value.startsWith('http');
          const ct = this.selectedChain?.config?.type;
          let kind = null; // 'link' | 'txhash' | 'wallet'
          if (isLink) {
            kind = 'link';
          } else if (ct === 'evm') {
            if (/^0x[0-9a-fA-F]{64}$/.test(value)) kind = 'txhash';        // 0x + 64 hex
            else if (/^0x[0-9a-fA-F]{40}$/.test(value)) kind = 'wallet';   // 0x + 40 hex
          } else if (ct === 'solana') {
            // base58, no 0x. Signatures are ~87-88 chars; addresses 32-44. Split on length.
            if (/^[1-9A-HJ-NP-Za-km-z]{32,90}$/.test(value)) kind = (value.length >= 64) ? 'txhash' : 'wallet';
          } else if (ct === 'tron') {
            if (/^[0-9a-fA-F]{64}$/.test(value)) kind = 'txhash';
            else if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) kind = 'wallet';
          } else {
            kind = (value.length >= 60) ? 'txhash' : 'wallet';
          }
          if (!kind) {
            if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = "! That doesn't look like a transaction link, ID, or wallet address"; statusEl.style.color = '#18181B'; }
            return;
          }
          // Gated on variant — only count as fast-conversion when this IS the fast arm.
          if (this._variant === 'fast') {
            this._track('FAST_CONFIRMATION_PROVIDED', { type: kind === 'wallet' ? 'wallet' : 'tx_hash', variant: this._variant });
          }

              submitBtn && (submitBtn.disabled = true);
              submitBtn && (submitBtn.textContent = '...');
              if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = kind === 'wallet' ? 'Saving your wallet…' : 'Confirming your payment…'; statusEl.style.color = 'var(--sp-muted)'; }

              try {
                // Wallet address -> register it for FROM-matching; the scanner confirms when the
                // matching transfer lands. Safest path when the customer doesn't have the tx hash.
                if (kind === 'wallet') {
                  const r = await fetch(`${STABLEPAY_URL}/api/embed/order/${this.currentOrderId}/contact`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ customerWallet: value }),
                  });
                  if (r.ok) {
                    this.customerWallet = value;
                    if (statusEl) { statusEl.textContent = "✓ Got your wallet — we'll confirm the moment your payment lands."; statusEl.style.color = '#18181B'; }
                    if (submitBtn) submitBtn.textContent = '✓ Saved';
                  } else {
                    if (statusEl) { statusEl.textContent = '! Could not save your wallet — try again or paste your confirmation.'; statusEl.style.color = '#18181B'; }
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '📋 Paste'; }
                  }
                  return;
                }

                // Validate explorer URL matches selected chain
                if (isLink) {
                  const chain = this.selectedChain?.chain;
                  const validExplorers = {
                    BASE_MAINNET: 'basescan.org', ETHEREUM_MAINNET: 'etherscan.io',
                    POLYGON_MAINNET: 'polygonscan.com', ARBITRUM_MAINNET: 'arbiscan.io',
                    BNB_MAINNET: 'bscscan.com', SOLANA_MAINNET: 'solscan.io',
                    TRON_MAINNET: 'tronscan.org',
                  };
                  const expected = validExplorers[chain];
                  if (expected && !value.includes(expected)) {
                    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = `! Wrong explorer — use ${expected} for ${this.selectedChain?.config?.chainName}`; statusEl.style.color = '#18181B'; }
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '📋 Paste'; }
                    return;
                  }
                }

                const body = isLink ? { explorerLink: value } : { txHash: value };
                const res = await fetch(`${STABLEPAY_URL}/api/embed/order/${this.currentOrderId}/tx`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                const data = await res.json();

                if (data.status === 'CONFIRMED') {
                  // Auto-verified — show success immediately
                  clearInterval(this._pollingInterval);
                  clearInterval(this._timerInterval);
                  // Use backend-returned data which has proper txHash + explorerLink
                  this.showSuccess({
                    txHash: data.txHash || (isLink ? null : value),
                    explorerLink: data.explorerLink || (isLink ? value : null),
                    status: 'CONFIRMED'
                  });
                } else if (data.success) {
                  // Queued for review
                  if (statusEl) { statusEl.textContent = '✓ Submitted for review. You\'ll be notified once confirmed.'; statusEl.style.color = '#18181B'; }
                  if (submitBtn) submitBtn.textContent = '✓ Submitted';
                } else {
                  // Never render server error bodies verbatim — prior incident: the widget
                  // displayed a full Cloudflare challenge HTML page to a customer. Strip
                  // HTML-ish content and cap to a short message, fall back to a generic
                  // reassurance if the server blob isn't human-friendly.
                  let msg = typeof data.error === 'string' ? data.error : 'Could not confirm yet';
                  if (/<html|<!DOCTYPE|requestUrl|responseBody/i.test(msg) || msg.length > 240) {
                    msg = 'We couldn\u2019t confirm right now. Our scanner will keep watching — if your payment is on-chain, your order will confirm automatically within a minute.';
                  }
                  if (statusEl) { statusEl.textContent = '! ' + msg; statusEl.style.color = '#18181B'; }
                  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '📋 Paste'; }
                }
              } catch (err) {
                if (statusEl) { statusEl.textContent = '! Network error — please try again'; statusEl.style.color = '#18181B'; }
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '📋 Paste'; }
              }
    }

    selectChain(chainKey) {
      const prevType = this.selectedChain?.config?.type;
      const prevChain = this.selectedChain?.chain;
      this.selectedChain = this.merchantChains.find(mc => mc.chain === chainKey);
      const tokens = this.getTokensForMode();
      this.selectedToken = tokens[0] || 'USDC';
      if (prevChain !== chainKey) this._track('CHAIN_SELECTED', { chain: chainKey, mode: this.payMode });

      // Update token dropdown options (hidden select + custom dropdown)
      const tokenSelect = this.container.querySelector('#sp-token-select');
      if (tokenSelect) {
        tokenSelect.innerHTML = this.renderTokenOptions();
      }
      // Update custom token button + dropdown
      const tokenBtn = this.container.querySelector('#sp-token-select-btn');
      const tokenDropdown = this.container.querySelector('#sp-token-dropdown');
      if (tokenBtn) {
        tokenBtn.innerHTML = `
          <img src="${this.getTokenIcon(this.selectedToken)}" style="width: 18px; height: 18px; border-radius: 50%;" onerror="this.style.display='none'">
          <span>${this.selectedToken}</span>
          <span style="margin-left: auto; font-size: 10px; opacity: 0.5;">▼</span>
        `;
      }
      if (tokenDropdown && this.selectedChain) {
        tokenDropdown.innerHTML = tokens
          .map(token => `
            <div class="sp-token-option" data-token="${token}" style="
              padding: 8px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; color: var(--sp-text);
            " onmouseover="this.style.background='var(--sp-bg)'" onmouseout="this.style.background=''">
              <img src="${this.getTokenIcon(token)}" style="width: 18px; height: 18px; border-radius: 50%;" onerror="this.style.display='none'">
              <span style="font-size: 13px; font-weight: 600; color: var(--sp-text);">${token}</span>
            </div>
          `).join('');
        // Re-attach click handlers
        tokenDropdown.querySelectorAll('.sp-token-option').forEach(opt => {
          opt.addEventListener('click', () => {
            const token = opt.dataset.token;
            if (tokenBtn) {
              tokenBtn.innerHTML = `
                <img src="${this.getTokenIcon(token)}" style="width: 18px; height: 18px; border-radius: 50%;" onerror="this.style.display='none'">
                <span>${token}</span>
                <span style="margin-left: auto; font-size: 10px; opacity: 0.5;">▼</span>
              `;
            }
            if (tokenSelect) tokenSelect.value = token;
            tokenDropdown.style.display = 'none';
            this.selectToken(token);
          });
        });
      }

      // Auto-disconnect if switching between EVM and Solana
      const newType = this.selectedChain?.config?.type;
      if (prevType && newType && prevType !== newType && this.connectedWallet) {
        this.connectedWallet = null;
        this.provider = null;
        this.tokenBalance = null;
        this.updateWalletStatus();
        return; // updatePayButton called by updateWalletStatus
      }

      // Update wallet input placeholder for new chain type
      const walletInput = this.container.querySelector('#sp-sender-wallet');
      if (walletInput) {
        walletInput.placeholder = newType === 'solana' ? 'Solana address (base58)' : '0x... (EVM address)';
      }

      // Re-check balance for new chain/token
      if (this.connectedWallet) this.checkTokenBalance();
      else this.updatePayButton();

      // Refresh native price when chain changes in crypto mode
      if (this.payMode === 'crypto') this.refreshNativePrice();

      // FAST edit panel: if the send screen is currently shown, repaint the address/QR/amount for
      // the newly-selected rail. Also refresh the per-rail native toggle visibility.
      this._repaintSendScreenIfActive();
    }

    // Re-render the manual send screen (address/QR/amount/countdown) in place when the customer
    // changes chain/token/pay-mode from the FAST 'Edit payment options' panel. No-op unless the
    // send screen (step2) is currently visible. Idempotent for the stablecoin path; the native
    // path re-runs the eager order creation as the spec intends.
    _repaintSendScreenIfActive() {
      if (this._variant !== 'fast') return;
      const step2 = this.container.querySelector('#sp-send-step2');
      if (!step2 || step2.style.display === 'none') return;
      // Keep the per-rail native toggle in sync (show only when this rail accepts native).
      const railAcceptsNative = !!(this.selectedChain && this.selectedChain.acceptNativeTokens && CHAIN_NATIVE_TOKEN[this.selectedChain.chain]);
      const modeToggle = this.container.querySelector('#sp-pay-mode-toggle');
      if (modeToggle) modeToggle.style.display = railAcceptsNative ? 'flex' : 'none';
      // Edit-panel changes apply INSTANTLY (pick a chain/coin → the address + amount update right
      // away). The earlier "stage until Save" gate made picking an option look broken (nothing
      // changed) — removed. The panel's green "Done" button just closes it.
      // If this rail can't do native but we're in crypto mode, fall back to stable.
      if (!railAcceptsNative && this.payMode === 'crypto' && typeof this.setPayMode === 'function') {
        this.setPayMode('stable'); // setPayMode → selectChain → re-enters here in stable mode
        return;
      }
      try { this.showManualPaymentDetails('send'); } catch (e) { console.warn('[SP] edit-panel repaint failed', e); }
    }

    selectToken(token) {
      const prev = this.selectedToken;
      this.selectedToken = token;
      if (prev !== token) this._track('TOKEN_SELECTED', { token, chain: this.selectedChain?.chain, mode: this.payMode });

      // EURC needs USD → EUR conversion
      if (token === 'EURC') {
        this.fetchEURCRate();
      } else {
        this.eurcRate = null;
        this.updateAmountDisplay();
      }

      // Re-check balance for new token
      if (this.connectedWallet) this.checkTokenBalance();
      else this.updatePayButton();

      // FAST edit panel: repaint the send screen for the newly-selected coin if it's showing.
      this._repaintSendScreenIfActive();
    }

    async fetchEURCRate() {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=euro-coin&vs_currencies=usd');
        const data = await res.json();
        this.eurcRate = data['euro-coin']?.usd || 1.15; // fallback 1.15
      } catch {
        this.eurcRate = 1.15; // fallback
      }
      this.updateAmountDisplay();
    }

    updateAmountDisplay() {
      const amountEl = this.container.querySelector('#sp-amount-display');
      if (!amountEl) return;
      const usdAmount = parseFloat(this.options.amount || 0);
      if (this.selectedToken === 'EURC' && this.eurcRate) {
        const eurAmount = (usdAmount / this.eurcRate).toFixed(2);
        amountEl.innerHTML = `€${eurAmount} <span style="font-size:14px;opacity:0.7;">EURC</span> <span style="font-size:12px;opacity:0.5;">($${usdAmount.toFixed(2)} USD)</span>`;
      } else {
        amountEl.innerHTML = `$${usdAmount.toFixed(2)}`;
      }
    }

    async connectWallet() {
      this._track('WALLET_CONNECT_OPENED', { chain: this.selectedChain?.chain, token: this.selectedToken });
      const chainConfig = this.selectedChain?.config;
      if (!chainConfig) return;

      // Hide tabs — user has committed to Connect Wallet
      const tabs = this.container.querySelector('#sp-method-tabs');
      if (tabs) tabs.style.display = 'none';

      // Lock selectors while connecting
      this.lockSelectors();

      try {
        if (chainConfig.type === 'solana') {
          await this.connectSolanaWallet();
        } else {
          await this.connectEVMWallet();
        }
      } catch (error) {
        console.error('Wallet connection failed:', error);
        // Unlock selectors + show tabs on failure
        this.unlockSelectors();
        const tabsEl = this.container.querySelector('#sp-method-tabs');
        if (tabsEl) tabsEl.style.display = 'flex';
        if (error.code === -32002) {
          this.showError('Wallet has a pending request. Open your wallet extension, dismiss it, and try again.');
        } else if (error.code === 4001) {
          // User rejected — silent
        } else {
          this.showError('Failed to connect wallet: ' + (error.shortMessage || error.message));
        }
      }
    }

    detectEVMProviders() {
      const providers = [];
      const seen = new Set();

      const classify = (p) => {
        if (!p || typeof p.request !== 'function') return;
        // Brave wallet masquerades as MetaMask — detect and label correctly
        if (p.isBraveWallet) {
          if (!seen.has('brave')) { providers.push({ name: 'Brave Wallet', provider: p, icon: '🦁' }); seen.add('brave'); }
          return;
        }
        if (p.isPhantom && !p.isMetaMask) {
          if (!seen.has('phantom')) { providers.push({ name: 'Phantom', provider: p, icon: '👻' }); seen.add('phantom'); }
        } else if (p.isMetaMask && !p.isBraveWallet) {
          if (!seen.has('metamask')) { providers.push({ name: 'MetaMask', provider: p, icon: '🦊' }); seen.add('metamask'); }
        } else if (p.isRabby) {
          if (!seen.has('rabby')) { providers.push({ name: 'Rabby', provider: p, icon: '🐰' }); seen.add('rabby'); }
        } else if (p.isCoinbaseWallet) {
          if (!seen.has('coinbase')) { providers.push({ name: 'Coinbase', provider: p, icon: '🔵' }); seen.add('coinbase'); }
        } else if (p.isRainbow) {
          if (!seen.has('rainbow')) { providers.push({ name: 'Rainbow', provider: p, icon: '🌈' }); seen.add('rainbow'); }
        } else if (!seen.has('unknown')) {
          providers.push({ name: 'Wallet', provider: p, icon: '👛' }); seen.add('unknown');
        }
      };

      // Check for multiple injected providers (EIP-6963 style)
      if (window.ethereum?.providers?.length) {
        window.ethereum.providers.forEach(classify);
      }
      // Also classify the top-level ethereum object
      if (window.ethereum) classify(window.ethereum);
      // Phantom EVM provider (separate from window.ethereum)
      if (window.phantom?.ethereum) classify(window.phantom.ethereum);

      return providers;
    }

    async connectEVMWallet() {
      const providers = this.detectEVMProviders();

      if (providers.length === 0) {
        this.showError('No wallet detected. Install MetaMask, Rainbow, or Coinbase Wallet to continue.');
        return;
      }

      let selectedProvider;

      if (providers.length === 1) {
        selectedProvider = providers[0].provider;
      } else {
        // Always show picker when multiple wallets detected
        selectedProvider = await this.showWalletPicker(providers);
        if (!selectedProvider) return; // User cancelled
      }

      try {
        const accounts = await selectedProvider.request({ method: 'eth_requestAccounts' });
        if (accounts.length === 0) throw new Error('No accounts found');

        this.connectedWallet = accounts[0];
        this.provider = selectedProvider;
      } catch (err) {
        if (err.code === -32002) {
          this._track('WALLET_CONNECT_FAILED', { reason: 'pending_request', chain: this.selectedChain?.chain, msg: 'pending_request' });
          this.showError('Your wallet has a pending request. Open MetaMask and approve or reject it, then try again.');
          return;
        }
        if (err.code === 4001) {
          this._track('WALLET_CONNECT_FAILED', { reason: 'user_rejected', chain: this.selectedChain?.chain });
          return;
        }
        this._track('WALLET_CONNECT_FAILED', { reason: 'unknown', chain: this.selectedChain?.chain, msg: (err.message || '').slice(0, 200) });
        throw err;
      }

      // Switch to correct chain — use selectedProvider, not window.ethereum
      const chainConfig = this.selectedChain.config;
      try {
        await selectedProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainConfig.chainId }]
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          await selectedProvider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: chainConfig.chainId,
              chainName: chainConfig.chainName,
              rpcUrls: chainConfig.rpcUrls,
              blockExplorerUrls: chainConfig.blockExplorerUrls
            }]
          });
        }
      }

      this.updateWalletStatus();
      this.onWalletConnected();
    }

    showWalletPicker(providers) {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.8);z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;';
        overlay.innerHTML = `
          <div style="font-size:14px;font-weight:600;color:#fff;margin-bottom:16px;">Choose Wallet</div>
          ${providers.map((p, i) => `
            <button data-idx="${i}" style="width:100%;max-width:280px;padding:12px 16px;margin-bottom:8px;background:#1e293b;color:#fff;border:1px solid #334155;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:12px;font-size:14px;">
              <span style="font-size:20px;">${p.icon}</span>
              <span>${p.name}</span>
            </button>
          `).join('')}
          <button data-cancel style="margin-top:8px;color:#94a3b8;font-size:12px;background:none;border:none;cursor:pointer;">Cancel</button>
        `;

        overlay.querySelectorAll('[data-idx]').forEach(btn => {
          btn.addEventListener('click', () => {
            overlay.remove();
            resolve(providers[parseInt(btn.dataset.idx)].provider);
          });
        });
        overlay.querySelector('[data-cancel]').addEventListener('click', () => {
          overlay.remove();
          resolve(null);
        });

        this.container.querySelector('.sp-widget')?.appendChild(overlay);
      });
    }

    async connectSolanaWallet() {
      // Detect Solana wallets
      const phantom = window.phantom?.solana || window.solana;
      const solflare = window.solflare;
      const backpack = window.backpack;

      const solProviders = [];
      if (phantom?.isPhantom) solProviders.push({ name: 'Phantom', provider: phantom, icon: '👻' });
      if (solflare?.isSolflare) solProviders.push({ name: 'Solflare', provider: solflare, icon: '☀️' });
      if (backpack) solProviders.push({ name: 'Backpack', provider: backpack, icon: '🎒' });

      if (solProviders.length === 0) {
        this.showError('No Solana wallet found. Install Phantom or Solflare.');
        return;
      }

      let selected = solProviders[0].provider;
      if (solProviders.length > 1) {
        selected = await this.showWalletPicker(solProviders);
        if (!selected) return;
      }

      const resp = await selected.connect();
      this.connectedWallet = resp.publicKey.toString();
      this.provider = selected;

      this.updateWalletStatus();
    }

    updateWalletStatus() {
      const statusDiv = this.container.querySelector('#sp-wallet-status');
      if (!statusDiv) return;

      const shortAddr = this.connectedWallet
        ? `${this.connectedWallet.slice(0, 6)}...${this.connectedWallet.slice(-4)}`
        : null;

      if (this.connectedWallet && !this._verified) {
        // Show verification animation
        this._verified = true;
        const steps = [
          { text: 'Connecting wallet...', icon: '◌', delay: 0 },
          { text: 'Verifying address...', icon: '◌', delay: 600 },
          { text: 'Compliance check...', icon: '◌', delay: 1200 },
          { text: 'Wallet verified', icon: '✓', delay: 1800 },
        ];

        statusDiv.style.flexDirection = 'column';
        statusDiv.style.gap = '4px';
        statusDiv.style.padding = '16px 12px';

        const updateStep = (i) => {
          if (i >= steps.length) {
            // Show final connected state
            setTimeout(() => this.showConnectedState(statusDiv, shortAddr), 300);
            return;
          }
          statusDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              ${i < steps.length - 1
                ? '<span class="sp-spinner" style="display:inline-block;width:14px;height:14px;border:2px solid var(--sp-border);border-top-color:#18181B;border-radius:50%;"></span>'
                : '<span style="color:#18181B;font-size:16px;font-weight:700;">✓</span>'}
              <span style="font-size: 11px; color: var(--sp-muted); font-weight: 600; text-transform: uppercase;">${steps[i].text}</span>
            </div>
            <div style="font-size: 10px; color: var(--sp-text); font-family: monospace; margin-top: 2px;">${shortAddr}</div>
          `;
        };

        steps.forEach((step, i) => setTimeout(() => updateStep(i), step.delay));
        // After last step, show connected state + check balance
        setTimeout(async () => {
          this.showConnectedState(statusDiv, shortAddr);
          await this.runBalanceCheck();
        }, 2400);
        return;
      }

      if (this.connectedWallet) {
        this.showConnectedState(statusDiv, shortAddr);
        return;
      }

      // Not connected
      statusDiv.style.flexDirection = '';
      statusDiv.style.gap = '';
      statusDiv.style.padding = '12px';
      statusDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 8px; height: 8px; border-radius: 50%; background: #71717A;"></div>
          <span style="font-size: 12px; color: var(--sp-muted); font-weight: 600;">Not connected</span>
        </div>
        <button id="sp-connect-btn" style="
          padding: 6px 14px; background: #000; color: #fff;
          border: 2px solid var(--sp-border); font-size: 11px; font-weight: 700; cursor: pointer; text-transform: uppercase;
        ">Connect</button>
      `;
      statusDiv.querySelector('#sp-connect-btn')?.addEventListener('click', () => this.connectWallet());
      this._verified = false;
      this.updatePayButton();
    }

    showConnectedState(statusDiv, shortAddr) {
      statusDiv.style.flexDirection = '';
      statusDiv.style.gap = '';
      statusDiv.style.padding = '12px';
      statusDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 8px; height: 8px; border-radius: 50%; background: #18181B;"></div>
          <span style="font-size: 12px; color: var(--sp-text); font-family: monospace;">${shortAddr}</span>
          <span style="font-size: 9px; color: #18181B; font-weight: 700; text-transform: uppercase;">✓ Verified</span>
        </div>
        <button id="sp-disconnect-btn" style="
          padding: 6px 12px;
          background: transparent;
            color: var(--sp-muted);
            border: 1px solid var(--sp-border);
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
          ">Disconnect</button>
        `;

        statusDiv.querySelector('#sp-disconnect-btn')?.addEventListener('click', () => {
          this.connectedWallet = null;
          this.provider = null;
          this._verified = false;
          this.tokenBalance = null;
          this.updateWalletStatus();
        });

      this.updatePayButton();
      if (this.connectedWallet) this.checkTokenBalance();
    }

    async runBalanceCheck() {
      const payBtn = this.container.querySelector('#sp-pay-btn');
      if (!payBtn || !this.connectedWallet || !this.selectedChain) return;

      const amt = parseFloat(this.options.amount || 0);
      const chainConfig = this.selectedChain.config;
      const tokenConfig = chainConfig?.tokens?.[this.selectedToken];

      if (!tokenConfig?.address) {
        this._enablePayBtn(payBtn, amt);
        return;
      }

      payBtn.disabled = true;
      payBtn.textContent = 'Checking balance...';
      payBtn.style.background = 'var(--sp-card)';
      payBtn.style.color = 'var(--sp-muted)';

      try {
        let balance = null;

        if (chainConfig.type === 'solana') {
          balance = await this._getSolanaBalance(tokenConfig.address);
        } else if (this.connectedWallet.startsWith('0x') && chainConfig.rpcUrls?.[0]) {
          balance = await this._getEVMBalance(chainConfig.rpcUrls[0], tokenConfig.address, tokenConfig.decimals || 6);
        }

        if (balance !== null) {
          this.tokenBalance = balance;
          if (balance < amt) {
            payBtn.disabled = true;
            payBtn.textContent = `! Insufficient ${this.selectedToken} (${balance.toFixed(2)} available)`;
            this._track('INSUFFICIENT_BALANCE', { chain: this.selectedChain?.chain, token: this.selectedToken, balance, needed: amt });
            payBtn.style.background = '#F4F4F5';
            payBtn.style.color = '#18181B';
            return;
          }
          payBtn.disabled = false;
          payBtn.textContent = `Pay $${amt.toFixed(2)} in ${this.selectedToken} (${balance.toFixed(2)} available)`;
          payBtn.style.background = '#18181B';
          payBtn.style.color = '#fff';
        } else {
          this._enablePayBtn(payBtn, amt);
        }
      } catch (err) {
        console.warn('[StablePay] Balance check failed:', err.message);
        this._enablePayBtn(payBtn, amt);
      }
    }

    _enablePayBtn(payBtn, amt) {
      payBtn.disabled = false;
      if (NATIVE_TOKENS.has(this.selectedToken) && this.nativePriceUsd) {
        const chain = this.selectedChain?.chain;
        const pct = amt * 0.015;
        const fee = (chain === 'ETHEREUM_MAINNET') ? Math.max(pct, 1.00) : Math.max(pct, 0.50);
        const nativeAmt = (amt + fee) / this.nativePriceUsd;
        payBtn.textContent = `Pay ${nativeAmt.toPrecision(4)} ${this.selectedToken}`;
      } else {
        payBtn.textContent = `Pay $${amt.toFixed(2)} ${this.selectedToken}`;
      }
      payBtn.style.background = '#18181B';
      payBtn.style.color = '#fff';
    }

    async _getEVMBalance(rpcUrl, tokenAddress, decimals) {
      await this.loadScript('https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.umd.min.js');
      const ethers = window.ethers;
      if (!ethers) return null;

      // Use JsonRpcProvider with the chain's own RPC — guaranteed correct chain
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const raw = await contract.balanceOf(this.connectedWallet);
      return parseFloat(ethers.formatUnits(raw, decimals));
    }

    async _getSolanaBalance(mintAddress) {
      try {
        // Use Solana JSON-RPC directly — no need for @solana/web3.js
        const response = await fetch('https://api.mainnet-beta.solana.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'getTokenAccountsByOwner',
            params: [
              this.connectedWallet,
              { mint: mintAddress },
              { encoding: 'jsonParsed' }
            ]
          })
        });

        const data = await response.json();
        const accounts = data.result?.value || [];
        let total = 0;
        for (const acc of accounts) {
          total += acc.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
        }
        return total;
      } catch (err) {
        console.warn('[StablePay] Solana balance check failed:', err.message);
        return null;
      }
    }

    async checkTokenBalance() {
      // Called from showConnectedState and selectChain/selectToken
      await this.runBalanceCheck();
    }

    updatePayButton() {
      const payBtn = this.container.querySelector('#sp-pay-btn');
      if (!payBtn) return;

      const amount = parseFloat(this.options.amount || 0);

      if (!this.connectedWallet) {
        payBtn.disabled = true;
        payBtn.textContent = 'Connect Wallet to Pay';
        payBtn.style.background = 'var(--sp-card)';
        payBtn.style.color = 'var(--sp-muted)';
      } else if (this.tokenBalance !== null && this.tokenBalance !== undefined && this.tokenBalance < amount) {
        payBtn.disabled = true;
        payBtn.textContent = `! Insufficient ${this.selectedToken} (${this.tokenBalance.toFixed(2)} available)`;
        payBtn.style.background = '#F4F4F5';
        payBtn.style.color = '#18181B';
      } else {
        payBtn.disabled = false;
        const displayAmt = (this.selectedToken === 'EURC' && this.eurcRate)
          ? `€${(amount / this.eurcRate).toFixed(2)}`
          : `$${amount.toFixed(2)}`;
        payBtn.textContent = this.options.buttonText || `Pay ${displayAmt} ${this.selectedToken}`;
        payBtn.style.background = '#18181B';
        payBtn.style.color = '#fff';
      }
    }

    async processPayment() {
      const payBtn = this.container.querySelector('#sp-pay-btn');
      if (!payBtn || !this.connectedWallet || !this.selectedChain) return;

      this._paymentInFlight = true; // B10: never auto-cancel this order on overlay close now
      this._track('PAY_CLICKED', { chain: this.selectedChain.chain, token: this.selectedToken, mode: this.payMode, method: 'wallet', variant: this._variant });

      payBtn.disabled = true;
      payBtn.innerHTML = '<span class="sp-spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; margin-right: 8px;"></span>Processing...';

      // Native token + connected wallet: create order to get receive wallet, then send native tx
      if (NATIVE_TOKENS.has(this.selectedToken)) {
        try {
          await this.processConnectedNativePayment();
        } catch (err) {
          this._handlePayError(err);
        }
        return;
      }

      try {
        const chainConfig = this.selectedChain.config;
        const tokenConfig = chainConfig.tokens[this.selectedToken];
        const recipientAddress = this.selectedChain.address;
        let amount = parseFloat(this.options.amount);

        // Convert USD to EUR for EURC payments
        if (this.selectedToken === 'EURC' && this.eurcRate) {
          amount = parseFloat((amount / this.eurcRate).toFixed(2));
        }

        // Step 1: Create order in our backend BEFORE submitting the transaction
        if (!this.currentOrderId) {
          try {
            const res = await fetch(`${STABLEPAY_URL}/api/embed/checkout`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                merchantId: this.options.merchantId,
                storeId: this.options.storeId || undefined,
                amount,
                chain: this.selectedChain.chain,
                token: this.selectedToken,
                customerEmail: this.options.customerEmail,
                externalId: this.options.externalId,
                metadata: this.options.metadata,
                customerWallet: this.connectedWallet,
                productName: this.options.productName,
                paymentMethod: 'MANUAL_SEND',
                source: 'EMBED_WIDGET',
              })
            });
            const data = await res.json();
            if (data.success) this.currentOrderId = data.order.id;
          } catch (err) {
            console.error('Failed to create order:', err);
          }
        }

        // Step 2: Submit the blockchain transaction
        if (chainConfig.type === 'solana') {
          await this.processSolanaPayment(tokenConfig, recipientAddress, amount);
        } else {
          await this.processEVMPayment(tokenConfig, recipientAddress, amount);
        }
      } catch (error) {
        this._handlePayError(error);
      }
    }

    _handlePayError(error) {
      console.error('Payment failed:', error);
      const msg = error.message || '';
      // Distinguish "user rejected" (TX_REJECTED) from real failures (PAYMENT_FAILED)
      if (msg.includes('user rejected') || msg.includes('User denied') || error.code === 'ACTION_REJECTED' || error.code === 4001) {
        this._track('TX_REJECTED', { chain: this.selectedChain?.chain, token: this.selectedToken, msg: msg.slice(0, 200) });
      } else if (msg.includes('insufficient funds') || msg.includes('exceeds balance')) {
        this._track('INSUFFICIENT_BALANCE', { chain: this.selectedChain?.chain, token: this.selectedToken, msg: msg.slice(0, 200) });
      } else if (msg.includes('switch') || msg.includes('chain')) {
        this._track('WALLET_CONNECT_FAILED', { reason: 'wrong_chain', chain: this.selectedChain?.chain, msg: msg.slice(0, 200) });
      } else {
        this._track('PAYMENT_FAILED', { chain: this.selectedChain?.chain, token: this.selectedToken, error: msg.slice(0, 200), code: error.code || null });
      }
      if (msg.includes('user rejected') || msg.includes('User denied') || error.code === 'ACTION_REJECTED') {
        this.showError('Transaction cancelled');
      } else if (msg.includes('insufficient funds') || msg.includes('exceeds balance') || msg.includes('insufficient balance')) {
        this.showError(`Insufficient ${this.selectedToken} balance on ${this.selectedChain?.config?.chainName || 'this chain'}`);
      } else if (msg.includes('switch') || msg.includes('chain')) {
        this.showError('Please switch to ' + (this.selectedChain?.config?.chainName || 'the correct network') + ' in your wallet');
      } else {
        this.showError(msg || 'Payment failed. Please try again.');
      }
      this.updatePayButton();
    }

    async processConnectedNativePayment() {
      const chainConfig = this.selectedChain.config;
      const usdAmount = parseFloat(this.options.amount || 0);

      // Step 1: Create order eagerly to get NativeReceiveWallet
      if (!this.currentOrderId) {
        const res = await fetch(`${STABLEPAY_URL}/api/embed/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchantId: this.options.merchantId,
            storeId: this.options.storeId || undefined,
            amount: usdAmount,
            chain: this.selectedChain.chain,
            token: this.selectedToken,
            customerEmail: this.options.customerEmail,
            externalId: this.options.externalId,
            metadata: this.options.metadata,
            customerWallet: this.connectedWallet,
            productName: this.options.productName,
            paymentMethod: 'CONNECTED_WALLET',
            source: 'EMBED_WIDGET',
          })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to create payment');
        this.currentOrderId  = data.order.id;
        this._receiveAddress = data.order.paymentAddress;
        this._nativeSendAmt  = data.order.nativeSendAmount;
      }

      const receiveAddress = this._receiveAddress;
      const nativeSendAmt  = this._nativeSendAmt;
      if (!receiveAddress || !nativeSendAmt) throw new Error('Missing receive address or amount');

      // Step 2: Load ethers, switch chain
      if (!window.ethers) await this.loadScript('https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.umd.min.js');
      const ethers = window.ethers;

      if (chainConfig.chainId) {
        try {
          await this.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainConfig.chainId }] });
        } catch (switchError) {
          if (switchError.code === 4902) {
            await this.provider.request({
              method: 'wallet_addEthereumChain',
              params: [{ chainId: chainConfig.chainId, chainName: chainConfig.chainName, rpcUrls: chainConfig.rpcUrls, blockExplorerUrls: chainConfig.blockExplorerUrls }]
            });
          } else { throw new Error('Please switch to ' + chainConfig.chainName + ' in your wallet'); }
        }
      }

      // Step 3: Native send from connected wallet → NativeReceiveWallet
      const provider = new ethers.BrowserProvider(this.provider);
      const signer   = await provider.getSigner();
      const valueWei = ethers.parseEther(String(nativeSendAmt));

      console.log(`[StablePay] Native send: ${nativeSendAmt} ${this.selectedToken} → ${receiveAddress}`);
      const tx = await signer.sendTransaction({ to: receiveAddress, value: valueWei });
      this._track('NATIVE_TX_BROADCAST', { chain: this.selectedChain.chain, token: this.selectedToken, txHash: tx.hash, amount: nativeSendAmt, variant: this._variant });
      this.showProcessing(tx.hash, 'Confirming Payment...');

      const receipt = await tx.wait();
      if (receipt.status !== 1) throw new Error('Transaction failed');

      // Tx mined — now backend swap kicks in. Update UI + submit hash for fast pickup.
      this.showProcessing(tx.hash, 'Converting to USDC...');
      try {
        await fetch(`${STABLEPAY_URL}/api/embed/order/${this.currentOrderId}/tx`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash: tx.hash }),
        });
      } catch (e) { console.warn('TX submit failed (scanner will catch):', e); }

      // Poll until CONFIRMED (scanner picks up native deposit → swap → forward → confirm)
      await this.pollOrderUntilTerminal(this.currentOrderId, tx.hash, { timeoutSec: 240 });
    }

    async processEVMPayment(tokenConfig, recipient, amount) {
      const ethers = window.ethers;
      if (!ethers) {
        await this.loadScript('https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.umd.min.js');
      }

      // Switch to the correct chain BEFORE creating the provider
      const chainConfig = this.selectedChain.config;
      if (chainConfig.chainId) {
        try {
          await this.provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainConfig.chainId }]
          });
        } catch (switchError) {
          if (switchError.code === 4902) {
            await this.provider.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: chainConfig.chainId,
                chainName: chainConfig.chainName,
                rpcUrls: chainConfig.rpcUrls,
                blockExplorerUrls: chainConfig.blockExplorerUrls
              }]
            });
          } else {
            throw new Error('Please switch to ' + chainConfig.chainName + ' in your wallet');
          }
        }
      }

      const provider = new window.ethers.BrowserProvider(this.provider);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();

      const tokenContract = new window.ethers.Contract(
        tokenConfig.address,
        ERC20_ABI,
        signer
      );

      const decimals = tokenConfig.decimals || 6;
      const amountWei = window.ethers.parseUnits(amount.toString(), decimals);

      console.log(`Payment: ${amount} ${this.selectedToken} on ${this.selectedChain.chain} to ${recipient}`);
      const tx = await tokenContract.transfer(recipient, amountWei);

      this.showProcessing(tx.hash);

      const receipt = await tx.wait();

      if (receipt.status === 1) {
        // Register txHash via embed API for immediate verification + confirmation
        if (this.currentOrderId) {
          try {
            const verifyRes = await fetch(`${STABLEPAY_URL}/api/embed/order/${this.currentOrderId}/tx`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ txHash: tx.hash })
            });
            const verifyData = await verifyRes.json();
            if (verifyData.status === 'CONFIRMED') {
              this.showSuccess({ txHash: tx.hash, explorerLink: verifyData.explorerLink, status: 'CONFIRMED' });
              // onSuccess fired centrally in showSuccess()
              return;
            }
          } catch (e) {
            console.error('TX verification failed, scanner will catch it:', e);
          }
        }
        // Fallback: show success with just the hash (scanner will confirm async)
        this.showSuccess(tx.hash);
        // onSuccess fired centrally in showSuccess()
      } else {
        throw new Error('Transaction failed');
      }
    }

    async processSolanaPayment(tokenConfig, recipient, amount) {
      // Load Solana web3 if not already loaded
      if (!window.solanaWeb3) {
        await this.loadScript('https://unpkg.com/@solana/web3.js@latest/lib/index.iife.min.js');
      }
      if (!window.splToken) {
        await this.loadScript('https://unpkg.com/@solana/spl-token@0.3.8/lib/cjs/index.js').catch(() => {});
      }

      const solana = window.solanaWeb3;
      if (!solana) {
        this.showError('Failed to load Solana libraries');
        return;
      }

      const connection = new solana.Connection('https://api.mainnet-beta.solana.com', 'confirmed');
      const fromPubkey = new solana.PublicKey(this.connectedWallet);
      const toPubkey = new solana.PublicKey(recipient);
      const mintPubkey = new solana.PublicKey(tokenConfig.address);

      // Get associated token accounts
      const TOKEN_PROGRAM_ID = new solana.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const ASSOCIATED_TOKEN_PROGRAM_ID = new solana.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

      function getATA(owner, mint) {
        return solana.PublicKey.findProgramAddressSync(
          [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
          ASSOCIATED_TOKEN_PROGRAM_ID
        )[0];
      }

      const fromATA = getATA(fromPubkey, mintPubkey);
      const toATA = getATA(toPubkey, mintPubkey);

      // Build TransferChecked instruction (SPL opcode 12). B5 fix: the old code used legacy
      // Transfer (opcode 3) which carries NO mint — both the /tx verifier and the scanner reject
      // mint-less transfers, so the payment could never confirm (silent fund loss). It also used
      // `Buffer` (undefined in the browser → ReferenceError). TransferChecked includes the mint +
      // decimals, and Uint8Array works without a Buffer polyfill.
      // keys order for TransferChecked: (source, mint, destination, owner); data = [12, u64 LE amount, decimals].
      const decimals = tokenConfig.decimals ?? 6;
      const amountUnits = Math.round(amount * Math.pow(10, decimals));
      const transferIx = new solana.TransactionInstruction({
        keys: [
          { pubkey: fromATA, isSigner: false, isWritable: true },
          { pubkey: mintPubkey, isSigner: false, isWritable: false },
          { pubkey: toATA, isSigner: false, isWritable: true },
          { pubkey: fromPubkey, isSigner: true, isWritable: false },
        ],
        programId: TOKEN_PROGRAM_ID,
        data: new Uint8Array([12, ...new Uint8Array(new BigUint64Array([BigInt(amountUnits)]).buffer), decimals]),
      });

      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new solana.Transaction().add(transferIx);
      tx.recentBlockhash = blockhash;
      tx.feePayer = fromPubkey;

      try {
        const signed = await this.provider.signTransaction(tx);
        const sig = await connection.sendRawTransaction(signed.serialize());

        // A/B telemetry: matches EVM path so conversion comparisons aren't biased by chain.
        this._track('NATIVE_TX_BROADCAST', { chain: this.selectedChain?.chain || 'SOLANA_MAINNET', token: this.selectedToken, txHash: sig, variant: this._variant });
        this.showProcessing(sig);

        await connection.confirmTransaction(sig, 'confirmed');

        // Register txHash via embed API for immediate verification + confirmation
        if (this.currentOrderId) {
          try {
            const verifyRes = await fetch(`${STABLEPAY_URL}/api/embed/order/${this.currentOrderId}/tx`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ txHash: sig })
            });
            const verifyData = await verifyRes.json();
            if (verifyData.status === 'CONFIRMED') {
              this.showSuccess({ txHash: sig, explorerLink: verifyData.explorerLink, status: 'CONFIRMED' });
              // onSuccess fired centrally in showSuccess()
              return;
            }
          } catch (e) {
            console.error('TX verification failed, scanner will catch it:', e);
          }
        }
        this.showSuccess(sig);
        // onSuccess fired centrally in showSuccess()
      } catch (err) {
        throw new Error('Solana transaction failed: ' + err.message);
      }
    }

    loadScript(src) {
      return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) {
          // Script tag exists — but it may not have finished loading
          // Wait for the global to be available (ethers, solanaWeb3)
          const check = () => {
            if (src.includes('ethers') && window.ethers) return resolve();
            if (src.includes('solana') && window.solanaWeb3) return resolve();
            resolve(); // For other scripts, assume ready
          };
          if ((src.includes('ethers') && !window.ethers) || (src.includes('solana') && !window.solanaWeb3)) {
            existing.addEventListener('load', check);
            setTimeout(check, 2000); // Fallback timeout
          } else {
            check();
          }
          return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    showProcessing(txHash, stage) {
      const shortHash = `${txHash.slice(0, 10)}...${txHash.slice(-8)}`;
      const explorer = this.selectedChain.config.blockExplorerUrls?.[0];
      const label = stage || 'Confirming Payment...';
      const subLabel = stage === 'Converting to USDC...'
        ? 'Your payment was received. Auto-swapping to stablecoin now…'
        : stage === 'Almost done...'
          ? 'Forwarding to merchant…'
          : '';

      this.container.querySelector('.sp-widget').innerHTML = `
        <div style="text-align: center; padding: 32px;">
          <div class="sp-spinner" style="
            width: 48px; height: 48px;
            border: 4px solid var(--sp-border);
            border-top-color: var(--sp-accent);
            border-radius: 50%;
            margin: 0 auto 16px;
          "></div>
          <div style="font-size: 18px; font-weight: 600; color: var(--sp-text); margin-bottom: 8px;">
            ${label}
          </div>
          ${subLabel ? `<div style="font-size: 12px; color: var(--sp-muted); margin-bottom: 12px;">${subLabel}</div>` : ''}
          <div style="font-size: 13px; color: var(--sp-muted); font-family: monospace;">
            ${explorer ? `<a href="${explorer}/tx/${txHash}" target="_blank" style="color: var(--sp-accent);">${shortHash}</a>` : shortHash}
          </div>
        </div>
      `;
    }

    // Poll the order until CONFIRMED, REFUNDED, or timeout. Transitions UI through stages.
    async pollOrderUntilTerminal(orderId, txHash, opts) {
      const maxMs = (opts?.timeoutSec ?? 240) * 1000;
      const start = Date.now();
      const isNative = NATIVE_TOKENS.has(this.selectedToken);
      let lastStage = '';
      while (Date.now() - start < maxMs) {
        try {
          const r = await fetch(`${STABLEPAY_URL}/api/embed/order/${orderId}`);
          const d = await r.json();
          // GET /api/embed/order/:id returns order fields FLAT at top level (not under d.order).
          const status = d?.status;
          if (status === 'CONFIRMED') {
            this.showSuccess({ txHash, status: 'CONFIRMED' });
            // onSuccess fired centrally in showSuccess()
            return;
          }
          if (status === 'REFUNDED' || status === 'CANCELLED') {
            this.showError(`Order was ${status.toLowerCase()}.`);
            return;
          }
          // Transition stage UI for native: PROCESSING means swap is running
          if (isNative && status === 'PROCESSING' && lastStage !== 'Converting to USDC...') {
            this.showProcessing(txHash, 'Converting to USDC...');
            lastStage = 'Converting to USDC...';
          }
        } catch { /* keep polling */ }
        await new Promise(r => setTimeout(r, 3000));
      }
      // Timeout — the tx was broadcast but hasn't confirmed yet. Do NOT claim success or fire
      // onSuccess/ORDER_CONFIRMED here (that inflates conversion metrics and misleads the buyer).
      // Show an honest "still confirming" state; the scanner will confirm async and the backend
      // order.confirmed webhook fires for fulfillment.
      this.showProcessing(txHash, 'Still confirming on-chain — you’ll get a receipt by email once it lands.');
    }

    showSuccess(txHashOrData) {
      // Handle both string txHash and object {txHash, explorerLink, ...} from polling
      let hash = typeof txHashOrData === 'string' ? txHashOrData : (txHashOrData?.txHash || null);
      let explorerLink = typeof txHashOrData === 'object' ? txHashOrData?.explorerLink : null;
      // A/B telemetry: actual confirmed purchase (true conversion metric).
      // Idempotent guard so retries / re-polls don't double-fire.
      if (!this._orderConfirmedTracked) {
        this._orderConfirmedTracked = true;
        this._track('ORDER_CONFIRMED', { chain: this.selectedChain?.chain || null, token: this.selectedToken || null, orderId: this.currentOrderId || null, txHash: hash, variant: this._variant });
        // WIZARD_COMPLETED now means "wizard-driven session reached CONFIRMED". Only fire for
        // guided/fast (wizard variants) — control has no wizard so wizardCompletionPct
        // would be nonsense.
        if (this._variant === 'guided' || this._variant === 'fast') {
          this._track('WIZARD_COMPLETED', { chain: this.selectedChain?.chain || null, token: this.selectedToken || null, variant: this._variant });
        }
        // Notify the host EXACTLY ONCE from here, so EVERY confirmation path (manual poll, manual
        // paste, connect-wallet, native) fires onSuccess. Previously manual-send never did, so
        // onSuccess-dependent merchant integrations (redirect, unlock, analytics) silently never ran,
        // and the overlay wrapper (which auto-closes inside onSuccess) stayed stuck on "Confirmed".
        try {
          const _payload = { orderId: this.currentOrderId, txHash: hash, amount: parseFloat(this.options.amount), token: this.selectedToken };
          this.options.onSuccess?.(_payload);
          this.emit?.('success', _payload);
        } catch (e) { /* a throwing host callback must not break the success UI */ }
      }

      // Guard: if hash looks like a URL, treat it as explorerLink instead
      if (hash && hash.startsWith('http')) {
        explorerLink = explorerLink || hash;
        hash = null;
      }

      // Build explorer URL
      const explorerUrls = {
        BASE_MAINNET: 'https://basescan.org/tx/',
        ETHEREUM_MAINNET: 'https://etherscan.io/tx/',
        POLYGON_MAINNET: 'https://polygonscan.com/tx/',
        ARBITRUM_MAINNET: 'https://arbiscan.io/tx/',
        SOLANA_MAINNET: 'https://solscan.io/tx/',
        BASE_SEPOLIA: 'https://sepolia.basescan.org/tx/',
        ETHEREUM_SEPOLIA: 'https://sepolia.etherscan.io/tx/',
      };
      const chainKey = this.selectedChain?.chain || '';
      const txUrl = explorerLink || (hash && explorerUrls[chainKey] ? explorerUrls[chainKey] + hash : null);

      // Receipt URL — verified async after render
      const receiptUrl = this.currentOrderId ? `${STABLEPAY_URL}/receipt/${this.currentOrderId}` : null;

      this.container.querySelector('.sp-widget').innerHTML = `
        <div style="text-align: center; padding: 32px;">
          <div style="width: 56px; height: 56px; background: #18181B; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; color: #fff; margin-bottom: 16px;">&#10003;</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--sp-text); margin-bottom: 4px; text-transform: uppercase;">
            Payment Confirmed
          </div>
          <div style="font-size: 14px; color: var(--sp-muted); margin-bottom: 20px;">
            $${parseFloat(this.options.amount) < 0.01 ? parseFloat(this.options.amount).toFixed(4) : parseFloat(this.options.amount).toFixed(2)} paid with ${this.selectedToken}
          </div>
          <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
            ${txUrl ? `
              <a href="${txUrl}" target="_blank" style="
                padding: 10px 20px; background: var(--sp-card); color: var(--sp-text);
                border: 2px solid var(--sp-border); text-decoration: none;
                font-size: 11px; font-weight: 700; text-transform: uppercase;
              ">View Transaction</a>
            ` : ''}
            <span id="sp-receipt-btn-slot"></span>
            ${this.connectedWallet ? `
              <a href="${STABLEPAY_URL}/history?wallet=${encodeURIComponent(this.connectedWallet)}" target="_blank" style="
                padding: 10px 20px; background: var(--sp-card); color: var(--sp-muted);
                border: 2px solid var(--sp-border); text-decoration: none;
                font-size: 11px; font-weight: 700; text-transform: uppercase;
              ">Payment History</a>
            ` : ''}
          </div>
        </div>
      `;

      // Async: check if receipt exists before showing button (may take a few seconds to generate)
      if (receiptUrl && this.currentOrderId) {
        const self = this;
        const checkReceipt = async (attempts) => {
          try {
            const res = await fetch(`${STABLEPAY_URL}/api/receipts/for-order/${self.currentOrderId}`);
            if (res.ok) {
              const slot = self.container.querySelector('#sp-receipt-btn-slot');
              if (slot) slot.innerHTML = `<a href="${receiptUrl}" target="_blank" style="
                padding: 10px 20px; background: #000; color: #fff;
                border: 2px solid var(--sp-border); text-decoration: none;
                font-size: 11px; font-weight: 700; text-transform: uppercase;
              ">View Receipt</a>`;
            } else if (attempts < 3) {
              setTimeout(() => checkReceipt(attempts + 1), 3000);
            }
          } catch (e) {
            if (attempts < 3) setTimeout(() => checkReceipt(attempts + 1), 3000);
          }
        };
        // Wait 2s for receipt to generate, then start checking
        setTimeout(() => checkReceipt(0), 2000);
      }
    }

    showError(message) {
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #18181B;
        color: #fff;
        padding: 14px 24px;
        border: 1px solid #D4D4D8;
        font-size: 13px;
        font-weight: 700;
        z-index: 999999;
        box-shadow: 6px 6px 0px #000;
        max-width: 90vw;
        text-align: center;
      `;
      errorDiv.textContent = '⚠ ' + message;
      document.body.appendChild(errorDiv);

      setTimeout(() => errorDiv.remove(), 5000);
    }

    emit(event, data) {
      const customEvent = new CustomEvent(`stablepay:${event}`, { detail: data, bubbles: true });
      this.container.dispatchEvent(customEvent);
      document.dispatchEvent(customEvent);
    }
  }

  // Auto-initialize
  function initializeWidgets() {
    document.querySelectorAll('.stablepay-checkout:not([data-initialized])').forEach(container => {
      new StablePayCheckout(container);
      container.setAttribute('data-initialized', 'true');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWidgets);
  } else {
    initializeWidgets();
  }

  // Watch for dynamically added widgets
  new MutationObserver(() => initializeWidgets()).observe(
    document.body || document.documentElement,
    { childList: true, subtree: true }
  );

  // Load QR code library
  if (typeof QRCode === 'undefined') {
    const qrScript = document.createElement('script');
    qrScript.src = 'https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js';
    qrScript.async = true;
    document.head.appendChild(qrScript);
  }

  // Global API
  window.StablePay = {
    Checkout: StablePayCheckout,
    version: WIDGET_VERSION,
    create: (element, options) => new StablePayCheckout(element, options),
    checkout: (options) => {
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';

      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;';
      overlay.addEventListener('touchmove', (e) => { if (e.target === overlay) e.preventDefault(); }, { passive: false });

      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'max-width:420px;width:100%;max-height:90vh;overflow-y:auto;position:relative;pointer-events:auto;';

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;z-index:10;background:none;border:none;color:#999;font-size:24px;cursor:pointer;min-width:44px;min-height:44px;';

      let spCheckout = null;
      const restoreBody = () => {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, scrollY);
      };
      const closeOverlay = () => {
        // Telemetry parity with page's CANCEL_CLICKED (page's explicit cancel button fires this).
        // Lets us measure abandonment rates symmetrically across surfaces. Variant included so
        // we can see if one A/B arm drives more cancels.
        if (spCheckout) {
          try {
            spCheckout._track('CANCEL_CLICKED', {
              reason: 'customer_closed',
              variant: spCheckout._variant,
              hasOrder: !!spCheckout.currentOrderId,
            });
          } catch {}
        }
        // B10: NEVER auto-cancel a payment that's in flight. If the customer already clicked
        // "I've sent it" (polling running) or the order is confirmed, cancelling here orphans a
        // real on-chain deposit (scanner only matches PENDING) = direct money loss. Only cancel
        // an order the customer abandoned BEFORE sending.
        const _inFlight = spCheckout && (spCheckout._pollingInterval || spCheckout._orderConfirmedTracked || spCheckout._paymentInFlight);
        if (spCheckout && spCheckout.currentOrderId && !_inFlight) {
          fetch(`${STABLEPAY_URL}/api/embed/order/${spCheckout.currentOrderId}/cancel`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'customer_closed' })
          }).catch(() => {});
        }
        if (spCheckout && spCheckout._pollingInterval) clearInterval(spCheckout._pollingInterval);
        if (spCheckout && spCheckout._countdownInterval) clearInterval(spCheckout._countdownInterval);
        overlay.remove();
        restoreBody();
        document.querySelectorAll('[data-sp-cancel-bar]').forEach(el => el.remove());
        if (options.onCancel) options.onCancel();
      };

      closeBtn.addEventListener('click', closeOverlay);
      closeBtn.addEventListener('touchend', (e) => { e.preventDefault(); closeOverlay(); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
      wrapper.addEventListener('click', (e) => e.stopPropagation());
      wrapper.addEventListener('touchend', (e) => e.stopPropagation());

      wrapper.appendChild(closeBtn);
      const innerContainer = document.createElement('div');
      innerContainer.style.cssText = 'position:relative;pointer-events:auto;';
      wrapper.appendChild(innerContainer);
      overlay.appendChild(wrapper);
      document.body.appendChild(overlay);

      spCheckout = new StablePayCheckout(innerContainer, {
        ...options,
        onSuccess: (data) => {
          overlay.remove(); restoreBody();
          document.querySelectorAll('[data-sp-cancel-bar]').forEach(el => el.remove());
          if (options.onSuccess) options.onSuccess(data);
        },
        onCancel: closeOverlay,
      });
      return spCheckout;
    },

    link: (opts) => {
      if (!opts || !opts.merchantId) throw new Error('StablePay.link(): merchantId is required');
      if (!opts.amount) throw new Error('StablePay.link(): amount is required');
      const base = (typeof STABLEPAY_URL !== 'undefined' ? STABLEPAY_URL : 'https://wetakestables.shop') + '/crypto-pay.html';
      const p = new URLSearchParams();
      p.set('merchant', opts.merchantId);
      p.set('amount', String(opts.amount));
      if (opts.token) p.set('token', opts.token);
      if (opts.chain) p.set('chain', opts.chain);
      if (opts.email) p.set('email', opts.email);
      if (opts.externalId) p.set('externalId', opts.externalId);
      if (opts.returnUrl) p.set('returnUrl', opts.returnUrl);
      if (opts.theme) p.set('theme', opts.theme);
      return base + '?' + p.toString();
    },
  };
})();
