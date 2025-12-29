/**
 * StablePay JavaScript SDK
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
 *   </script>
 */

(function(window) {
  'use strict';

  const API_BASE = 'https://stablepay-nine.vercel.app';

  // Chain configurations
  const CHAINS = {
    testnet: {
      BASE_SEPOLIA: {
        name: 'Base Sepolia',
        chainId: 84532,
        rpcUrl: 'https://sepolia.base.org',
        usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        explorerUrl: 'https://sepolia.basescan.org'
      },
      ETHEREUM_SEPOLIA: {
        name: 'Ethereum Sepolia',
        chainId: 11155111,
        rpcUrl: 'https://rpc.sepolia.org',
        usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        explorerUrl: 'https://sepolia.etherscan.io'
      }
    },
    mainnet: {
      BASE: {
        name: 'Base',
        chainId: 8453,
        rpcUrl: 'https://mainnet.base.org',
        usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        explorerUrl: 'https://basescan.org'
      },
      ETHEREUM: {
        name: 'Ethereum',
        chainId: 1,
        rpcUrl: 'https://eth.llamarpc.com',
        usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        explorerUrl: 'https://etherscan.io'
      }
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

      // Validate config
      if (!this.merchantId) {
        console.warn('StablePay: merchantId is required for production use');
      }
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
      const { amount, chain, customerEmail, productName, orderId, metadata } = options;

      if (!amount || amount <= 0) {
        throw new Error('Invalid amount');
      }

      if (!chain) {
        throw new Error('Chain is required');
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
     * Get available chains for current environment
     * @returns {Object} Available chains
     */
    getAvailableChains() {
      return CHAINS[this.environment] || CHAINS.testnet;
    }

    /**
     * Get chain configuration
     * @param {string} chainId - Chain identifier
     * @returns {Object} Chain configuration
     */
    getChainConfig(chainId) {
      const chains = this.getAvailableChains();
      return chains[chainId];
    }
  }

  // Expose to window
  window.StablePay = StablePay;

})(window);
