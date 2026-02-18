/**
 * StablePay Embeddable Checkout Widget
 *
 * Usage:
 * <script src="https://stablepay-nine.vercel.app/js/stablepay-widget.js"></script>
 *
 * StablePay.checkout({
 *   merchantId: 'your-merchant-id',
 *   amount: 49.99,
 *   productName: 'Premium Plan',
 *   customerEmail: 'customer@email.com',
 *   chain: 'BASE_MAINNET', // optional, shows selector if not set
 *   onSuccess: (data) => console.log('Payment successful!', data),
 *   onCancel: () => console.log('Payment cancelled'),
 *   onError: (error) => console.error('Payment error:', error)
 * });
 */

(function(window) {
  'use strict';

  const STABLEPAY_API = 'https://stablepay-nine.vercel.app';

  // Styles for the modal
  const MODAL_STYLES = `
    .stablepay-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .stablepay-modal {
      background: #fff;
      border: 4px solid #000;
      box-shadow: 12px 12px 0px #000;
      max-width: 420px;
      width: 95%;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
    }
    .stablepay-header {
      background: #000;
      color: #fff;
      padding: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .stablepay-logo {
      font-weight: 800;
      font-size: 18px;
      letter-spacing: -0.5px;
    }
    .stablepay-close {
      background: none;
      border: none;
      color: #fff;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      line-height: 1;
    }
    .stablepay-content {
      padding: 24px;
    }
    .stablepay-amount {
      text-align: center;
      margin-bottom: 24px;
    }
    .stablepay-amount-value {
      font-size: 48px;
      font-weight: 800;
      color: #000;
    }
    .stablepay-amount-token {
      font-size: 18px;
      color: #666;
      margin-left: 8px;
    }
    .stablepay-product {
      text-align: center;
      color: #666;
      margin-top: 8px;
    }
    .stablepay-section {
      margin-bottom: 20px;
    }
    .stablepay-label {
      display: block;
      font-weight: 700;
      font-size: 12px;
      text-transform: uppercase;
      color: #666;
      margin-bottom: 8px;
    }
    .stablepay-select {
      width: 100%;
      padding: 14px;
      border: 3px solid #000;
      font-size: 16px;
      font-weight: 600;
      background: #fff;
      cursor: pointer;
    }
    .stablepay-select:focus {
      outline: none;
      box-shadow: 4px 4px 0px #000;
    }
    .stablepay-btn {
      width: 100%;
      padding: 16px;
      border: 3px solid #000;
      font-size: 16px;
      font-weight: 800;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.15s;
    }
    .stablepay-btn:hover {
      transform: translate(2px, 2px);
      box-shadow: 4px 4px 0px #000;
    }
    .stablepay-btn-primary {
      background: #000;
      color: #fff;
    }
    .stablepay-btn-success {
      background: #10B981;
      color: #fff;
    }
    .stablepay-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .stablepay-wallet {
      background: #f5f5f5;
      border: 2px solid #ddd;
      padding: 12px;
      margin-bottom: 16px;
      font-family: monospace;
      font-size: 13px;
      word-break: break-all;
    }
    .stablepay-status {
      text-align: center;
      padding: 40px 20px;
    }
    .stablepay-status-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }
    .stablepay-status-title {
      font-size: 24px;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .stablepay-status-message {
      color: #666;
      margin-bottom: 20px;
    }
    .stablepay-spinner {
      display: inline-block;
      width: 40px;
      height: 40px;
      border: 4px solid #f3f3f3;
      border-top: 4px solid #000;
      border-radius: 50%;
      animation: stablepay-spin 1s linear infinite;
      margin-bottom: 16px;
    }
    @keyframes stablepay-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .stablepay-link {
      color: #3B82F6;
      text-decoration: underline;
    }
    .stablepay-footer {
      text-align: center;
      padding: 16px;
      border-top: 2px solid #eee;
      font-size: 12px;
      color: #999;
    }
    .stablepay-error {
      background: #FEE2E2;
      border: 2px solid #EF4444;
      color: #B91C1C;
      padding: 12px;
      margin-bottom: 16px;
      font-size: 14px;
    }
  `;

  // Chain configurations
  const CHAINS = {
    'BASE_SEPOLIA': { chainId: '0x14a34', name: 'Base Sepolia (Testnet)', rpc: 'https://sepolia.base.org', explorer: 'https://sepolia.basescan.org' },
    'BASE_MAINNET': { chainId: '0x2105', name: 'Base', rpc: 'https://mainnet.base.org', explorer: 'https://basescan.org' },
    'ETHEREUM_SEPOLIA': { chainId: '0xaa36a7', name: 'Ethereum Sepolia (Testnet)', rpc: 'https://sepolia.infura.io/v3/public', explorer: 'https://sepolia.etherscan.io' },
    'ETHEREUM_MAINNET': { chainId: '0x1', name: 'Ethereum', rpc: 'https://eth.llamarpc.com', explorer: 'https://etherscan.io' },
    'POLYGON_MAINNET': { chainId: '0x89', name: 'Polygon', rpc: 'https://polygon-rpc.com', explorer: 'https://polygonscan.com' },
    'ARBITRUM_MAINNET': { chainId: '0xa4b1', name: 'Arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io' },
  };

  // USDC addresses per chain
  const USDC_ADDRESSES = {
    'BASE_SEPOLIA': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    'BASE_MAINNET': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    'ETHEREUM_SEPOLIA': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    'ETHEREUM_MAINNET': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    'POLYGON_MAINNET': '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    'ARBITRUM_MAINNET': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  };

  // ERC20 ABI for USDC
  const ERC20_ABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)'
  ];

  class StablePayWidget {
    constructor() {
      this.modal = null;
      this.options = null;
      this.order = null;
      this.provider = null;
      this.signer = null;
      this.walletAddress = null;
      this.availableChains = [];
      this.injectStyles();
    }

    injectStyles() {
      if (document.getElementById('stablepay-styles')) return;
      const style = document.createElement('style');
      style.id = 'stablepay-styles';
      style.textContent = MODAL_STYLES;
      document.head.appendChild(style);
    }

    async checkout(options) {
      this.options = {
        merchantId: options.merchantId,
        amount: options.amount,
        productName: options.productName || 'Payment',
        customerEmail: options.customerEmail || '',
        customerName: options.customerName || '',
        chain: options.chain || null,
        token: options.token || 'USDC',
        metadata: options.metadata || {},
        onSuccess: options.onSuccess || (() => {}),
        onCancel: options.onCancel || (() => {}),
        onError: options.onError || ((e) => console.error(e)),
        theme: options.theme || 'light'
      };

      try {
        // Fetch available chains for this merchant
        await this.fetchMerchantChains();
        this.showModal();
      } catch (error) {
        this.options.onError(error);
      }
    }

    async fetchMerchantChains() {
      const response = await fetch(`${STABLEPAY_API}/api/embed/chains?merchantId=${this.options.merchantId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch merchant configuration');
      }
      const data = await response.json();
      this.availableChains = data.chains || Object.keys(CHAINS);
    }

    showModal() {
      // Create overlay
      this.modal = document.createElement('div');
      this.modal.className = 'stablepay-overlay';
      this.modal.innerHTML = this.renderCheckout();
      document.body.appendChild(this.modal);
      document.body.style.overflow = 'hidden';

      // Add event listeners
      this.modal.querySelector('.stablepay-close').onclick = () => this.close();
      this.modal.querySelector('#stablepay-connect-btn')?.addEventListener('click', () => this.connectWallet());
    }

    renderCheckout() {
      const chainOptions = this.availableChains
        .filter(c => CHAINS[c])
        .map(c => `<option value="${c}">${CHAINS[c].name}</option>`)
        .join('');

      return `
        <div class="stablepay-modal">
          <div class="stablepay-header">
            <div class="stablepay-logo">STABLEPAY</div>
            <button class="stablepay-close">&times;</button>
          </div>
          <div class="stablepay-content" id="stablepay-main">
            <div class="stablepay-amount">
              <span class="stablepay-amount-value">$${this.options.amount.toFixed(2)}</span>
              <span class="stablepay-amount-token">${this.options.token}</span>
              <div class="stablepay-product">${this.options.productName}</div>
            </div>

            <div id="stablepay-error" class="stablepay-error" style="display:none;"></div>

            <div class="stablepay-section">
              <label class="stablepay-label">Select Network</label>
              <select class="stablepay-select" id="stablepay-chain">
                ${chainOptions}
              </select>
            </div>

            <div id="stablepay-wallet-section" style="display:none;">
              <div class="stablepay-section">
                <label class="stablepay-label">Connected Wallet</label>
                <div class="stablepay-wallet" id="stablepay-wallet-address"></div>
              </div>
              <button class="stablepay-btn stablepay-btn-success" id="stablepay-pay-btn">
                Pay $${this.options.amount.toFixed(2)} ${this.options.token}
              </button>
            </div>

            <div id="stablepay-connect-section">
              <button class="stablepay-btn stablepay-btn-primary" id="stablepay-connect-btn">
                Connect Wallet
              </button>
            </div>
          </div>
          <div class="stablepay-footer">
            Secured by StablePay &bull; Stablecoin Payments
          </div>
        </div>
      `;
    }

    async connectWallet() {
      if (!window.ethereum) {
        this.showError('Please install MetaMask or another Web3 wallet');
        return;
      }

      try {
        this.showLoading('Connecting wallet...');

        // Request accounts
        const provider = new window.ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();

        this.provider = provider;
        this.signer = signer;
        this.walletAddress = address;

        // Show wallet section
        this.hideLoading();
        document.getElementById('stablepay-connect-section').style.display = 'none';
        document.getElementById('stablepay-wallet-section').style.display = 'block';
        document.getElementById('stablepay-wallet-address').textContent =
          address.slice(0, 8) + '...' + address.slice(-6);

        // Add pay button listener
        document.getElementById('stablepay-pay-btn').onclick = () => this.pay();

      } catch (error) {
        this.hideLoading();
        this.showError('Failed to connect wallet: ' + error.message);
      }
    }

    async pay() {
      // Prevent double-pay: disable button immediately
      const payBtn = document.getElementById('stablepay-pay-btn');
      if (payBtn) {
        if (payBtn.disabled) return; // Already processing
        payBtn.disabled = true;
        payBtn.textContent = 'PROCESSING...';
      }

      const selectedChain = document.getElementById('stablepay-chain').value;
      const chainConfig = CHAINS[selectedChain];

      if (!chainConfig) {
        this.showError('Invalid network selected');
        if (payBtn) { payBtn.disabled = false; payBtn.textContent = `Pay $${this.options.amount.toFixed(2)} ${this.options.token}`; }
        return;
      }

      try {
        this.showLoading('Preparing payment...');

        // Switch to correct network
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainConfig.chainId }],
          });
        } catch (switchError) {
          if (switchError.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: chainConfig.chainId,
                chainName: chainConfig.name,
                rpcUrls: [chainConfig.rpc],
                blockExplorerUrls: [chainConfig.explorer],
              }],
            });
          } else {
            throw switchError;
          }
        }

        // Refresh provider after network switch
        this.provider = new window.ethers.BrowserProvider(window.ethereum);
        this.signer = await this.provider.getSigner();

        // Create order via API
        this.showLoading('Creating order...');
        const orderResponse = await fetch(`${STABLEPAY_API}/api/embed/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchantId: this.options.merchantId,
            amount: this.options.amount,
            chain: selectedChain,
            token: this.options.token,
            customerEmail: this.options.customerEmail,
            customerName: this.options.customerName,
            productName: this.options.productName,
            metadata: this.options.metadata
          })
        });

        if (!orderResponse.ok) {
          const error = await orderResponse.json();
          throw new Error(error.error || 'Failed to create order');
        }

        const orderData = await orderResponse.json();
        this.order = orderData.order;

        // Get USDC contract
        this.showLoading('Sending payment...');
        const usdcAddress = USDC_ADDRESSES[selectedChain];
        if (!usdcAddress) {
          throw new Error('USDC not supported on this network');
        }

        const usdc = new window.ethers.Contract(usdcAddress, ERC20_ABI, this.signer);
        const decimals = await usdc.decimals();
        const amount = window.ethers.parseUnits(this.order.amount.toString(), decimals);

        // Check balance
        const balance = await usdc.balanceOf(this.walletAddress);
        if (balance < amount) {
          const balanceFormatted = window.ethers.formatUnits(balance, decimals);
          throw new Error(`Insufficient USDC balance. You have ${balanceFormatted} USDC`);
        }

        // Send payment
        this.showLoading('Confirm in wallet...');
        const tx = await usdc.transfer(this.order.paymentAddress, amount);

        this.showLoading('Confirming transaction...');
        const receipt = await tx.wait();

        // Confirm order with backend
        await fetch(`${STABLEPAY_API}/api/orders-confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: this.order.id,
            txHash: tx.hash,
            blockNumber: receipt.blockNumber
          })
        });

        // Show success
        this.showSuccess(tx.hash, chainConfig.explorer);

      } catch (error) {
        this.hideLoading();
        if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
          this.showError('Transaction cancelled by user');
        } else {
          this.showError(error.message || 'Payment failed');
        }
      }
    }

    showLoading(message) {
      document.getElementById('stablepay-main').innerHTML = `
        <div class="stablepay-status">
          <div class="stablepay-spinner"></div>
          <div class="stablepay-status-title">${message}</div>
          <div class="stablepay-status-message">Please wait...</div>
        </div>
      `;
    }

    hideLoading() {
      document.getElementById('stablepay-main').innerHTML = this.renderCheckout().match(/<div class="stablepay-content"[^>]*>([\s\S]*?)<\/div>\s*<div class="stablepay-footer">/)[1];
    }

    showSuccess(txHash, explorerUrl) {
      document.getElementById('stablepay-main').innerHTML = `
        <div class="stablepay-status">
          <div class="stablepay-status-icon">✅</div>
          <div class="stablepay-status-title">Payment Successful!</div>
          <div class="stablepay-status-message">
            Your payment of $${this.options.amount.toFixed(2)} ${this.options.token} has been confirmed.
          </div>
          <a href="${explorerUrl}/tx/${txHash}" target="_blank" class="stablepay-link">
            View Transaction
          </a>
          <br><br>
          <button class="stablepay-btn stablepay-btn-primary" onclick="window.StablePay._instance.closeSuccess()">
            Done
          </button>
        </div>
      `;
    }

    showError(message) {
      const errorEl = document.getElementById('stablepay-error');
      if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
      }
    }

    closeSuccess() {
      this.options.onSuccess({
        orderId: this.order?.id,
        txHash: this.order?.txHash,
        amount: this.options.amount,
        token: this.options.token
      });
      this.close();
    }

    close() {
      if (this.modal) {
        this.modal.remove();
        this.modal = null;
        document.body.style.overflow = '';
      }
      if (!this.order) {
        this.options.onCancel();
      }
    }
  }

  // Create global instance
  const widget = new StablePayWidget();

  // Expose public API
  window.StablePay = {
    _instance: widget,
    checkout: (options) => widget.checkout(options),
    version: '1.0.0'
  };

  // Load ethers.js if not already loaded
  if (!window.ethers) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/ethers@6.9.0/dist/ethers.umd.min.js';
    script.async = true;
    document.head.appendChild(script);
  }

})(window);
