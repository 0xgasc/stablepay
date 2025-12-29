/**
 * StablePay JavaScript SDK v1.1
 * Easy USDC payment integration for merchants
 *
 * Usage:
 *   <script src="https://stablepay-nine.vercel.app/sdk/stablepay.js"></script>
 *   <script>
 *     const stablepay = new StablePay({
 *       merchantId: 'your-merchant-id',
 *       apiKey: 'your-api-key', // Optional for authenticated requests
 *       environment: 'testnet' // or 'mainnet'
 *     });
 *
 *     // SDK will automatically fetch your configured wallets
 *     await stablepay.init();
 *   </script>
 */

(function(window) {
  'use strict';

  const API_BASE = 'https://stablepay-nine.vercel.app';

  // Chain configurations (fallback defaults)
  const CHAIN_CONFIGS = {
    BASE_SEPOLIA: {
      name: 'Base Sepolia',
      chainId: 84532,
      rpcUrl: 'https://sepolia.base.org',
      usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      explorerUrl: 'https://sepolia.basescan.org',
      network: 'testnet'
    },
    ETHEREUM_SEPOLIA: {
      name: 'Ethereum Sepolia',
      chainId: 11155111,
      rpcUrl: 'https://rpc.sepolia.org',
      usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      explorerUrl: 'https://sepolia.etherscan.io',
      network: 'testnet'
    },
    BASE: {
      name: 'Base',
      chainId: 8453,
      rpcUrl: 'https://mainnet.base.org',
      usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      explorerUrl: 'https://basescan.org',
      network: 'mainnet'
    },
    ETHEREUM: {
      name: 'Ethereum',
      chainId: 1,
      rpcUrl: 'https://eth.llamarpc.com',
      usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      explorerUrl: 'https://etherscan.io',
      network: 'mainnet'
    },
    POLYGON: {
      name: 'Polygon',
      chainId: 137,
      rpcUrl: 'https://polygon-rpc.com',
      usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      explorerUrl: 'https://polygonscan.com',
      network: 'mainnet'
    },
    ARBITRUM: {
      name: 'Arbitrum',
      chainId: 42161,
      rpcUrl: 'https://arb1.arbitrum.io/rpc',
      usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      explorerUrl: 'https://arbiscan.io',
      network: 'mainnet'
    },
    OPTIMISM: {
      name: 'Optimism',
      chainId: 10,
      rpcUrl: 'https://mainnet.optimism.io',
      usdcAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      explorerUrl: 'https://optimistic.etherscan.io',
      network: 'mainnet'
    }
  };

  class StablePay {
    constructor(config = {}) {
      this.merchantId = config.merchantId;
      this.apiKey = config.apiKey;
      this.environment = config.environment || 'testnet';
      this.onPaymentSuccess = config.onPaymentSuccess || null;
      this.onPaymentError = config.onPaymentError || null;
      this.onPaymentPending = config.onPaymentPending || null;

      // Merchant data (loaded on init)
      this.merchantProfile = null;
      this.merchantWallets = [];
      this.enabledChains = [];
      this._initialized = false;

      // Validate config
      if (!this.merchantId) {
        console.warn('StablePay: merchantId is required for production use');
      }
    }

    /**
     * Initialize the SDK and fetch merchant configuration
     * Call this before using other methods for best results
     * @returns {Promise<Object>} Merchant profile
     */
    async init() {
      if (this._initialized) return this.merchantProfile;

      try {
        const response = await fetch(`${API_BASE}/api/merchant-profile?id=${this.merchantId}`);
        if (response.ok) {
          const data = await response.json();
          this.merchantProfile = data;
          this.merchantWallets = data.wallets || [];

          // Build list of enabled chains from wallets
          this.enabledChains = this.merchantWallets
            .filter(w => w.isActive)
            .map(w => ({
              chain: w.chain,
              address: w.address,
              ...CHAIN_CONFIGS[w.chain]
            }));

          this._initialized = true;
          console.log('StablePay: Initialized with', this.enabledChains.length, 'chains');
        }
      } catch (error) {
        console.warn('StablePay: Could not fetch merchant profile, using defaults');
      }

      return this.merchantProfile;
    }

    /**
     * Get merchant's enabled chains with their wallet addresses
     * @returns {Array} List of enabled chains with addresses
     */
    getEnabledChains() {
      if (this.enabledChains.length > 0) {
        return this.enabledChains;
      }

      // Fallback to environment-based chains
      const networkFilter = this.environment === 'mainnet' ? 'mainnet' : 'testnet';
      return Object.entries(CHAIN_CONFIGS)
        .filter(([_, config]) => config.network === networkFilter)
        .map(([chain, config]) => ({ chain, ...config }));
    }

    /**
     * Get wallet address for a specific chain
     * @param {string} chain - Chain identifier
     * @returns {string|null} Wallet address or null
     */
    getWalletForChain(chain) {
      const wallet = this.merchantWallets.find(w => w.chain === chain && w.isActive);
      return wallet ? wallet.address : null;
    }

    /**
     * Create a new payment order
     * @param {Object} options - Payment options
     * @param {number} options.amount - Amount in USDC
     * @param {string} options.chain - Chain to use (BASE_SEPOLIA, ETHEREUM_SEPOLIA, etc.)
     * @param {string} options.customerEmail - Customer email (optional)
     * @param {string} options.productName - Product/order description
     * @param {string} options.orderId - Your internal order ID (optional)
     * @param {Object} options.metadata - Additional metadata (optional)
     * @returns {Promise<Object>} Order details
     */
    async createPayment(options) {
      // Auto-init if not done
      if (!this._initialized && this.merchantId) {
        await this.init();
      }

      let { amount, chain, customerEmail, productName, orderId, metadata } = options;

      if (!amount || amount <= 0) {
        throw new Error('Invalid amount');
      }

      // Auto-select chain if not provided
      if (!chain) {
        const enabledChains = this.getEnabledChains();
        if (enabledChains.length > 0) {
          chain = enabledChains[0].chain;
          console.log('StablePay: Auto-selected chain:', chain);
        } else {
          throw new Error('No chains available. Please configure wallets in your dashboard.');
        }
      }

      // Get payment address from merchant's wallets or use provided
      let paymentAddress = options.paymentAddress || this.getWalletForChain(chain);

      if (!paymentAddress) {
        console.warn('StablePay: No wallet configured for chain', chain, '- order will use default');
      }

      const response = await fetch(`${API_BASE}/api/v1/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
        },
        body: JSON.stringify({
          merchantId: this.merchantId,
          amount: amount.toString(),
          chain,
          customerEmail,
          productName,
          paymentAddress,
          externalOrderId: orderId,
          metadata
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create payment');
      }

      const data = await response.json();
      return {
        orderId: data.order.id,
        amount: data.order.amount,
        chain: data.order.chain,
        paymentAddress: data.order.paymentAddress,
        status: data.order.status,
        expiresAt: data.order.expiresAt,
        checkoutUrl: `${API_BASE}/public/crypto-pay.html?orderId=${data.order.id}`
      };
    }

    /**
     * Get order status
     * @param {string} orderId - The order ID
     * @returns {Promise<Object>} Order details
     */
    async getOrder(orderId) {
      const response = await fetch(`${API_BASE}/api/v1/orders?orderId=${orderId}`, {
        headers: {
          ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get order');
      }

      return response.json();
    }

    /**
     * Get all orders for this merchant
     * @param {Object} options - Query options
     * @param {number} options.limit - Max orders to return
     * @param {string} options.status - Filter by status
     * @returns {Promise<Array>} List of orders
     */
    async getOrders(options = {}) {
      const params = new URLSearchParams({
        merchantId: this.merchantId,
        ...(options.limit && { limit: options.limit }),
        ...(options.status && { status: options.status })
      });

      const response = await fetch(`${API_BASE}/api/v1/orders?${params}`, {
        headers: {
          ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get orders');
      }

      return response.json();
    }

    /**
     * Request a refund
     * @param {Object} options - Refund options
     * @param {string} options.orderId - The order ID to refund
     * @param {number} options.amount - Amount to refund (optional, defaults to full amount)
     * @param {string} options.reason - Reason for refund
     * @param {string} options.refundAddress - Address to send refund to
     * @returns {Promise<Object>} Refund details
     */
    async requestRefund(options) {
      const { orderId, amount, reason, refundAddress } = options;

      if (!orderId) {
        throw new Error('orderId is required');
      }

      const response = await fetch(`${API_BASE}/api/refunds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
        },
        body: JSON.stringify({
          orderId,
          amount: amount?.toString(),
          reason,
          refundAddress,
          status: 'PENDING'
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create refund');
      }

      return response.json();
    }

    /**
     * Open checkout in a popup window
     * @param {Object} options - Payment options (same as createPayment)
     * @returns {Promise<Object>} Payment result
     */
    async openCheckout(options) {
      const order = await this.createPayment(options);

      return new Promise((resolve, reject) => {
        const width = 450;
        const height = 700;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;

        const popup = window.open(
          order.checkoutUrl,
          'StablePay Checkout',
          `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
        );

        if (!popup) {
          reject(new Error('Popup blocked. Please allow popups for this site.'));
          return;
        }

        // Poll for order status
        const pollInterval = setInterval(async () => {
          try {
            const status = await this.getOrder(order.orderId);

            if (status.status === 'CONFIRMED' || status.status === 'PAID') {
              clearInterval(pollInterval);
              popup.close();
              if (this.onPaymentSuccess) this.onPaymentSuccess(status);
              resolve(status);
            } else if (status.status === 'EXPIRED' || status.status === 'FAILED') {
              clearInterval(pollInterval);
              popup.close();
              if (this.onPaymentError) this.onPaymentError(status);
              reject(new Error(`Payment ${status.status.toLowerCase()}`));
            }
          } catch (e) {
            // Ignore polling errors
          }
        }, 3000);

        // Check if popup was closed manually
        const checkClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkClosed);
            clearInterval(pollInterval);
          }
        }, 1000);
      });
    }

    /**
     * Embed checkout in an iframe
     * @param {string} containerId - ID of the container element
     * @param {Object} options - Payment options (same as createPayment)
     * @returns {Promise<Object>} Order details
     */
    async embedCheckout(containerId, options) {
      const container = document.getElementById(containerId);
      if (!container) {
        throw new Error(`Container element "${containerId}" not found`);
      }

      const order = await this.createPayment(options);

      const iframe = document.createElement('iframe');
      iframe.src = order.checkoutUrl;
      iframe.style.width = '100%';
      iframe.style.height = '600px';
      iframe.style.border = 'none';
      iframe.style.borderRadius = '12px';
      iframe.allow = 'clipboard-write';

      container.innerHTML = '';
      container.appendChild(iframe);

      // Set up message listener for cross-origin communication
      window.addEventListener('message', (event) => {
        if (event.origin !== API_BASE) return;

        if (event.data.type === 'STABLEPAY_PAYMENT_SUCCESS') {
          if (this.onPaymentSuccess) this.onPaymentSuccess(event.data.order);
        } else if (event.data.type === 'STABLEPAY_PAYMENT_ERROR') {
          if (this.onPaymentError) this.onPaymentError(event.data.error);
        }
      });

      return order;
    }

    /**
     * Create a payment button
     * @param {string} containerId - ID of the container element
     * @param {Object} options - Button and payment options
     * @returns {HTMLButtonElement} The created button
     */
    createPaymentButton(containerId, options) {
      const container = document.getElementById(containerId);
      if (!container) {
        throw new Error(`Container element "${containerId}" not found`);
      }

      const button = document.createElement('button');
      button.innerHTML = options.buttonText || `Pay $${options.amount} USDC`;
      button.className = options.className || 'stablepay-button';

      // Default styles
      if (!options.className) {
        button.style.cssText = `
          background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
          color: white;
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: transform 0.2s, box-shadow 0.2s;
        `;
        button.onmouseover = () => {
          button.style.transform = 'translateY(-2px)';
          button.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.4)';
        };
        button.onmouseout = () => {
          button.style.transform = 'translateY(0)';
          button.style.boxShadow = 'none';
        };
      }

      // Add USDC icon
      const icon = document.createElement('span');
      icon.innerHTML = '💵';
      button.prepend(icon);

      button.onclick = async () => {
        button.disabled = true;
        button.innerHTML = 'Processing...';

        try {
          await this.openCheckout(options);
        } catch (error) {
          console.error('Payment failed:', error);
          if (this.onPaymentError) this.onPaymentError(error);
        } finally {
          button.disabled = false;
          button.innerHTML = options.buttonText || `Pay $${options.amount} USDC`;
          button.prepend(icon);
        }
      };

      container.appendChild(button);
      return button;
    }

    /**
     * Create a chain selector dropdown
     * @param {string} containerId - ID of the container element
     * @param {Function} onChange - Callback when chain is selected
     * @returns {HTMLSelectElement} The created select element
     */
    async createChainSelector(containerId, onChange) {
      const container = document.getElementById(containerId);
      if (!container) {
        throw new Error(`Container element "${containerId}" not found`);
      }

      // Auto-init if not done
      if (!this._initialized && this.merchantId) {
        await this.init();
      }

      const select = document.createElement('select');
      select.className = 'stablepay-chain-selector';
      select.style.cssText = `
        padding: 10px 16px;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        font-size: 14px;
        cursor: pointer;
        background: white;
      `;

      const chains = this.getEnabledChains();

      if (chains.length === 0) {
        const option = document.createElement('option');
        option.textContent = 'No chains configured';
        option.disabled = true;
        select.appendChild(option);
      } else {
        chains.forEach(chain => {
          const option = document.createElement('option');
          option.value = chain.chain;
          option.textContent = chain.name || chain.chain;
          select.appendChild(option);
        });
      }

      if (onChange) {
        select.onchange = () => onChange(select.value, chains.find(c => c.chain === select.value));
      }

      container.appendChild(select);
      return select;
    }

    /**
     * Get available chains for current environment
     * @returns {Object} Available chain configurations
     */
    getAvailableChains() {
      const networkFilter = this.environment === 'mainnet' ? 'mainnet' : 'testnet';
      const filtered = {};
      Object.entries(CHAIN_CONFIGS).forEach(([key, config]) => {
        if (config.network === networkFilter) {
          filtered[key] = config;
        }
      });
      return filtered;
    }

    /**
     * Get chain configuration
     * @param {string} chainId - Chain identifier
     * @returns {Object} Chain configuration
     */
    getChainConfig(chainId) {
      return CHAIN_CONFIGS[chainId];
    }
  }

  // Expose to window
  window.StablePay = StablePay;

})(window);
