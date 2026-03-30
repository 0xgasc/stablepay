/**
 * StablePay Embedded Checkout Widget v3.0
 * Full inline checkout - no redirects needed
 */

(function() {
  'use strict';

  const STABLEPAY_URL = 'https://wetakestables.shop';
  const WIDGET_VERSION = '3.0.0';

  // Chain configurations (subset for widget)
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
    SOLANA_MAINNET: {
      type: 'solana', chainName: 'Solana', network: 'mainnet',
      tokens: {
        USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
        USDT: { address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 }
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
        accentColor: options.accentColor || container.dataset.accent || '#3b82f6',
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
      style.textContent = `
        .sp-widget { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .sp-widget * { box-sizing: border-box; }
        .sp-widget.dark { --sp-bg: #1a1a1a; --sp-card: #252525; --sp-border: #333; --sp-text: #fff; --sp-muted: #888; }
        .sp-widget.light { --sp-bg: #fff; --sp-card: #f9fafb; --sp-border: #e5e7eb; --sp-text: #111; --sp-muted: #6b7280; }
        .sp-chain-btn { transition: all 0.2s; cursor: pointer; }
        .sp-chain-btn:hover { transform: translateY(-1px); }
        .sp-chain-btn.selected { border-color: var(--sp-accent) !important; background: color-mix(in srgb, var(--sp-accent) 10%, transparent); }
        .sp-token-btn { transition: all 0.15s; }
        .sp-token-btn.selected { background: var(--sp-accent) !important; color: white !important; }
        .sp-pay-btn { transition: all 0.2s; }
        .sp-pay-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .sp-pay-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .sp-spinner { animation: sp-spin 1s linear infinite; }
        @keyframes sp-spin { to { transform: rotate(360deg); } }
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
        <div class="sp-widget ${this.options.theme}" style="
          --sp-accent: ${accent};
          background: var(--sp-bg);
          border: 1px solid var(--sp-border);
          border-radius: 12px;
          padding: 24px;
          max-width: 420px;
        ">
          <!-- Header -->
          <div style="margin-bottom: 20px; text-align: center;">
            <div style="font-size: 14px; color: var(--sp-muted); margin-bottom: 4px;">
              ${this.options.productName}
            </div>
            <div style="font-size: 32px; font-weight: 700; color: var(--sp-text);">
              $${parseFloat(this.options.amount).toFixed(2)}
            </div>
          </div>

          <!-- Chain Selection -->
          <div style="margin-bottom: 16px;">
            <div style="font-size: 12px; font-weight: 600; color: var(--sp-muted); margin-bottom: 8px; text-transform: uppercase;">
              Select Network
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px;">
              ${this.merchantChains.map((mc, i) => `
                <button class="sp-chain-btn ${i === 0 ? 'selected' : ''}" data-chain="${mc.chain}" style="
                  padding: 12px;
                  border: 2px solid var(--sp-border);
                  border-radius: 8px;
                  background: var(--sp-card);
                  color: var(--sp-text);
                  font-size: 13px;
                  font-weight: 500;
                ">
                  ${mc.config.chainName}
                  <div style="font-size: 10px; color: var(--sp-muted); margin-top: 2px;">
                    ${mc.config.network}
                  </div>
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Token Selection -->
          <div style="margin-bottom: 20px;">
            <div style="font-size: 12px; font-weight: 600; color: var(--sp-muted); margin-bottom: 8px; text-transform: uppercase;">
              Pay With
            </div>
            <div id="sp-token-container" style="display: flex; gap: 8px; flex-wrap: wrap;">
              ${this.renderTokenButtons()}
            </div>
          </div>

          <!-- Payment Method Tabs -->
          <div style="margin-bottom: 12px;">
            <div id="sp-method-tabs" style="display: flex; gap: 4px; margin-bottom: 12px;">
              <button class="sp-method-tab" data-method="wallet" style="
                flex: 1; padding: 8px; font-size: 11px; font-weight: 600; border: 1px solid var(--sp-border);
                background: ${accent}; color: white; border-radius: 6px; cursor: pointer; text-transform: uppercase;
              ">Connect Wallet</button>
              <button class="sp-method-tab" data-method="qr" style="
                flex: 1; padding: 8px; font-size: 11px; font-weight: 600; border: 1px solid var(--sp-border);
                background: var(--sp-card); color: var(--sp-muted); border-radius: 6px; cursor: pointer; text-transform: uppercase;
              ">QR Code</button>
              <button class="sp-method-tab" data-method="address" style="
                flex: 1; padding: 8px; font-size: 11px; font-weight: 600; border: 1px solid var(--sp-border);
                background: var(--sp-card); color: var(--sp-muted); border-radius: 6px; cursor: pointer; text-transform: uppercase;
              ">Copy Address</button>
            </div>

            <!-- Method: Connect Wallet -->
            <div id="sp-method-wallet" class="sp-method-panel">
              <div id="sp-wallet-status" style="
                background: var(--sp-card); border: 1px solid var(--sp-border);
                border-radius: 8px; padding: 12px; margin-bottom: 12px;
                display: flex; align-items: center; justify-content: space-between;
              ">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></div>
                  <span style="font-size: 13px; color: var(--sp-muted);">Wallet not connected</span>
                </div>
                <button id="sp-connect-btn" style="
                  padding: 6px 12px; background: ${accent}; color: white;
                  border: none; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer;
                ">Connect</button>
              </div>
              <button id="sp-pay-btn" class="sp-pay-btn" disabled style="
                width: 100%; padding: 14px; background: ${accent}; color: white;
                border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer;
              ">Connect Wallet to Pay</button>
            </div>

            <!-- Method: QR Code -->
            <div id="sp-method-qr" class="sp-method-panel" style="display: none;">
              <!-- Wallet ID step (if not already connected) -->
              <div id="sp-manual-wallet-input" style="padding: 12px; border-bottom: 1px solid var(--sp-border);">
                <div style="font-size: 11px; color: var(--sp-muted); font-weight: 600; margin-bottom: 6px; text-transform: uppercase;">Your wallet address</div>
                <div style="display: flex; gap: 6px;">
                  <input id="sp-sender-wallet" type="text" placeholder="0x... (so we can match your payment)" style="
                    flex: 1; padding: 8px; font-size: 11px; font-family: monospace; border: 1px solid var(--sp-border);
                    border-radius: 4px; background: var(--sp-card); color: var(--sp-text); outline: none;
                  ">
                  <button id="sp-sender-wallet-btn" style="
                    padding: 6px 12px; background: ${accent}; color: white; border: none;
                    border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer;
                  ">OK</button>
                </div>
                <p style="font-size: 10px; color: var(--sp-muted); margin-top: 4px;">The address you'll send FROM. Helps us match your payment faster.</p>
              </div>
              <div style="text-align: center; padding: 16px 0;">
                <div id="sp-qr-container" style="
                  background: white; border-radius: 8px; padding: 16px;
                  display: inline-block; margin-bottom: 12px;
                ">
                  <canvas id="sp-qr-canvas" width="180" height="180"></canvas>
                </div>
                <p style="font-size: 12px; color: var(--sp-muted); margin-bottom: 8px;">Scan with your wallet app to pay</p>
                <div id="sp-qr-status" style="font-size: 12px; color: ${accent}; display: none;">
                  Waiting for payment...
                </div>
              </div>
            </div>

            <!-- Method: Copy Address -->
            <div id="sp-method-address" class="sp-method-panel" style="display: none;">
              <div style="background: var(--sp-card); border: 1px solid var(--sp-border); border-radius: 8px; padding: 14px; margin-bottom: 12px;">
                <div style="font-size: 11px; color: var(--sp-muted); text-transform: uppercase; font-weight: 600; margin-bottom: 6px;">Send to this address</div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <code id="sp-pay-address" style="font-size: 11px; color: var(--sp-text); word-break: break-all; flex: 1;"></code>
                  <button id="sp-copy-addr-btn" style="
                    padding: 4px 10px; background: ${accent}; color: white;
                    border: none; border-radius: 4px; font-size: 11px; cursor: pointer; white-space: nowrap;
                  ">Copy</button>
                </div>
              </div>
              <div style="background: var(--sp-card); border: 1px solid var(--sp-border); border-radius: 8px; padding: 14px; margin-bottom: 12px;">
                <div style="font-size: 11px; color: var(--sp-muted); text-transform: uppercase; font-weight: 600; margin-bottom: 6px;">Exact Amount</div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span id="sp-pay-amount" style="font-size: 18px; font-weight: 700; color: var(--sp-text);"></span>
                  <button id="sp-copy-amt-btn" style="
                    padding: 4px 10px; background: ${accent}; color: white;
                    border: none; border-radius: 4px; font-size: 11px; cursor: pointer;
                  ">Copy</button>
                </div>
              </div>
              <p style="font-size: 11px; color: var(--sp-muted); text-align: center;">Send the exact amount on the selected chain. Payment confirms automatically.</p>
              <div id="sp-addr-status" style="font-size: 12px; color: ${accent}; text-align: center; margin-top: 8px; display: none;">
                Waiting for payment...
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div style="margin-top: 16px; text-align: center; font-size: 11px; color: var(--sp-muted);">
            Powered by <a href="${STABLEPAY_URL}" target="_blank" style="color: ${accent}; text-decoration: none;">StablePay</a>
          </div>
        </div>
      `;
    }

    renderTokenButtons() {
      if (!this.selectedChain) return '';

      const tokens = this.selectedChain.supportedTokens;
      const chainTokens = this.selectedChain.config.tokens;

      return tokens
        .filter(t => chainTokens[t])
        .map((token, i) => `
          <button class="sp-token-btn ${i === 0 ? 'selected' : ''}" data-token="${token}" style="
            padding: 8px 16px;
            border: 1px solid var(--sp-border);
            border-radius: 6px;
            background: var(--sp-card);
            color: var(--sp-text);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
          ">${token}</button>
        `).join('');
    }

    attachEventListeners() {
      // Chain selection
      this.container.querySelectorAll('.sp-chain-btn').forEach(btn => {
        btn.addEventListener('click', () => this.selectChain(btn.dataset.chain));
      });

      // Token selection
      this.container.addEventListener('click', (e) => {
        if (e.target.classList.contains('sp-token-btn')) {
          this.selectToken(e.target.dataset.token);
        }
      });

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

      // Copy buttons
      const copyAddrBtn = this.container.querySelector('#sp-copy-addr-btn');
      if (copyAddrBtn) {
        copyAddrBtn.addEventListener('click', () => {
          const addr = this.container.querySelector('#sp-pay-address')?.textContent;
          if (addr) { navigator.clipboard.writeText(addr); copyAddrBtn.textContent = 'Copied!'; setTimeout(() => copyAddrBtn.textContent = 'Copy', 1500); }
        });
      }
      const copyAmtBtn = this.container.querySelector('#sp-copy-amt-btn');
      if (copyAmtBtn) {
        copyAmtBtn.addEventListener('click', () => {
          const amt = this.container.querySelector('#sp-pay-amount')?.textContent;
          if (amt) { navigator.clipboard.writeText(amt); copyAmtBtn.textContent = 'Copied!'; setTimeout(() => copyAmtBtn.textContent = 'Copy', 1500); }
        });
      }

      // Init sender wallet input for QR/Copy tabs
      this.initSenderWalletInput();
    }

    // Called after wallet connects via Connect Wallet tab — hide the manual input
    onWalletConnected() {
      const inputDiv = this.container.querySelector('#sp-manual-wallet-input');
      if (inputDiv) inputDiv.style.display = 'none';
    }

    initSenderWalletInput() {
      const input = this.container.querySelector('#sp-sender-wallet');
      const btn = this.container.querySelector('#sp-sender-wallet-btn');
      const inputDiv = this.container.querySelector('#sp-manual-wallet-input');

      // Hide wallet input if already connected via Connect Wallet tab
      if (this.connectedWallet) {
        if (inputDiv) inputDiv.style.display = 'none';
      }

      if (btn) {
        btn.addEventListener('click', () => {
          const addr = input?.value?.trim();
          if (addr && addr.length > 10) {
            this.connectedWallet = addr;
            if (inputDiv) inputDiv.style.display = 'none';
            this.showManualPaymentDetails(this.container.querySelector('#sp-method-qr')?.style.display !== 'none' ? 'qr' : 'address');
          }
        });
      }
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') btn?.click();
        });
      }
    }

    switchPaymentMethod(method) {
      const accent = this.options.accentColor || '#3b82f6';
      // Update tabs
      this.container.querySelectorAll('.sp-method-tab').forEach(tab => {
        if (tab.dataset.method === method) {
          tab.style.background = accent;
          tab.style.color = 'white';
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

      // For QR and address methods, create order + show details
      if (method === 'qr' || method === 'address') {
        this.showManualPaymentDetails(method);
      }
    }

    async showManualPaymentDetails(method) {
      if (!this.selectedChain) {
        this.showError('Please select a chain first');
        return;
      }

      const payAddress = this.container.querySelector('#sp-pay-address');
      const payAmount = this.container.querySelector('#sp-pay-amount');

      // Get merchant wallet for this chain
      const chain = this.selectedChain;
      const walletAddr = chain.walletAddress || this.merchantConfig?.wallets?.find(w => w.chain === chain.chain)?.address;

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

      // Show address + amount
      if (payAddress) payAddress.textContent = walletAddr;
      if (payAmount) payAmount.textContent = `${amount} ${this.selectedToken}`;

      // Generate QR code
      if (method === 'qr') {
        const canvas = this.container.querySelector('#sp-qr-canvas');
        if (canvas && typeof QRCode !== 'undefined') {
          QRCode.toCanvas(canvas, walletAddr, { width: 180, margin: 2 }, (err) => {
            if (err) console.error('QR generation failed:', err);
          });
        } else if (canvas) {
          // Fallback: show address as text if QR library not loaded
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, 180, 180);
          ctx.fillStyle = '#333';
          ctx.font = '10px monospace';
          ctx.fillText('QR loading...', 30, 90);
        }
      }

      // Start polling for payment confirmation
      const statusEl = this.container.querySelector(method === 'qr' ? '#sp-qr-status' : '#sp-addr-status');
      if (statusEl) statusEl.style.display = 'block';
      this.startPaymentPolling();
    }

    startPaymentPolling() {
      if (this._pollingInterval) return; // Don't double-poll
      this._pollingInterval = setInterval(async () => {
        if (!this.currentOrderId) return;
        try {
          const res = await fetch(`${STABLEPAY_URL}/api/embed/order/${this.currentOrderId}`);
          const data = await res.json();
          if (data.status === 'CONFIRMED' || data.status === 'PAID') {
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
      this.selectedChain = this.merchantChains.find(mc => mc.chain === chainKey);
      this.selectedToken = this.selectedChain?.supportedTokens[0] || 'USDC';

      // Update UI
      this.container.querySelectorAll('.sp-chain-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.chain === chainKey);
      });

      // Re-render tokens
      const tokenContainer = this.container.querySelector('#sp-token-container');
      if (tokenContainer) {
        tokenContainer.innerHTML = this.renderTokenButtons();
      }

      // If wallet connected to different chain type, may need to reconnect
      this.updatePayButton();
    }

    selectToken(token) {
      this.selectedToken = token;

      this.container.querySelectorAll('.sp-token-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.token === token);
      });

      this.updatePayButton();
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
        this.showError('Failed to connect wallet: ' + error.message);
      }
    }

    detectEVMProviders() {
      const providers = [];
      // Check for multiple injected providers (EIP-6963 style)
      if (window.ethereum?.providers?.length) {
        window.ethereum.providers.forEach(p => {
          if (p.isMetaMask) providers.push({ name: 'MetaMask', provider: p, icon: '🦊' });
          else if (p.isRabby) providers.push({ name: 'Rabby', provider: p, icon: '🐰' });
          else if (p.isCoinbaseWallet) providers.push({ name: 'Coinbase', provider: p, icon: '🔵' });
          else if (p.isRainbow) providers.push({ name: 'Rainbow', provider: p, icon: '🌈' });
          else providers.push({ name: 'Wallet', provider: p, icon: '👛' });
        });
      } else if (window.ethereum) {
        // Single provider
        const p = window.ethereum;
        if (p.isMetaMask) providers.push({ name: 'MetaMask', provider: p, icon: '🦊' });
        else if (p.isCoinbaseWallet) providers.push({ name: 'Coinbase', provider: p, icon: '🔵' });
        else if (p.isRainbow) providers.push({ name: 'Rainbow', provider: p, icon: '🌈' });
        else providers.push({ name: 'Wallet', provider: p, icon: '👛' });
      }
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
        // Show wallet picker
        selectedProvider = await this.showWalletPicker(providers);
        if (!selectedProvider) return; // User cancelled
      }

      const accounts = await selectedProvider.request({ method: 'eth_requestAccounts' });
      if (accounts.length === 0) throw new Error('No accounts found');

      this.connectedWallet = accounts[0];
      this.provider = selectedProvider;

      // Switch to correct chain
      const chainConfig = this.selectedChain.config;
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainConfig.chainId }]
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
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

      if (this.connectedWallet) {
        statusDiv.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #22c55e;"></div>
            <span style="font-size: 13px; color: var(--sp-text); font-family: monospace;">${shortAddr}</span>
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
          this.updateWalletStatus();
        });
      } else {
        statusDiv.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></div>
            <span style="font-size: 13px; color: var(--sp-muted);">Wallet not connected</span>
          </div>
          <button id="sp-connect-btn" style="
            padding: 6px 12px;
            background: var(--sp-accent);
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
          ">Connect</button>
        `;

        statusDiv.querySelector('#sp-connect-btn')?.addEventListener('click', () => this.connectWallet());
      }

      this.updatePayButton();
    }

    updatePayButton() {
      const payBtn = this.container.querySelector('#sp-pay-btn');
      if (!payBtn) return;

      if (this.connectedWallet) {
        payBtn.disabled = false;
        payBtn.textContent = `Pay $${parseFloat(this.options.amount).toFixed(2)} with ${this.selectedToken}`;
      } else {
        payBtn.disabled = true;
        payBtn.textContent = 'Connect Wallet to Pay';
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
        const amount = parseFloat(this.options.amount);

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
        this.showError('Payment failed: ' + error.message);
        this.updatePayButton();
      }
    }

    async processEVMPayment(tokenConfig, recipient, amount) {
      const ethers = window.ethers;
      if (!ethers) {
        await this.loadScript('https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.umd.min.js');
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

      // Direct transfer to merchant - fees collected separately
      console.log('Direct payment to:', recipient);
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
      // Simplified Solana payment - would need @solana/web3.js for full implementation
      this.showError('Solana payments require additional setup. Please use the hosted checkout.');
    }

    loadScript(src) {
      return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve();
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

    showSuccess(txHash) {
      const explorer = this.selectedChain.config.blockExplorerUrls?.[0];

      this.container.querySelector('.sp-widget').innerHTML = `
        <div style="text-align: center; padding: 32px;">
          <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
          <div style="font-size: 20px; font-weight: 600; color: var(--sp-text); margin-bottom: 8px;">
            Payment Successful!
          </div>
          <div style="font-size: 14px; color: var(--sp-muted); margin-bottom: 16px;">
            $${parseFloat(this.options.amount).toFixed(2)} paid with ${this.selectedToken}
          </div>
          ${explorer ? `
            <a href="${explorer}/tx/${txHash}" target="_blank" style="
              display: inline-block;
              padding: 10px 20px;
              background: var(--sp-accent);
              color: white;
              border-radius: 6px;
              text-decoration: none;
              font-size: 13px;
              font-weight: 500;
            ">View Transaction</a>
          ` : ''}
        </div>
      `;
    }

    showError(message) {
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #ef4444;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
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
    qrScript.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
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
