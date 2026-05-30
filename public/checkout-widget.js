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
      const accent = this.options.accentColor;
      const brutal = this.options.borderStyle === 'brutal';
      this.container.innerHTML = `
        <div class="sp-widget sp-wiz ${this.options.theme}" style="
          background: ${isDark ? '#1a1a1a' : '#fff'};
          color: ${isDark ? '#fff' : '#000'};
          ${brutal ? 'border: 4px solid #000; box-shadow: 8px 8px 0 #000;' : 'border: 1px solid #e5e7eb; border-radius: 12px;'}
          padding: 24px 20px;
          pointer-events: auto;
          font-family: ${this.options.fontFamily || "'Space Grotesk', -apple-system, system-ui, sans-serif"};
        ">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;min-height:24px;">
            <button id="sp-wiz-back" type="button" style="visibility:hidden;background:none;border:none;color:${isDark ? '#9ca3af' : '#6b7280'};font-size:12px;font-weight:600;cursor:pointer;padding:4px 8px;">← Back</button>
            <div style="text-align:center;flex:1;">
              <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: ${isDark ? '#888' : '#666'}; font-weight: 700;">Quick setup</div>
              <div id="sp-wiz-step-label" style="font-size: 11px; color: ${isDark ? '#666' : '#999'}; margin-top: 2px;">Step 1 of 3</div>
            </div>
            <button id="sp-wiz-info" type="button" aria-label="Help" style="width:24px;height:24px;border-radius:50%;background:${isDark ? '#2a2a2a' : '#f3f4f6'};border:1px solid ${isDark ? '#666' : '#d1d5db'};color:${isDark ? '#999' : '#6b7280'};font-size:12px;font-weight:700;cursor:pointer;padding:0;">i</button>
          </div>
          <div id="sp-wiz-info-panel" style="display:none;background:${isDark ? '#0f172a' : '#f9fafb'};border:1px solid ${isDark ? '#334155' : '#e5e7eb'};padding:10px 12px;margin-bottom:12px;font-size:11px;color:${isDark ? '#cbd5e1' : '#374151'};line-height:1.5;border-radius:4px;white-space:pre-line;"></div>
          <div id="sp-wiz-body"></div>
          <div style="text-align: center; margin-top: 16px;">
            <button id="sp-wiz-skip" style="background: none; border: none; color: ${isDark ? '#666' : '#999'}; font-size: 11px; text-decoration: underline; cursor: pointer; padding: 4px;">Skip — show all options</button>
          </div>
        </div>`;
      this._wizStart();
    }

    // Decide the first wizard step. With native payments off there's only one pay type, so the
    // "Stablecoin vs Native" question is a dead one-option screen — skip it. With a single chain,
    // skip the network step too.
    _wizStart() {
      const anyNative = (this.merchantChains || []).some(mc => mc.acceptNativeTokens && CHAIN_NATIVE_TOKEN[mc.chain]);
      const multiChain = (this.merchantChains || []).length > 1;
      if (anyNative) { this._wizGoStep('1'); return; }
      this._wizardState.payType = 'stable';
      if (multiChain) { this._wizGoStep('network'); return; }
      this._selectWizChain((this.merchantChains[0] || {}).chain);
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
      const primaryBtnStyle = `width:100%;padding:14px 12px;background:${accent};color:#000;border:3px solid #000;font-weight:700;font-size:14px;cursor:pointer;text-align:left;display:flex;align-items:center;justify-content:space-between;-webkit-appearance:none;appearance:none;touch-action:manipulation;`;
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
            <a href="https://phantom.app/" target="_blank" rel="noopener" style="${secondaryBtnStyle};margin-top:0;text-decoration:none;"><span><span style="display:block">Phantom</span><span style="${subStyle}">Best for Solana (cheapest)</span></span><span>↗</span></a>
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
            const sub = mc.chain === 'SOLANA_MAINNET' ? 'Fastest + cheapest'
              : mc.chain === 'BASE_MAINNET' ? 'Low fees'
              : (mc.config?.network === 'testnet' ? 'Testnet' : '');
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
        'network': ['Pick your network.', 'Choose the chain your funds are on. Solana and Base are cheapest + fastest.'],
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
        this._selectWizChain((this.merchantChains[0] || {}).chain);
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
      bar.style.cssText = 'text-align:center;padding:8px;background:#f8fafc;border-bottom:1px solid #e2e8f0;';
      bar.innerHTML = `<button type="button" style="background:none;border:none;color:#3b82f6;font-size:12px;font-weight:600;cursor:pointer;text-decoration:underline;">← Back to guided setup</button>`;
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
      // Hide pay-mode toggle + fee banner — wizard already chose pay type (and native is disabled).
      const modeToggle = w.querySelector('#sp-pay-mode-toggle');
      if (modeToggle) modeToggle.style.display = 'none';
      // Hide the Network/Token grid — the chain is already chosen in the wizard's network step, so
      // the big in-page selectors are just clutter on the send screen (this is the "too busy / can't
      // pick network" complaint). The "← Change" header below lets them rewind to re-pick.
      const grids = w.querySelectorAll('div[style*="grid-template-columns: 1fr 1fr"]');
      grids.forEach(g => { if (g.querySelector('#sp-chain-select-wrapper') || g.querySelector('#sp-token-select-wrapper')) g.style.display = 'none'; });
      // Hide the method tabs — wizard already chose connect vs manual.
      const tabs = w.querySelector('#sp-method-tabs');
      if (tabs) tabs.style.display = 'none';
      // Inject a wizard-style header above the action area so it feels like a wizard step.
      const inner = w.querySelector('.sp-widget');
      if (inner && !w.querySelector('#sp-wiz-step3-header')) {
        const _total = this._wizStepOrder().length + 1;
        const _what = this._wizardState.method === 'wallet' ? 'Connect & pay' : 'Send payment';
        const stepLabel = `Step ${_total} of ${_total} — ${_what}`;
        const header = document.createElement('div');
        header.id = 'sp-wiz-step3-header';
        header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;';
        header.innerHTML = `<span>${stepLabel}</span><button id="sp-wiz-back" type="button" style="background:none;border:none;color:#3b82f6;font-size:11px;font-weight:600;cursor:pointer;text-decoration:underline;text-transform:none;letter-spacing:0;">← Change</button>`;
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
        .sp-widget select { font-family: 'Space Grotesk', system-ui, sans-serif; }
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
          // Sort chains by global usage (Solana > Ethereum > TRON > BNB > Base > rest)
          const chainPriority = { SOLANA_MAINNET: 0, ETHEREUM_MAINNET: 1, TRON_MAINNET: 2, BNB_MAINNET: 3, BASE_MAINNET: 4, POLYGON_MAINNET: 5, ARBITRUM_MAINNET: 6 };
          this.merchantChains = data.wallets
            .filter(w => CHAIN_CONFIG[w.chain])
            .map(w => ({
              chain: w.chain,
              address: w.address,
              supportedTokens: w.supportedTokens || ['USDC'],
              acceptNativeTokens: !!w.acceptNativeTokens,
              preferredStablecoin: w.preferredStablecoin || 'USDC',
              config: CHAIN_CONFIG[w.chain]
            }))
            .sort((a, b) => (chainPriority[a.chain] ?? 99) - (chainPriority[b.chain] ?? 99));
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
            border: 3px solid ${isDark ? '#333' : '#e5e7eb'};
            border-top-color: ${this.options.accentColor};
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
          --sp-accent: ${accent};
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
          <div style="background: ${this.options.headerColor}; padding: 16px 20px; ${this.options.borderStyle === 'brutal' ? 'border-bottom: 4px solid #000;' : 'border-bottom: 1px solid var(--sp-border);'}">
            ${this.options.logoUrl ? `<img src="${this.options.logoUrl}" style="height: 24px; margin-bottom: 8px;" alt="logo">` : ''}
            <div style="font-size: 11px; font-weight: 700; color: ${this.options.headerTextColor === 'light' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px;">
              ${this.options.productName || 'Pay with Stablecoins'}
            </div>
            <div id="sp-amount-display" style="font-size: 28px; font-weight: 700; color: ${this.options.headerTextColor === 'light' ? '#fff' : '#000'};">
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
          <!-- Conversion fee banner -->
          <div id="sp-fee-banner" style="display: none; background: #fefce8; border: 2px solid #facc15; padding: 10px 12px; margin-bottom: 12px; font-size: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
              <div>
                <strong style="color: #713f12;">1.5% conversion fee</strong>
                <span style="color: #92400e;"> — You'll send <strong id="sp-native-send-amt">—</strong></span>
              </div>
              <button type="button" onclick="window._spWidget?.setPayMode('stable')" style="
                font-size: 11px; font-weight: 700; text-decoration: underline; color: #713f12;
                background: none; border: none; cursor: pointer; white-space: nowrap; padding: 0;
              ">Use USDC →</button>
            </div>
            <div id="sp-native-expiry" style="font-size: 10px; color: #92400e; margin-top: 4px;"></div>
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
                background: #00E5FF; color: #000; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;
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
                  <div style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></div>
                  <span style="font-size: 12px; color: var(--sp-muted); font-weight: 600;">Not connected</span>
                </div>
                <button id="sp-connect-btn" style="
                  padding: 6px 14px; background: #000; color: #fff;
                  border: 2px solid var(--sp-border); font-size: 11px; font-weight: 700; cursor: pointer; text-transform: uppercase;
                ">Connect</button>
              </div>
              <button id="sp-pay-btn" class="sp-pay-btn" disabled style="
                width: 100%; padding: 14px; background: #00E5FF; color: #000;
                border: 3px solid var(--sp-border); font-size: 14px; font-weight: 700; cursor: pointer;
                box-shadow: 4px 4px 0px #000;
              ">Connect Wallet to Pay</button>
            </div>

            <!-- Method: Send Payment (default) -->
            <div id="sp-method-send" class="sp-method-panel">
              <!-- Step indicator -->
              <div id="sp-step-indicator" style="display: flex; align-items: center; justify-content: center; gap: 0; margin-bottom: 14px; padding: 0 12px;">
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
                    padding: 8px 16px; background: #00E5FF; color: #000; border: none;
                    font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase;
                    border-radius: 3px; flex-shrink: 0;
                  ">Next</button>
                </div>
              </div>
              <!-- Step 2: QR + Address + Amount (hidden until step 1 done) -->
              <div id="sp-send-step2" style="display: none; padding: 12px;">
                <!-- Toggle: QR / Address -->
                <div style="display: flex; gap: 0; margin-bottom: 12px; border: 2px solid var(--sp-border);">
                  <button id="sp-send-toggle-qr" style="flex:1; padding: 6px; font-size: 9px; font-weight: 700; border: none; background: #00E5FF; color: #000; cursor: pointer; text-transform: uppercase;">QR Code</button>
                  <button id="sp-send-toggle-addr" style="flex:1; padding: 6px; font-size: 9px; font-weight: 700; border: none; border-left: 2px solid var(--sp-border); background: var(--sp-card); color: var(--sp-muted); cursor: pointer; text-transform: uppercase;">Copy Address</button>
                </div>

                <!-- QR View (default) -->
                <div id="sp-send-view-qr" style="text-align: center; margin-bottom: 12px;">
                  <!-- Solana Pay toggle (only visible on Solana) -->
                  <div id="sp-solanapay-toggle" style="display: none; margin-bottom: 10px;">
                    <label style="display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; background: #9945FF15; border: 1px solid #9945FF40; padding: 6px 12px; border-radius: 6px;">
                      <input type="checkbox" id="sp-solanapay-check" style="width: 14px; height: 14px; accent-color: #9945FF;">
                      <span style="font-size: 10px; color: #9945FF; font-weight: 700;">Solana Pay QR</span>
                      <span style="font-size: 8px; color: var(--sp-muted);">Phantom / Solflare</span>
                    </label>
                  </div>
                  <div style="background: white; padding: 10px; display: inline-block; border: 2px solid var(--sp-border); margin-bottom: 8px;">
                    <canvas id="sp-qr-canvas" width="140" height="140"></canvas>
                  </div>
                  <p style="font-size: 11px; color: var(--sp-text); font-weight: 600;">Send exactly <span id="sp-send-amount-display" style="color: #00E5FF;"></span></p>
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
                  width: 100%; padding: 12px; background: #00E5FF; color: #000; border: 3px solid var(--sp-border);
                  font-weight: 700; font-size: 12px; cursor: pointer; text-transform: uppercase; box-shadow: 4px 4px 0px #000;
                ">I've Sent the Payment</button>
                <button id="sp-send-back-btn" style="
                  width: 100%; padding: 8px; background: transparent; color: var(--sp-muted); border: none;
                  font-size: 11px; cursor: pointer; margin-top: 6px; text-decoration: underline;
                ">← Change wallet address</button>
              </div>
              <!-- Step 3: Verification -->
              <div id="sp-send-step3" style="display: none; padding: 20px;">
                <!-- Expiry warning banner -->
                <div id="sp-expiry-warning" style="display:none;"></div>
                <!-- Progress bar -->
                <div style="width: 100%; height: 4px; background: var(--sp-card); margin-bottom: 16px; overflow: hidden;">
                  <div id="sp-progress-bar" style="width: 0%; height: 100%; background: #00E5FF; transition: width 1s linear;"></div>
                </div>

                <div style="text-align: center;">
                  <p id="sp-poll-status" style="font-size: 12px; font-weight: 700; color: var(--sp-text); margin-bottom: 4px;">Scanning the blockchain...</p>
                  <p id="sp-poll-timer" style="font-size: 9px; color: var(--sp-muted);">This can take up to a minute</p>
                </div>

                <!-- Manual TX (hidden until 15s) -->
                <div id="sp-manual-tx" style="display: none; margin-top: 16px; text-align: left;">
                  <div style="background: var(--sp-card); border: 1px solid var(--sp-border); padding: 10px; border-radius: 4px;">
                    <p style="font-size: 11px; font-weight: 600; color: var(--sp-text); margin-bottom: 6px;">Paste your transaction ID</p>
                    <div style="display: flex; gap: 6px;">
                      <input id="sp-manual-tx-input" type="text" placeholder="" style="
                        flex: 1; padding: 8px; font-size: 14px; font-family: inherit; border: 1px solid var(--sp-border);
                        background: var(--sp-bg); color: var(--sp-text); outline: none;
                        text-overflow: ellipsis; overflow: hidden; border-radius: 3px;
                      ">
                      <button id="sp-manual-tx-btn" style="
                        padding: 8px 12px; background: #000; color: #fff; border: none;
                        font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase;
                        border-radius: 3px; flex-shrink: 0;
                      ">Verify</button>
                    </div>
                    <p id="sp-manual-tx-hint" style="font-size: 9px; color: var(--sp-muted); margin-top: 3px;"></p>
                    <p id="sp-manual-tx-status" style="font-size: 9px; color: var(--sp-muted); margin-top: 3px; display: none;"></p>
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
      const tokenOrder = { USDC: 0, USDT: 1, EURC: 2 };
      return [...this.selectedChain.supportedTokens]
        .filter(t => this.selectedChain.config.tokens[t])
        .sort((a, b) => (tokenOrder[a] ?? 99) - (tokenOrder[b] ?? 99));
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
                      ? '<span class="sp-spinner" style="display:inline-block;width:16px;height:16px;border:2px solid var(--sp-border);border-top-color:#00E5FF;border-radius:50%;margin-bottom:8px;"></span>'
                      : '<div style="color:#22c55e;font-size:20px;font-weight:700;margin-bottom:4px;">✓</div>'}
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
                  <summary style="cursor:pointer;font-weight:600;color:var(--sp-muted);">Can't find your TX? — help us reach you ▾</summary>
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
                  if (kind === 'wallet' && (!v || v.length < 10)) { statusEl.style.display = 'block'; statusEl.style.color = '#ef4444'; statusEl.textContent = 'Invalid wallet'; return; }
                  if (kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '')) { statusEl.style.display = 'block'; statusEl.style.color = '#ef4444'; statusEl.textContent = 'Invalid email'; return; }
                  const body = kind === 'wallet' ? { customerWallet: v } : { customerEmail: v };
                  try {
                    const res = await fetch(`${STABLEPAY_URL}/api/embed/order/${self.currentOrderId}/contact`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
                    });
                    if (res.ok) {
                      statusEl.style.display = 'block'; statusEl.style.color = '#10b981';
                      statusEl.textContent = kind === 'email' ? 'Saved — we\'ll email you.' : 'Saved — scanner will match.';
                      self._track('FAST_CONFIRMATION_PROVIDED', { type: kind, variant: self._variant });
                    } else {
                      const data = await res.json().catch(() => ({}));
                      statusEl.style.display = 'block'; statusEl.style.color = '#ef4444';
                      statusEl.textContent = data.error || 'Save failed';
                    }
                  } catch {
                    statusEl.style.display = 'block'; statusEl.style.color = '#ef4444';
                    statusEl.textContent = 'Network error';
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
          toggleQR.style.background = '#00E5FF'; toggleQR.style.color = '#000';
          toggleAddr.style.background = 'var(--sp-card)'; toggleAddr.style.color = 'var(--sp-muted)';
        });
        toggleAddr.addEventListener('click', () => {
          this.container.querySelector('#sp-send-view-qr').style.display = 'none';
          this.container.querySelector('#sp-send-view-addr').style.display = 'block';
          toggleAddr.style.background = '#00E5FF'; toggleAddr.style.color = '#000';
          toggleQR.style.background = 'var(--sp-card)'; toggleQR.style.color = 'var(--sp-muted)';
        });
      }

      // Copy buttons (delegated)
      this.container.addEventListener('click', (e) => {
        if (e.target.id === 'sp-copy-addr-btn') {
          const addr = this.container.querySelector('#sp-pay-address')?.textContent;
          if (addr) {
            navigator.clipboard.writeText(addr);
            e.target.textContent = 'COPIED!';
            this._track('ADDRESS_COPIED', { chain: this.selectedChain?.chain });
            setTimeout(() => e.target.textContent = 'COPY', 1500);
          }
        }
        if (e.target.id === 'sp-copy-amt-btn') {
          const amt = this.container.querySelector('#sp-pay-amount')?.textContent;
          if (amt) { navigator.clipboard.writeText(amt.split(' ')[0]); e.target.textContent = 'COPIED!'; setTimeout(() => e.target.textContent = 'COPY', 1500); }
        }
      });
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
          dot.style.background = '#22c55e';
          dot.style.color = '#fff';
          dot.style.border = 'none';
          dot.innerHTML = '✓';
        } else if (step === activeStep) {
          // Active
          dot.style.background = '#000';
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
          line.style.background = (i + 1) < activeStep ? '#22c55e' : 'var(--sp-border)';
        });
      }
    }

    switchPaymentMethod(method) {
      // Update tabs — neo-brutalist active state
      this.container.querySelectorAll('.sp-method-tab').forEach(tab => {
        if (tab.dataset.method === method) {
          tab.style.background = '#00E5FF';
          tab.style.color = '#000';
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
              customerWallet: this.connectedWallet || null,
              paymentMethod: 'MANUAL_SEND',
              source: 'EMBED_WIDGET',
            })
          });
          const data = await res.json();
          if (!data.success) {
            if (step1 && prevStep1Html) step1.innerHTML = prevStep1Html;
            this.showError(data.error || 'Failed to create payment');
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
          const canvas = this.container.querySelector('#sp-qr-canvas');
          if (canvas) {
            const nativeAmt = nativeSendAmt || (this.nativePriceUsd ? ((usdAmount + fee) / this.nativePriceUsd) : null);
            const qrData = (chain.chain === 'SOLANA_MAINNET' && nativeAmt)
              ? `solana:${receiveAddress}?amount=${parseFloat(nativeAmt)}`
              : receiveAddress;
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

          this.lockSelectors();
          this.startCountdown();
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
      if (this.selectedToken === 'EURC' && this.eurcRate) {
        amount = parseFloat((amount / this.eurcRate).toFixed(2));
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

      const canvas = this.container.querySelector('#sp-qr-canvas');
      const chainConfig = this.selectedChain?.config;
      const tokenConfig = chainConfig?.tokens?.[this.selectedToken];

      const solPayToggle = this.container.querySelector('#sp-solanapay-toggle');
      const solPayCheck = this.container.querySelector('#sp-solanapay-check');
      if (solPayToggle) solPayToggle.style.display = chainConfig?.type === 'solana' ? 'block' : 'none';

      const generateQR = (useSolanaPay = false) => {
        if (!canvas || typeof QRCode === 'undefined') return;
        let qrData = walletAddr;
        if (useSolanaPay && chainConfig?.type === 'solana' && tokenConfig?.address) {
          qrData = `solana:${walletAddr}?amount=${amount}&spl-token=${tokenConfig.address}`;
        }
        QRCode.toCanvas(canvas, qrData, { width: 140, margin: 2, color: { dark: '#000', light: '#fff' } }, (err) => {
          if (err) console.error('QR generation failed:', err);
        });
      };

      if (canvas) {
        const waitAndRender = () => {
          if (typeof QRCode !== 'undefined') { generateQR(false); } else { setTimeout(waitAndRender, 500); }
        };
        waitAndRender();
      }

      if (solPayCheck) {
        solPayCheck.checked = false;
        solPayCheck.onchange = () => generateQR(solPayCheck.checked);
      }

      this.lockSelectors();
      this.startCountdown();
    }

    startCountdown() {
      if (this._countdownInterval) clearInterval(this._countdownInterval);
      let seconds = 300; // 5 minutes
      const timerEl = this.container.querySelector('#sp-countdown-time');
      const wrapperEl = this.container.querySelector('#sp-countdown');
      if (!timerEl) return;

      this._countdownInterval = setInterval(() => {
        seconds--;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

        // Color changes for urgency
        if (seconds <= 60) {
          timerEl.style.color = '#ef4444'; // Red last minute
        } else if (seconds <= 120) {
          timerEl.style.color = '#f59e0b'; // Yellow last 2 min
        }

        if (seconds <= 0) {
          clearInterval(this._countdownInterval);
          timerEl.textContent = '0:00';
          if (wrapperEl) {
            wrapperEl.innerHTML = '<p style="font-size: 11px; color: #ef4444; font-weight: 700;">Time expired — please start a new payment</p>';
          }
        }
      }, 1000);
    }

    startPaymentPolling() {
      if (this._pollingInterval) return; // Don't double-poll

      const pollStartTime = Date.now();
      const MANUAL_TX_TIMEOUT = 15000;
      let manualShown = false;

      const statusMessages = [
        { at: 0, text: 'Stablo is scanning the blockchain...' },
        { at: 5, text: 'Checking the public ledger...' },
        { at: 10, text: 'Verifying your transaction...' },
        { at: 15, text: 'Still looking — paste your TX below to help Stablo find it' },
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
              if (secsLeft <= 60 && secsLeft > 0) { warningEl.textContent = 'Less than 1 minute! Complete payment now.'; warningEl.style.cssText = 'display:block;background:#fecaca;border:2px solid #ef4444;padding:6px 10px;font-size:12px;font-weight:600;text-align:center;margin-bottom:6px;'; }
              else if (secsLeft <= 300) { warningEl.textContent = 'Less than 5 minutes remaining.'; warningEl.style.cssText = 'display:block;background:#fef3c7;border:2px solid #f59e0b;padding:6px 10px;font-size:12px;text-align:center;margin-bottom:6px;'; }
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
        if (pollTimer) pollTimer.textContent = 'Paste your transaction ID below to verify';
      }
      const txInput = this.container.querySelector('#sp-manual-tx-input');
      const txHint = this.container.querySelector('#sp-manual-tx-hint');
      const chain = this.selectedChain?.chain;
      const chainType = this.selectedChain?.config?.type;
      if (txInput) {
        txInput.placeholder = chainType === 'solana' ? 'TX signature or link...' : 'TX hash or link...';
      }
      if (txHint) {
        const explorerNames = { BASE_MAINNET: 'basescan.org', ETHEREUM_MAINNET: 'etherscan.io', POLYGON_MAINNET: 'polygonscan.com', ARBITRUM_MAINNET: 'arbiscan.io', BNB_MAINNET: 'bscscan.com', SOLANA_MAINNET: 'solscan.io', TRON_MAINNET: 'tronscan.org' };
        txHint.textContent = `Paste from ${explorerNames[chain] || 'your block explorer'}`;
      }
      const submitBtn = this.container.querySelector('#sp-manual-tx-btn');
      if (submitBtn) {
        submitBtn.addEventListener('click', async () => {
          const input = this.container.querySelector('#sp-manual-tx-input');
          const statusEl = this.container.querySelector('#sp-manual-tx-status');
          const value = input?.value?.trim();
          if (!value) return;
          // Gated on variant — only count as fast-conversion when this IS the fast arm.
          if (this._variant === 'fast') {
            this._track('FAST_CONFIRMATION_PROVIDED', { type: 'tx_hash', variant: this._variant });
          }

          // Basic format validation
          const isLink = value.startsWith('http');
              if (!isLink) {
                // TX hash validation per chain
                const ct = this.selectedChain?.config?.type;
                if (ct === 'evm' && (!value.startsWith('0x') || value.length !== 66)) {
                  if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'EVM transaction hashes start with 0x and are 66 characters'; statusEl.style.color = '#ef4444'; }
                  return;
                }
                if (ct === 'solana' && (value.startsWith('0x') || value.length < 40)) {
                  if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Solana signatures are base58 encoded, ~88 characters'; statusEl.style.color = '#ef4444'; }
                  return;
                }
                if (value.length < 20) {
                  if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'That doesn\'t look like a transaction hash'; statusEl.style.color = '#ef4444'; }
                  return;
                }
              }

              submitBtn.disabled = true;
              submitBtn.textContent = '...';
              if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Verifying on-chain...'; statusEl.style.color = 'var(--sp-muted)'; }

              try {

                // Validate explorer URL matches selected chain
                if (isLink) {
                  const chainType = this.selectedChain?.config?.type;
                  const chain = this.selectedChain?.chain;
                  const validExplorers = {
                    BASE_MAINNET: 'basescan.org', ETHEREUM_MAINNET: 'etherscan.io',
                    POLYGON_MAINNET: 'polygonscan.com', ARBITRUM_MAINNET: 'arbiscan.io',
                    BNB_MAINNET: 'bscscan.com', SOLANA_MAINNET: 'solscan.io',
                    TRON_MAINNET: 'tronscan.org',
                  };
                  const expected = validExplorers[chain];
                  if (expected && !value.includes(expected)) {
                    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = `Wrong explorer — use ${expected} for ${this.selectedChain?.config?.chainName}`; statusEl.style.color = '#ef4444'; }
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Submit';
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
                  if (statusEl) { statusEl.textContent = 'Submitted for review. You\'ll be notified once confirmed.'; statusEl.style.color = '#22c55e'; }
                  submitBtn.textContent = 'Submitted';
                } else {
                  // Never render server error bodies verbatim — prior incident: the widget
                  // displayed a full Cloudflare challenge HTML page to a customer. Strip
                  // HTML-ish content and cap to a short message, fall back to a generic
                  // reassurance if the server blob isn't human-friendly.
                  let msg = typeof data.error === 'string' ? data.error : 'Verification failed';
                  if (/<html|<!DOCTYPE|requestUrl|responseBody/i.test(msg) || msg.length > 240) {
                    msg = 'We couldn\u2019t verify right now. Our scanner will keep watching — if the TX is on-chain, your order will confirm automatically within a minute.';
                  }
                  if (statusEl) { statusEl.textContent = msg; statusEl.style.color = '#ef4444'; }
                  submitBtn.disabled = false;
                  submitBtn.textContent = 'Submit';
                }
              } catch (err) {
                if (statusEl) { statusEl.textContent = 'Network error — please try again'; statusEl.style.color = '#ef4444'; }
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit';
              }
            });
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
                ? '<span class="sp-spinner" style="display:inline-block;width:14px;height:14px;border:2px solid var(--sp-border);border-top-color:#00E5FF;border-radius:50%;"></span>'
                : '<span style="color:#22c55e;font-size:16px;font-weight:700;">✓</span>'}
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
          <div style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></div>
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
          <div style="width: 8px; height: 8px; border-radius: 50%; background: #22c55e;"></div>
          <span style="font-size: 12px; color: var(--sp-text); font-family: monospace;">${shortAddr}</span>
          <span style="font-size: 9px; color: #22c55e; font-weight: 700; text-transform: uppercase;">Verified</span>
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
            payBtn.textContent = `Insufficient ${this.selectedToken} (${balance.toFixed(2)} available)`;
            this._track('INSUFFICIENT_BALANCE', { chain: this.selectedChain?.chain, token: this.selectedToken, balance, needed: amt });
            payBtn.style.background = '#ef4444';
            payBtn.style.color = '#fff';
            return;
          }
          payBtn.disabled = false;
          payBtn.textContent = `Pay $${amt.toFixed(2)} in ${this.selectedToken} (${balance.toFixed(2)} available)`;
          payBtn.style.background = '#00E5FF';
          payBtn.style.color = '#000';
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
      payBtn.style.background = '#00E5FF';
      payBtn.style.color = '#000';
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
        payBtn.textContent = `Insufficient ${this.selectedToken} (${this.tokenBalance.toFixed(2)} available)`;
        payBtn.style.background = '#ef4444';
        payBtn.style.color = '#fff';
      } else {
        payBtn.disabled = false;
        const displayAmt = (this.selectedToken === 'EURC' && this.eurcRate)
          ? `€${(amount / this.eurcRate).toFixed(2)}`
          : `$${amount.toFixed(2)}`;
        payBtn.textContent = this.options.buttonText || `Pay ${displayAmt} ${this.selectedToken}`;
        payBtn.style.background = '#00E5FF';
        payBtn.style.color = '#000';
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
          <div style="width: 56px; height: 56px; background: #22c55e; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; color: #fff; margin-bottom: 16px;">&#10003;</div>
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
        background: #000;
        color: #fff;
        padding: 14px 24px;
        border: 3px solid #ef4444;
        font-size: 13px;
        font-weight: 700;
        z-index: 999999;
        box-shadow: 6px 6px 0px #ef4444;
        max-width: 90vw;
        text-align: center;
      `;
      errorDiv.textContent = message;
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
  };
})();
