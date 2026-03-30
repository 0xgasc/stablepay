/**
 * StablePay Embedded Checkout Widget v3.0
 * Full inline checkout - no redirects needed
 */

(function() {
  'use strict';

  const STABLEPAY_URL = 'https://wetakestables.shop';
  const WIDGET_VERSION = '3.0.0';

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
        productName: options.productName || container.dataset.product || 'Payment',
        theme: options.theme || container.dataset.theme || 'light',
        accentColor: options.accentColor || container.dataset.accent || '#00E5FF',
        // Customization options
        borderStyle: options.borderStyle || 'brutal',     // 'brutal' | 'rounded' | 'minimal'
        buttonText: options.buttonText || null,            // Custom pay button text
        logoUrl: options.logoUrl || null,                  // Merchant logo URL
        headerColor: options.headerColor || '#00E5FF',     // Header background color
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

      this.init();
    }

    async init() {
      this.injectStyles();
      this.renderLoading();
      await this.loadMerchantConfig();
      this.render();
      this.attachEventListeners();
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
        .sp-widget { font-family: 'Space Grotesk', system-ui, sans-serif; }
        .sp-widget * { box-sizing: border-box; }
        .sp-widget.dark { --sp-bg: #0f172a; --sp-card: #1e293b; --sp-border: #000; --sp-text: #fff; --sp-muted: #94a3b8; }
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
        const response = await fetch(`${STABLEPAY_URL}/api/embed/chains?merchantId=${this.options.merchantId}`);
        if (!response.ok) throw new Error('Failed to load merchant');

        const data = await response.json();
        this.merchantData = data;

        if (data.wallets && data.wallets.length > 0) {
          this.merchantChains = data.wallets
            .filter(w => CHAIN_CONFIG[w.chain])
            .map(w => ({
              chain: w.chain,
              address: w.address,
              supportedTokens: w.supportedTokens || ['USDC'],
              config: CHAIN_CONFIG[w.chain]
            }));
        }

        if (this.merchantChains.length > 0) {
          this.selectedChain = this.merchantChains[0];
          this.selectedToken = this.selectedChain.supportedTokens[0] || 'USDC';
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
          overflow: hidden;
        ">
          <!-- Header -->
          <div style="background: ${this.options.headerColor}; padding: 16px 20px; ${this.options.borderStyle === 'brutal' ? 'border-bottom: 4px solid #000;' : 'border-bottom: 1px solid var(--sp-border);'}">
            ${this.options.logoUrl ? `<img src="${this.options.logoUrl}" style="height: 24px; margin-bottom: 8px;" alt="logo">` : ''}
            <div style="font-size: 11px; font-weight: 700; color: #000; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px;">
              ${this.options.productName || 'Pay with Stablecoins'}
            </div>
            <div id="sp-amount-display" style="font-size: 28px; font-weight: 700; color: #000;">
              $${parseFloat(this.options.amount || 0).toFixed(2)}
            </div>
          </div>

          <div style="padding: 20px;">

          <!-- Chain + Token Selection -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px;">
            <div>
              <label style="font-size: 10px; font-weight: 700; color: var(--sp-muted); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Network</label>
              <select id="sp-chain-select" style="
                width: 100%; padding: 10px 12px; font-size: 13px; font-weight: 600;
                background: var(--sp-card); color: var(--sp-text); border: 3px solid #000;
                cursor: pointer; outline: none;
              ">
                ${this.merchantChains.map((mc, i) => `
                  <option value="${mc.chain}" ${i === 0 ? 'selected' : ''}>${mc.config.chainName}</option>
                `).join('')}
              </select>
            </div>
            <div>
              <label style="font-size: 10px; font-weight: 700; color: var(--sp-muted); text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px;">Stablecoin</label>
              <select id="sp-token-select" style="
                width: 100%; padding: 10px 12px; font-size: 13px; font-weight: 600;
                background: var(--sp-card); color: var(--sp-text); border: 3px solid #000;
                cursor: pointer; outline: none;
              ">
                ${this.renderTokenOptions()}
              </select>
            </div>
          </div>

          <!-- Payment Method Tabs: CONNECT vs SEND -->
          <div style="margin-bottom: 12px;">
            <div id="sp-method-tabs" style="display: flex; gap: 0; margin-bottom: 12px; border: 3px solid #000;">
              <button class="sp-method-tab" data-method="wallet" style="
                flex: 1; padding: 10px 6px; font-size: 11px; font-weight: 700; border: none;
                background: #000; color: #fff; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;
              ">Connect Wallet</button>
              <button class="sp-method-tab" data-method="send" style="
                flex: 1; padding: 10px 6px; font-size: 11px; font-weight: 700; border: none; border-left: 2px solid #000;
                background: var(--sp-card); color: var(--sp-muted); cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;
              ">Send Manually</button>
            </div>

            <!-- Method: Connect Wallet -->
            <div id="sp-method-wallet" class="sp-method-panel">
              <div id="sp-wallet-status" style="
                background: var(--sp-card); border: 3px solid #000;
                padding: 12px; margin-bottom: 12px;
                display: flex; align-items: center; justify-content: space-between;
              ">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></div>
                  <span style="font-size: 12px; color: var(--sp-muted); font-weight: 600;">Not connected</span>
                </div>
                <button id="sp-connect-btn" style="
                  padding: 6px 14px; background: #000; color: #fff;
                  border: 2px solid #000; font-size: 11px; font-weight: 700; cursor: pointer; text-transform: uppercase;
                ">Connect</button>
              </div>
              <button id="sp-pay-btn" class="sp-pay-btn" disabled style="
                width: 100%; padding: 14px; background: #00E5FF; color: #000;
                border: 3px solid #000; font-size: 14px; font-weight: 700; cursor: pointer;
                box-shadow: 4px 4px 0px #000;
              ">Connect Wallet to Pay</button>
            </div>

            <!-- Method: Send Manually (QR + Address merged) -->
            <div id="sp-method-send" class="sp-method-panel" style="display: none;">
              <!-- Step 1: Enter wallet -->
              <div id="sp-send-step1" style="padding: 12px;">
                <div style="font-size: 10px; font-weight: 700; color: var(--sp-muted); text-transform: uppercase; margin-bottom: 6px;">Step 1: Your wallet address</div>
                <div style="display: flex; gap: 6px;">
                  <input id="sp-sender-wallet" type="text" placeholder="${this.selectedChain?.config?.type === 'solana' ? 'Solana address (base58)' : '0x... (EVM address)'}" style="
                    flex: 1; padding: 8px; font-size: 11px; font-family: monospace; border: 3px solid #000;
                    background: var(--sp-card); color: var(--sp-text); outline: none;
                  ">
                  <button id="sp-sender-wallet-btn" style="
                    padding: 6px 14px; background: #000; color: #fff; border: none;
                    font-size: 11px; font-weight: 700; cursor: pointer; text-transform: uppercase;
                  ">Next</button>
                </div>
                <p style="font-size: 9px; color: var(--sp-muted); margin-top: 4px;">The address you'll send from — so we can match your payment.</p>
              </div>
              <!-- Step 2: QR + Address + Amount (hidden until step 1 done) -->
              <div id="sp-send-step2" style="display: none; padding: 12px;">
                <!-- Toggle: QR / Address -->
                <div style="display: flex; gap: 0; margin-bottom: 12px; border: 2px solid #000;">
                  <button id="sp-send-toggle-qr" style="flex:1; padding: 6px; font-size: 9px; font-weight: 700; border: none; background: #000; color: #fff; cursor: pointer; text-transform: uppercase;">QR Code</button>
                  <button id="sp-send-toggle-addr" style="flex:1; padding: 6px; font-size: 9px; font-weight: 700; border: none; border-left: 2px solid #000; background: var(--sp-card); color: var(--sp-muted); cursor: pointer; text-transform: uppercase;">Copy Address</button>
                </div>

                <!-- QR View (default) -->
                <div id="sp-send-view-qr" style="text-align: center; margin-bottom: 12px;">
                  <div style="background: white; padding: 10px; display: inline-block; border: 3px solid #000; margin-bottom: 8px;">
                    <canvas id="sp-qr-canvas" width="140" height="140"></canvas>
                  </div>
                  <p style="font-size: 11px; color: var(--sp-text); font-weight: 600;">Send exactly <span id="sp-send-amount-display" style="color: #00E5FF;"></span></p>
                  <p style="font-size: 9px; color: var(--sp-muted);">Scan with your wallet app and send the exact amount.</p>
                </div>

                <!-- Address View (hidden by default) -->
                <div id="sp-send-view-addr" style="display: none; margin-bottom: 12px;">
                  <div style="background: var(--sp-card); border: 3px solid #000; padding: 10px; margin-bottom: 8px;">
                    <div style="font-size: 9px; color: var(--sp-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Send to</div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <code id="sp-pay-address" style="font-size: 10px; color: var(--sp-text); word-break: break-all; flex: 1; font-weight: 600;"></code>
                      <button id="sp-copy-addr-btn" style="padding: 4px 10px; background: #000; color: #fff; border: none; font-size: 10px; font-weight: 700; cursor: pointer;">COPY</button>
                    </div>
                  </div>
                  <div style="background: var(--sp-card); border: 3px solid #000; padding: 10px;">
                    <div style="font-size: 9px; color: var(--sp-muted); text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Exact amount</div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span id="sp-pay-amount" style="font-size: 20px; font-weight: 700; color: var(--sp-text);"></span>
                      <button id="sp-copy-amt-btn" style="padding: 4px 10px; background: #000; color: #fff; border: none; font-size: 10px; font-weight: 700; cursor: pointer;">COPY</button>
                    </div>
                  </div>
                </div>

                <button id="sp-send-sent-btn" style="
                  width: 100%; padding: 12px; background: #00E5FF; color: #000; border: 3px solid #000;
                  font-weight: 700; font-size: 12px; cursor: pointer; text-transform: uppercase; box-shadow: 4px 4px 0px #000;
                ">I've Sent the Payment</button>
              </div>
              <!-- Step 3: Listening -->
              <div id="sp-send-step3" style="display: none; text-align: center; padding: 20px;">
                <div style="font-size: 10px; font-weight: 700; color: var(--sp-muted); text-transform: uppercase; margin-bottom: 8px;">Confirming</div>
                <div style="margin: 12px 0;">
                  <span class="sp-spinner" style="display: inline-block; width: 24px; height: 24px; border: 3px solid var(--sp-border); border-top-color: #00E5FF; border-radius: 50%;"></span>
                </div>
                <p style="font-size: 12px; color: var(--sp-text); font-weight: 600;">Listening for your payment...</p>
                <p style="font-size: 10px; color: var(--sp-muted); margin-top: 4px;">This usually takes 15-30 seconds. Don't close this window.</p>
              </div>
            </div>
          </div>

          ${this.options.hideFooter ? '' : `<!-- Footer -->
          <div style="margin-top: 16px; text-align: center; font-size: 10px; color: var(--sp-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
            Powered by <a href="${STABLEPAY_URL}" target="_blank" style="color: #000; text-decoration: none; font-weight: 700;">StablePay</a>
          </div>`}
          </div>
        </div>
      `;
    }

    renderTokenOptions() {
      if (!this.selectedChain) return '<option>USDC</option>';
      const tokens = this.selectedChain.supportedTokens;
      const chainTokens = this.selectedChain.config.tokens;
      return tokens
        .filter(t => chainTokens[t])
        .map((token, i) => `<option value="${token}" ${i === 0 ? 'selected' : ''}>${token}</option>`)
        .join('');
    }

    renderTokenButtons() {
      return this.renderTokenOptions();
    }

    attachEventListeners() {
      // Chain dropdown
      const chainSelect = this.container.querySelector('#sp-chain-select');
      if (chainSelect) {
        chainSelect.addEventListener('change', (e) => this.selectChain(e.target.value));
      }

      // Token dropdown
      const tokenSelect = this.container.querySelector('#sp-token-select');
      if (tokenSelect) {
        tokenSelect.addEventListener('change', (e) => this.selectToken(e.target.value));
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
          if (addr && addr.length > 10) {
            this.connectedWallet = addr;
            const shortAddr = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
            const step1 = this.container.querySelector('#sp-send-step1');

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
              setTimeout(() => showStep(steps.length), 1800);
            }
          }
        });
        sendWalletInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendWalletBtn.click(); });
      }

      // "I've sent it" button
      const sentBtn = this.container.querySelector('#sp-send-sent-btn');
      if (sentBtn) {
        sentBtn.addEventListener('click', () => {
          this.container.querySelector('#sp-send-step2').style.display = 'none';
          this.container.querySelector('#sp-send-step3').style.display = 'block';
          this.startPaymentPolling();
        });
      }

      // QR / Address toggle inside Send tab
      const toggleQR = this.container.querySelector('#sp-send-toggle-qr');
      const toggleAddr = this.container.querySelector('#sp-send-toggle-addr');
      if (toggleQR && toggleAddr) {
        toggleQR.addEventListener('click', () => {
          this.container.querySelector('#sp-send-view-qr').style.display = 'block';
          this.container.querySelector('#sp-send-view-addr').style.display = 'none';
          toggleQR.style.background = '#000'; toggleQR.style.color = '#fff';
          toggleAddr.style.background = 'var(--sp-card)'; toggleAddr.style.color = 'var(--sp-muted)';
        });
        toggleAddr.addEventListener('click', () => {
          this.container.querySelector('#sp-send-view-qr').style.display = 'none';
          this.container.querySelector('#sp-send-view-addr').style.display = 'block';
          toggleAddr.style.background = '#000'; toggleAddr.style.color = '#fff';
          toggleQR.style.background = 'var(--sp-card)'; toggleQR.style.color = 'var(--sp-muted)';
        });
      }

      // Copy buttons (delegated)
      this.container.addEventListener('click', (e) => {
        if (e.target.id === 'sp-copy-addr-btn') {
          const addr = this.container.querySelector('#sp-pay-address')?.textContent;
          if (addr) { navigator.clipboard.writeText(addr); e.target.textContent = 'COPIED!'; setTimeout(() => e.target.textContent = 'COPY', 1500); }
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

    switchPaymentMethod(method) {
      // Update tabs — neo-brutalist active state
      this.container.querySelectorAll('.sp-method-tab').forEach(tab => {
        if (tab.dataset.method === method) {
          tab.style.background = '#000';
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
      if (!this.selectedChain) {
        this.showError('Please select a chain first');
        return;
      }

      // Get merchant wallet for this chain
      const chain = this.selectedChain;
      const walletAddr = chain.address;

      if (!walletAddr) {
        this.showError('No wallet configured for this chain');
        return;
      }

      const amount = this.options.amount || 0;

      // Create the order so scanner knows to watch for it
      if (!this.currentOrderId) {
        try {
          const res = await fetch(`${STABLEPAY_URL}/api/embed/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              merchantId: this.options.merchantId,
              amount,
              chain: chain.chain,
              token: this.selectedToken,
              customerEmail: this.options.customerEmail,
              productName: this.options.productName,
              customerWallet: this.connectedWallet || null,
              paymentMethod: 'WALLET_CONNECT',
              source: 'EMBED_WIDGET',
            })
          });
          const data = await res.json();
          if (data.success) {
            this.currentOrderId = data.order.id;
          }
        } catch (err) {
          this.showError('Failed to create payment order');
          return;
        }
      }

      // Show step 2, hide step 1
      const step1 = this.container.querySelector('#sp-send-step1');
      const step2 = this.container.querySelector('#sp-send-step2');
      if (step1) step1.style.display = 'none';
      if (step2) step2.style.display = 'block';

      // Show address + amount in both views
      const payAddress = this.container.querySelector('#sp-pay-address');
      const payAmount = this.container.querySelector('#sp-pay-amount');
      const sendAmountDisplay = this.container.querySelector('#sp-send-amount-display');
      if (payAddress) payAddress.textContent = walletAddr;
      if (payAmount) payAmount.textContent = `${amount} ${this.selectedToken}`;
      if (sendAmountDisplay) sendAmountDisplay.textContent = `${amount} ${this.selectedToken}`;

      // Generate QR code — wait for library if needed
      const canvas = this.container.querySelector('#sp-qr-canvas');
      if (canvas) {
        const renderQR = () => {
          if (typeof QRCode !== 'undefined') {
            QRCode.toCanvas(canvas, walletAddr, { width: 140, margin: 2, color: { dark: '#000', light: '#fff' } }, (err) => {
              if (err) console.error('QR generation failed:', err);
            });
          } else {
            setTimeout(renderQR, 500);
          }
        };
        renderQR();
      }

      // Polling starts when user clicks "I've sent it" — handled in initManualPaymentFlows
    }

    startPaymentPolling() {
      if (this._pollingInterval) return; // Don't double-poll
      this._pollingInterval = setInterval(async () => {
        if (!this.currentOrderId) return;
        try {
          const res = await fetch(`${STABLEPAY_URL}/api/embed/order/${this.currentOrderId}`);
          const data = await res.json();
          if (data.status === 'CONFIRMED') {
            clearInterval(this._pollingInterval);
            this._pollingInterval = null;
            this.showSuccess(data);
          }
        } catch (err) {
          // Silently retry
        }
      }, 5000);
    }

    selectChain(chainKey) {
      const prevType = this.selectedChain?.config?.type;
      this.selectedChain = this.merchantChains.find(mc => mc.chain === chainKey);
      this.selectedToken = this.selectedChain?.supportedTokens[0] || 'USDC';

      // Update token dropdown options
      const tokenSelect = this.container.querySelector('#sp-token-select');
      if (tokenSelect) {
        tokenSelect.innerHTML = this.renderTokenOptions();
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
    }

    selectToken(token) {
      this.selectedToken = token;

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
      const chainConfig = this.selectedChain?.config;
      if (!chainConfig) return;

      try {
        if (chainConfig.type === 'solana') {
          await this.connectSolanaWallet();
        } else {
          await this.connectEVMWallet();
        }
      } catch (error) {
        console.error('Wallet connection failed:', error);
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
          this.showError('Your wallet has a pending request. Open MetaMask and approve or reject it, then try again.');
          return;
        }
        if (err.code === 4001) {
          // User rejected — don't show error
          return;
        }
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
          border: 2px solid #000; font-size: 11px; font-weight: 700; cursor: pointer; text-transform: uppercase;
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
            payBtn.style.background = '#ef4444';
            payBtn.style.color = '#fff';
            return;
          }
          payBtn.disabled = false;
          payBtn.textContent = `Pay $${amt.toFixed(2)} ${this.selectedToken} (${balance.toFixed(2)} available)`;
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
      payBtn.textContent = `Pay $${amt.toFixed(2)} ${this.selectedToken}`;
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

      payBtn.disabled = true;
      payBtn.innerHTML = '<span class="sp-spinner" style="display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; margin-right: 8px;"></span>Processing...';

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
                amount,
                chain: this.selectedChain.chain,
                token: this.selectedToken,
                customerEmail: this.options.customerEmail,
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
        console.error('Payment failed:', error);
        const msg = error.message || '';
        if (msg.includes('user rejected') || msg.includes('User denied') || error.code === 'ACTION_REJECTED') {
          this.showError('Transaction cancelled');
        } else if (msg.includes('transfer amount exceeds balance') || msg.includes('exceeds balance')) {
          this.showError(`Insufficient ${this.selectedToken} balance on ${this.selectedChain?.config?.chainName || 'this chain'}`);
        } else if (msg.includes('switch') || msg.includes('chain')) {
          this.showError('Please switch to ' + (this.selectedChain?.config?.chainName || 'the correct network') + ' in your wallet');
        } else {
          this.showError('Payment failed. Please try again.');
        }
        this.updatePayButton();
      }
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
        // Register txHash with our API for immediate confirmation
        if (this.currentOrderId) {
          fetch(`${STABLEPAY_URL}/api/orders/${this.currentOrderId}/transaction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txHash: tx.hash, fromAddress: await signer.getAddress() })
          }).catch(() => {}); // Scanner will also pick it up as backup
        }
        this.showSuccess(tx.hash);
        if (this.options.onSuccess) this.options.onSuccess({ orderId: this.currentOrderId, txHash: tx.hash, amount, token: this.selectedToken });
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

      // Build transfer instruction (SPL token transfer, 6 decimals)
      const amountLamports = Math.round(amount * 1e6);
      const transferIx = new solana.TransactionInstruction({
        keys: [
          { pubkey: fromATA, isSigner: false, isWritable: true },
          { pubkey: toATA, isSigner: false, isWritable: true },
          { pubkey: fromPubkey, isSigner: true, isWritable: false },
        ],
        programId: TOKEN_PROGRAM_ID,
        data: Buffer.from([3, ...new Uint8Array(new BigUint64Array([BigInt(amountLamports)]).buffer)]),
      });

      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new solana.Transaction().add(transferIx);
      tx.recentBlockhash = blockhash;
      tx.feePayer = fromPubkey;

      try {
        const signed = await this.provider.signTransaction(tx);
        const sig = await connection.sendRawTransaction(signed.serialize());

        this.showProcessing(sig);

        await connection.confirmTransaction(sig, 'confirmed');
        this.showSuccess(sig);
        if (this.options.onSuccess) this.options.onSuccess({ orderId: this.currentOrderId, txHash: sig, amount, token: this.selectedToken });
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

    showProcessing(txHash) {
      const shortHash = `${txHash.slice(0, 10)}...${txHash.slice(-8)}`;
      const explorer = this.selectedChain.config.blockExplorerUrls?.[0];

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
            Confirming Payment...
          </div>
          <div style="font-size: 13px; color: var(--sp-muted); font-family: monospace;">
            ${explorer ? `<a href="${explorer}/tx/${txHash}" target="_blank" style="color: var(--sp-accent);">${shortHash}</a>` : shortHash}
          </div>
        </div>
      `;
    }

    showSuccess(txHashOrData) {
      // Handle both string txHash and object {txHash, explorerLink, ...} from polling
      const hash = typeof txHashOrData === 'string' ? txHashOrData : (txHashOrData?.txHash || null);
      const explorerLink = typeof txHashOrData === 'object' ? txHashOrData?.explorerLink : null;

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

      this.container.querySelector('.sp-widget').innerHTML = `
        <div style="text-align: center; padding: 32px;">
          <div style="font-size: 48px; margin-bottom: 16px;">&#10003;</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--sp-text); margin-bottom: 8px; text-transform: uppercase;">
            Payment Confirmed
          </div>
          <div style="font-size: 14px; color: var(--sp-muted); margin-bottom: 16px;">
            $${parseFloat(this.options.amount).toFixed(2)} paid with ${this.selectedToken}
          </div>
          ${txUrl ? `
            <a href="${txUrl}" target="_blank" style="
              display: inline-block;
              padding: 12px 24px;
              background: #00E5FF;
              color: #000;
              border: 3px solid #000;
              text-decoration: none;
              font-size: 12px;
              font-weight: 700;
              text-transform: uppercase;
              box-shadow: 4px 4px 0px #000;
            ">View Transaction</a>
          ` : ''}
        </div>
      `;
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
      // Create a modal overlay for the checkout
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px;';
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'max-width:420px;width:100%;max-height:90vh;overflow-y:auto;position:relative;';
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;z-index:10;background:none;border:none;color:#999;font-size:24px;cursor:pointer;';
      closeBtn.onclick = () => { overlay.remove(); if (options.onCancel) options.onCancel(); };
      overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); if (options.onCancel) options.onCancel(); } };
      wrapper.appendChild(closeBtn);
      overlay.appendChild(wrapper);
      document.body.appendChild(overlay);

      const checkout = new StablePayCheckout(wrapper, {
        ...options,
        onSuccess: (data) => { overlay.remove(); if (options.onSuccess) options.onSuccess(data); },
        onCancel: () => { overlay.remove(); if (options.onCancel) options.onCancel(); },
      });
      return checkout;
    },
  };
})();
