/**
 * StablePay Embedded Checkout Widget
 * One-line integration for accepting USDC payments
 */

(function() {
  'use strict';

  // Widget configuration
  const STABLEPAY_API = 'https://stablepay-nine.vercel.app/api/v1';
  const WIDGET_VERSION = '1.0.0';

  class StablePayCheckout {
    constructor(container, options) {
      this.container = container;
      this.options = {
        amount: options.amount || container.dataset.amount,
        currency: options.currency || container.dataset.currency || 'USDC',
        merchantId: options.merchantId || container.dataset.merchant,
        recipient: options.recipient || container.dataset.recipient,
        theme: options.theme || container.dataset.theme || 'light',
        ...options
      };

      this.sessionId = null;
      this.init();
    }

    init() {
      this.render();
      this.attachEventListeners();
    }

    render() {
      const html = `
        <div class="stablepay-widget ${this.options.theme}" style="
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 24px;
          max-width: 400px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: white;
          box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
        ">
          <div class="sp-header" style="margin-bottom: 20px;">
            <h3 style="margin: 0; font-size: 20px; color: #111827;">
              Pay with USDC
            </h3>
            <p style="margin: 4px 0 0 0; color: #6b7280; font-size: 14px;">
              Fast, secure, and stable payments
            </p>
          </div>

          <div class="sp-amount" style="
            background: #f9fafb;
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 20px;
            text-align: center;
          ">
            <div style="font-size: 32px; font-weight: bold; color: #111827;">
              ${this.options.amount} ${this.options.currency}
            </div>
          </div>

          <div class="sp-payment-methods" style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 8px; color: #374151; font-size: 14px;">
              Payment Method
            </label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <button class="sp-method-btn" data-method="card" style="
                padding: 12px;
                border: 2px solid #3b82f6;
                border-radius: 8px;
                background: white;
                cursor: pointer;
                transition: all 0.2s;
              ">
                💳 Card
              </button>
              <button class="sp-method-btn" data-method="crypto" style="
                padding: 12px;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                background: white;
                cursor: pointer;
                transition: all 0.2s;
              ">
                🪙 Crypto
              </button>
            </div>
          </div>

          <div class="sp-card-form" style="margin-bottom: 20px;">
            <input type="email" placeholder="Email address" style="
              width: 100%;
              padding: 12px;
              border: 1px solid #e5e7eb;
              border-radius: 8px;
              margin-bottom: 8px;
              font-size: 14px;
            " />
            <input type="text" placeholder="Card number" style="
              width: 100%;
              padding: 12px;
              border: 1px solid #e5e7eb;
              border-radius: 8px;
              margin-bottom: 8px;
              font-size: 14px;
            " />
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <input type="text" placeholder="MM/YY" style="
                padding: 12px;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                font-size: 14px;
              " />
              <input type="text" placeholder="CVC" style="
                padding: 12px;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                font-size: 14px;
              " />
            </div>
          </div>

          <div class="sp-crypto-form" style="display: none; margin-bottom: 20px;">
            <div style="
              background: #f3f4f6;
              padding: 16px;
              border-radius: 8px;
              text-align: center;
            ">
              <p style="margin: 0 0 12px 0; color: #374151; font-size: 14px;">
                Send ${this.options.amount} USDC to:
              </p>
              <div style="
                background: white;
                padding: 12px;
                border-radius: 6px;
                word-break: break-all;
                font-family: monospace;
                font-size: 12px;
                color: #111827;
                margin-bottom: 12px;
              ">
                ${this.options.recipient || '0x...'}
              </div>
              <canvas id="sp-qr-code"></canvas>
            </div>
          </div>

          <button class="sp-pay-btn" style="
            width: 100%;
            padding: 14px;
            background: linear-gradient(to right, #3b82f6, #8b5cf6);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
          ">
            Pay ${this.options.amount} ${this.options.currency}
          </button>

          <div class="sp-footer" style="
            margin-top: 16px;
            text-align: center;
            color: #9ca3af;
            font-size: 12px;
          ">
            Powered by <a href="https://stablepay.com" style="color: #3b82f6; text-decoration: none;">StablePay</a>
          </div>
        </div>
      `;

      this.container.innerHTML = html;
    }

    attachEventListeners() {
      // Payment method switching
      const methodBtns = this.container.querySelectorAll('.sp-method-btn');
      methodBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          this.switchPaymentMethod(e.target.dataset.method);
        });
      });

      // Pay button
      const payBtn = this.container.querySelector('.sp-pay-btn');
      payBtn.addEventListener('click', () => this.processPayment());
    }

    switchPaymentMethod(method) {
      const cardForm = this.container.querySelector('.sp-card-form');
      const cryptoForm = this.container.querySelector('.sp-crypto-form');
      const methodBtns = this.container.querySelectorAll('.sp-method-btn');

      methodBtns.forEach(btn => {
        if (btn.dataset.method === method) {
          btn.style.borderColor = '#3b82f6';
          btn.style.borderWidth = '2px';
        } else {
          btn.style.borderColor = '#e5e7eb';
          btn.style.borderWidth = '1px';
        }
      });

      if (method === 'card') {
        cardForm.style.display = 'block';
        cryptoForm.style.display = 'none';
      } else {
        cardForm.style.display = 'none';
        cryptoForm.style.display = 'block';
        this.generateQRCode();
      }
    }

    generateQRCode() {
      // TODO: Implement QR code generation
      console.log('Generating QR code for:', this.options.recipient);
    }

    async processPayment() {
      const payBtn = this.container.querySelector('.sp-pay-btn');
      payBtn.textContent = 'Processing...';
      payBtn.disabled = true;

      try {
        // Create checkout session
        const response = await fetch(`${STABLEPAY_API}/checkout/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Widget-Version': WIDGET_VERSION
          },
          body: JSON.stringify({
            amount: this.options.amount,
            currency: this.options.currency,
            merchantId: this.options.merchantId,
            recipient: this.options.recipient,
            metadata: this.options.metadata
          })
        });

        if (!response.ok) {
          throw new Error('Failed to create checkout session');
        }

        const session = await response.json();
        this.sessionId = session.id;

        // Emit success event
        this.emit('payment.success', session);

        // Show success message
        this.showSuccess();
      } catch (error) {
        console.error('Payment failed:', error);
        this.emit('payment.failed', error);
        this.showError(error.message);
      } finally {
        payBtn.textContent = `Pay ${this.options.amount} ${this.options.currency}`;
        payBtn.disabled = false;
      }
    }

    showSuccess() {
      const widget = this.container.querySelector('.stablepay-widget');
      widget.innerHTML = `
        <div style="text-align: center; padding: 40px;">
          <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
          <h3 style="margin: 0 0 8px 0; font-size: 20px; color: #111827;">Payment Successful!</h3>
          <p style="margin: 0; color: #6b7280; font-size: 14px;">
            Transaction ID: ${this.sessionId}
          </p>
        </div>
      `;
    }

    showError(message) {
      alert(`Payment failed: ${message}`);
    }

    emit(event, data) {
      const customEvent = new CustomEvent(`stablepay:${event}`, { detail: data });
      this.container.dispatchEvent(customEvent);
    }
  }

  // Auto-initialize widgets
  function initializeWidgets() {
    const containers = document.querySelectorAll('.stablepay-checkout');
    containers.forEach(container => {
      if (!container.hasAttribute('data-initialized')) {
        new StablePayCheckout(container, {});
        container.setAttribute('data-initialized', 'true');
      }
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWidgets);
  } else {
    initializeWidgets();
  }

  // Expose global API
  window.StablePayCheckout = StablePayCheckout;
})();