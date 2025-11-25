# Integration Examples

Copy-paste examples for popular frameworks and platforms.

---

## Table of Contents

- [Vanilla JavaScript](#vanilla-javascript)
- [React](#react)
- [Next.js](#nextjs)
- [Vue 3](#vue-3)
- [Svelte](#svelte)
- [WordPress](#wordpress)
- [Shopify](#shopify)
- [WooCommerce](#woocommerce)
- [Node.js Backend](#nodejs-backend)
- [Express.js](#expressjs)

---

## Vanilla JavaScript

### Simple Payment Button

```html
<!DOCTYPE html>
<html>
<head>
    <title>Pay with StablePay</title>
    <script src="https://stablepay-nine.vercel.app/checkout-widget.js"></script>
</head>
<body>
    <h1>Checkout</h1>
    <p>Total: $10.00</p>

    <!-- StablePay Widget -->
    <div class="stablepay-checkout"
         data-merchant="YOUR_MERCHANT_ID"
         data-amount="10.00"
         data-chain="BASE_MAINNET">
    </div>

    <script>
        // Listen for payment events
        document.querySelector('.stablepay-checkout')
            .addEventListener('stablepay:payment.success', (event) => {
                console.log('Payment successful!', event.detail);
                alert(`Payment confirmed! TX: ${event.detail.txHash}`);
            });

        document.querySelector('.stablepay-checkout')
            .addEventListener('stablepay:payment.failed', (event) => {
                console.error('Payment failed:', event.detail);
                alert('Payment failed. Please try again.');
            });
    </script>
</body>
</html>
```

### Dynamic Amount

```html
<script src="https://stablepay-nine.vercel.app/checkout-widget.js"></script>

<div id="checkout-container"></div>

<script>
    function createCheckout(amount, productName) {
        const container = document.getElementById('checkout-container');

        container.innerHTML = `
            <h2>${productName}</h2>
            <p>Amount: $${amount}</p>
            <div class="stablepay-checkout"
                 data-merchant="YOUR_MERCHANT_ID"
                 data-amount="${amount}"
                 data-chain="BASE_MAINNET"
                 data-customer-name="${productName}">
            </div>
        `;

        // Re-initialize widget
        if (window.StablePayCheckout) {
            const widget = container.querySelector('.stablepay-checkout');
            new window.StablePayCheckout(widget, {});
        }
    }

    // Example: Show checkout for $49.99 product
    createCheckout('49.99', 'Premium Subscription');
</script>
```

---

## React

### Function Component with Hook

```jsx
import { useEffect, useState } from 'react';

export default function CheckoutPage({ amount = '10.00', productName }) {
  const [paymentStatus, setPaymentStatus] = useState('idle');

  useEffect(() => {
    // Load StablePay script
    const script = document.createElement('script');
    script.src = 'https://stablepay-nine.vercel.app/checkout-widget.js';
    script.async = true;
    document.head.appendChild(script);

    // Handle payment success
    const handleSuccess = (event) => {
      console.log('Payment successful:', event.detail);
      setPaymentStatus('success');

      // Update your backend
      fetch('/api/complete-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: event.detail.orderId,
          txHash: event.detail.txHash,
          amount: event.detail.amount
        })
      });
    };

    // Handle payment failure
    const handleFailure = (event) => {
      console.error('Payment failed:', event.detail);
      setPaymentStatus('failed');
    };

    document.addEventListener('stablepay:payment.success', handleSuccess);
    document.addEventListener('stablepay:payment.failed', handleFailure);

    return () => {
      document.removeEventListener('stablepay:payment.success', handleSuccess);
      document.removeEventListener('stablepay:payment.failed', handleFailure);
      document.head.removeChild(script);
    };
  }, []);

  return (
    <div className="checkout-page">
      <h1>Checkout</h1>
      <p>Product: {productName}</p>
      <p>Amount: ${amount}</p>

      {paymentStatus === 'success' && (
        <div className="success-message">
          ✅ Payment confirmed! Thank you for your purchase.
        </div>
      )}

      {paymentStatus === 'failed' && (
        <div className="error-message">
          ❌ Payment failed. Please try again.
        </div>
      )}

      <div className="stablepay-checkout"
           data-merchant={process.env.REACT_APP_STABLEPAY_MERCHANT_ID}
           data-amount={amount}
           data-chain="BASE_MAINNET"
           data-customer-name={productName}>
      </div>
    </div>
  );
}
```

### Custom Hook

```jsx
// hooks/useStablePay.js
import { useEffect, useState } from 'react';

export function useStablePay() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [paymentData, setPaymentData] = useState(null);

  useEffect(() => {
    // Load script
    const script = document.createElement('script');
    script.src = 'https://stablepay-nine.vercel.app/checkout-widget.js';
    script.async = true;
    script.onload = () => setIsLoaded(true);
    document.head.appendChild(script);

    // Event listeners
    const handleSuccess = (event) => {
      setPaymentStatus('success');
      setPaymentData(event.detail);
    };

    const handleFailure = (event) => {
      setPaymentStatus('failed');
      setPaymentData(event.detail);
    };

    document.addEventListener('stablepay:payment.success', handleSuccess);
    document.addEventListener('stablepay:payment.failed', handleFailure);

    return () => {
      document.removeEventListener('stablepay:payment.success', handleSuccess);
      document.removeEventListener('stablepay:payment.failed', handleFailure);
    };
  }, []);

  return { isLoaded, paymentStatus, paymentData };
}

// Usage:
export default function Checkout() {
  const { isLoaded, paymentStatus, paymentData } = useStablePay();

  useEffect(() => {
    if (paymentStatus === 'success') {
      console.log('Payment confirmed:', paymentData);
      // Handle success
    }
  }, [paymentStatus, paymentData]);

  return (
    <div className="stablepay-checkout"
         data-merchant="YOUR_MERCHANT_ID"
         data-amount="10.00"
         data-chain="BASE_MAINNET">
    </div>
  );
}
```

---

## Next.js

### App Router (Next.js 13+)

```jsx
// app/checkout/page.tsx
'use client';

import Script from 'next/script';
import { useState } from 'react';

export default function CheckoutPage({
  searchParams
}: {
  searchParams: { amount?: string; product?: string }
}) {
  const [paymentComplete, setPaymentComplete] = useState(false);
  const amount = searchParams.amount || '10.00';
  const product = searchParams.product || 'Product';

  const handlePaymentSuccess = (event: CustomEvent) => {
    console.log('Payment successful:', event.detail);
    setPaymentComplete(true);

    // Save to database
    fetch('/api/payments/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: event.detail.orderId,
        txHash: event.detail.txHash
      })
    });
  };

  return (
    <>
      <Script
        src="https://stablepay-nine.vercel.app/checkout-widget.js"
        strategy="lazyOnload"
        onLoad={() => {
          document.addEventListener('stablepay:payment.success', handlePaymentSuccess as EventListener);
        }}
      />

      <div className="container mx-auto p-8">
        <h1 className="text-3xl font-bold mb-4">Checkout</h1>

        {paymentComplete ? (
          <div className="bg-green-100 p-6 rounded-lg">
            <h2 className="text-xl font-semibold text-green-800">
              ✅ Payment Confirmed!
            </h2>
            <p className="text-green-700 mt-2">
              Thank you for your purchase.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <p className="text-lg">Product: {product}</p>
              <p className="text-2xl font-bold">${amount}</p>
            </div>

            <div className="stablepay-checkout"
                 data-merchant={process.env.NEXT_PUBLIC_STABLEPAY_MERCHANT_ID}
                 data-amount={amount}
                 data-chain="BASE_MAINNET"
                 data-customer-name={product}>
            </div>
          </>
        )}
      </div>
    </>
  );
}
```

### API Route for Backend Confirmation

```typescript
// app/api/payments/confirm/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma'; // Your database

export async function POST(request: NextRequest) {
  const { orderId, txHash } = await request.json();

  try {
    // Save payment to your database
    const payment = await prisma.payment.create({
      data: {
        stablePayOrderId: orderId,
        transactionHash: txHash,
        status: 'confirmed',
        confirmedAt: new Date()
      }
    });

    // Trigger fulfillment (send product, activate subscription, etc.)
    await fulfillOrder(payment.id);

    return NextResponse.json({ success: true, payment });
  } catch (error) {
    console.error('Payment confirmation error:', error);
    return NextResponse.json({ error: 'Failed to confirm payment' }, { status: 500 });
  }
}
```

---

## Vue 3

### Composition API

```vue
<!-- CheckoutPage.vue -->
<template>
  <div class="checkout">
    <h1>Checkout</h1>
    <p>Amount: ${{ amount }}</p>

    <div v-if="paymentStatus === 'success'" class="success">
      ✅ Payment confirmed!
    </div>

    <div v-else-if="paymentStatus === 'failed'" class="error">
      ❌ Payment failed. Please try again.
    </div>

    <div class="stablepay-checkout"
         :data-merchant="merchantId"
         :data-amount="amount"
         data-chain="BASE_MAINNET">
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  amount: {
    type: String,
    default: '10.00'
  }
});

const merchantId = import.meta.env.VITE_STABLEPAY_MERCHANT_ID;
const paymentStatus = ref(null);
const paymentData = ref(null);

const handlePaymentSuccess = (event) => {
  paymentStatus.value = 'success';
  paymentData.value = event.detail;

  // Update backend
  fetch('/api/complete-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event.detail)
  });
};

const handlePaymentFailed = (event) => {
  paymentStatus.value = 'failed';
  paymentData.value = event.detail;
};

onMounted(() => {
  // Load StablePay script
  const script = document.createElement('script');
  script.src = 'https://stablepay-nine.vercel.app/checkout-widget.js';
  script.async = true;
  document.head.appendChild(script);

  // Add event listeners
  document.addEventListener('stablepay:payment.success', handlePaymentSuccess);
  document.addEventListener('stablepay:payment.failed', handlePaymentFailed);
});

onUnmounted(() => {
  document.removeEventListener('stablepay:payment.success', handlePaymentSuccess);
  document.removeEventListener('stablepay:payment.failed', handlePaymentFailed);
});
</script>

<style scoped>
.success {
  background: #d4edda;
  color: #155724;
  padding: 1rem;
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}

.error {
  background: #f8d7da;
  color: #721c24;
  padding: 1rem;
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}
</style>
```

---

## Svelte

```svelte
<!-- Checkout.svelte -->
<script>
  import { onMount } from 'svelte';

  export let amount = '10.00';
  export let productName = 'Product';

  let paymentStatus = 'idle';
  let paymentData = null;

  onMount(() => {
    // Load StablePay script
    const script = document.createElement('script');
    script.src = 'https://stablepay-nine.vercel.app/checkout-widget.js';
    script.async = true;
    document.head.appendChild(script);

    // Event handlers
    const handleSuccess = (event) => {
      paymentStatus = 'success';
      paymentData = event.detail;

      // Call your backend
      fetch('/api/confirm-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event.detail)
      });
    };

    const handleFailure = (event) => {
      paymentStatus = 'failed';
      paymentData = event.detail;
    };

    document.addEventListener('stablepay:payment.success', handleSuccess);
    document.addEventListener('stablepay:payment.failed', handleFailure);

    return () => {
      document.removeEventListener('stablepay:payment.success', handleSuccess);
      document.removeEventListener('stablepay:payment.failed', handleFailure);
    };
  });
</script>

<div class="checkout">
  <h1>Checkout</h1>
  <p>Product: {productName}</p>
  <p>Amount: ${amount}</p>

  {#if paymentStatus === 'success'}
    <div class="success-message">
      ✅ Payment confirmed! Thank you.
    </div>
  {:else if paymentStatus === 'failed'}
    <div class="error-message">
      ❌ Payment failed. Please try again.
    </div>
  {/if}

  <div class="stablepay-checkout"
       data-merchant={import.meta.env.VITE_STABLEPAY_MERCHANT_ID}
       data-amount={amount}
       data-chain="BASE_MAINNET"
       data-customer-name={productName}>
  </div>
</div>

<style>
  .success-message {
    background: #d4edda;
    color: #155724;
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  .error-message {
    background: #f8d7da;
    color: #721c24;
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }
</style>
```

---

## WordPress

### Plugin Integration

```php
<?php
/**
 * Plugin Name: StablePay for WordPress
 * Description: Accept USDC payments with StablePay
 * Version: 1.0.0
 */

// Add settings page
add_action('admin_menu', 'stablepay_settings_page');

function stablepay_settings_page() {
    add_options_page(
        'StablePay Settings',
        'StablePay',
        'manage_options',
        'stablepay',
        'stablepay_settings_page_html'
    );
}

function stablepay_settings_page_html() {
    ?>
    <div class="wrap">
        <h1>StablePay Settings</h1>
        <form method="post" action="options.php">
            <?php
            settings_fields('stablepay');
            do_settings_sections('stablepay');
            ?>
            <table class="form-table">
                <tr>
                    <th>Merchant ID</th>
                    <td>
                        <input type="text" name="stablepay_merchant_id"
                               value="<?php echo esc_attr(get_option('stablepay_merchant_id')); ?>"
                               class="regular-text" />
                    </td>
                </tr>
                <tr>
                    <th>Network</th>
                    <td>
                        <select name="stablepay_network">
                            <option value="BASE_MAINNET" <?php selected(get_option('stablepay_network'), 'BASE_MAINNET'); ?>>
                                Base Mainnet
                            </option>
                            <option value="SOLANA_MAINNET" <?php selected(get_option('stablepay_network'), 'SOLANA_MAINNET'); ?>>
                                Solana Mainnet
                            </option>
                        </select>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

// Register settings
add_action('admin_init', 'stablepay_register_settings');

function stablepay_register_settings() {
    register_setting('stablepay', 'stablepay_merchant_id');
    register_setting('stablepay', 'stablepay_network');
}

// Add shortcode
add_shortcode('stablepay_checkout', 'stablepay_checkout_shortcode');

function stablepay_checkout_shortcode($atts) {
    $atts = shortcode_atts(array(
        'amount' => '10.00',
        'product' => 'Product'
    ), $atts);

    $merchant_id = get_option('stablepay_merchant_id');
    $network = get_option('stablepay_network', 'BASE_MAINNET');

    wp_enqueue_script(
        'stablepay-widget',
        'https://stablepay-nine.vercel.app/checkout-widget.js',
        array(),
        null,
        true
    );

    return sprintf(
        '<div class="stablepay-checkout"
              data-merchant="%s"
              data-amount="%s"
              data-chain="%s"
              data-customer-name="%s"></div>',
        esc_attr($merchant_id),
        esc_attr($atts['amount']),
        esc_attr($network),
        esc_attr($atts['product'])
    );
}

// Usage in posts/pages:
// [stablepay_checkout amount="49.99" product="Premium Membership"]
?>
```

---

## WooCommerce

```php
<?php
/**
 * StablePay Payment Gateway for WooCommerce
 */

add_filter('woocommerce_payment_gateways', 'stablepay_add_gateway_class');

function stablepay_add_gateway_class($gateways) {
    $gateways[] = 'WC_StablePay_Gateway';
    return $gateways;
}

add_action('plugins_loaded', 'stablepay_init_gateway_class');

function stablepay_init_gateway_class() {
    class WC_StablePay_Gateway extends WC_Payment_Gateway {
        public function __construct() {
            $this->id = 'stablepay';
            $this->method_title = 'StablePay (USDC)';
            $this->method_description = 'Accept USDC payments via StablePay';
            $this->has_fields = true;

            $this->init_form_fields();
            $this->init_settings();

            $this->title = $this->get_option('title');
            $this->description = $this->get_option('description');
            $this->merchant_id = $this->get_option('merchant_id');
            $this->network = $this->get_option('network');

            add_action('woocommerce_update_options_payment_gateways_' . $this->id, array($this, 'process_admin_options'));
            add_action('woocommerce_thankyou_' . $this->id, array($this, 'thankyou_page'));
        }

        public function init_form_fields() {
            $this->form_fields = array(
                'enabled' => array(
                    'title' => 'Enable/Disable',
                    'type' => 'checkbox',
                    'label' => 'Enable StablePay',
                    'default' => 'no'
                ),
                'title' => array(
                    'title' => 'Title',
                    'type' => 'text',
                    'default' => 'Crypto Payment (USDC)',
                ),
                'description' => array(
                    'title' => 'Description',
                    'type' => 'textarea',
                    'default' => 'Pay with USDC using your crypto wallet',
                ),
                'merchant_id' => array(
                    'title' => 'Merchant ID',
                    'type' => 'text',
                    'description' => 'Your StablePay merchant ID',
                ),
                'network' => array(
                    'title' => 'Network',
                    'type' => 'select',
                    'options' => array(
                        'BASE_MAINNET' => 'Base',
                        'SOLANA_MAINNET' => 'Solana'
                    ),
                    'default' => 'BASE_MAINNET'
                )
            );
        }

        public function payment_fields() {
            echo wpautop($this->description);
            echo '<div id="stablepay-checkout-container"></div>';
        }

        public function process_payment($order_id) {
            $order = wc_get_order($order_id);

            // Mark as pending
            $order->update_status('pending', 'Awaiting crypto payment');

            // Store order info for checkout page
            WC()->session->set('stablepay_order_id', $order_id);

            return array(
                'result' => 'success',
                'redirect' => $this->get_return_url($order)
            );
        }

        public function thankyou_page($order_id) {
            $order = wc_get_order($order_id);
            $amount = $order->get_total();
            ?>
            <script src="https://stablepay-nine.vercel.app/checkout-widget.js"></script>
            <div class="stablepay-checkout"
                 data-merchant="<?php echo esc_attr($this->merchant_id); ?>"
                 data-amount="<?php echo esc_attr($amount); ?>"
                 data-chain="<?php echo esc_attr($this->network); ?>"
                 data-customer-email="<?php echo esc_attr($order->get_billing_email()); ?>">
            </div>
            <script>
            document.querySelector('.stablepay-checkout')
                .addEventListener('stablepay:payment.success', function(event) {
                    // Update order status via AJAX
                    jQuery.post('<?php echo admin_url('admin-ajax.php'); ?>', {
                        action: 'stablepay_confirm_payment',
                        order_id: <?php echo $order_id; ?>,
                        tx_hash: event.detail.txHash,
                        order_id_stablepay: event.detail.orderId
                    }, function(response) {
                        location.reload();
                    });
                });
            </script>
            <?php
        }
    }
}

// AJAX handler for payment confirmation
add_action('wp_ajax_stablepay_confirm_payment', 'stablepay_confirm_payment');
add_action('wp_ajax_nopriv_stablepay_confirm_payment', 'stablepay_confirm_payment');

function stablepay_confirm_payment() {
    $order_id = intval($_POST['order_id']);
    $tx_hash = sanitize_text_field($_POST['tx_hash']);
    $stablepay_order_id = sanitize_text_field($_POST['order_id_stablepay']);

    $order = wc_get_order($order_id);
    $order->payment_complete();
    $order->add_order_note("StablePay payment confirmed. TX: $tx_hash");
    $order->update_meta_data('stablepay_tx_hash', $tx_hash);
    $order->update_meta_data('stablepay_order_id', $stablepay_order_id);
    $order->save();

    wp_send_json_success();
}
?>
```

---

## Node.js Backend

### Express.js Server

```javascript
// server.js
const express = require('express');
const app = express();

app.use(express.json());

// Create order endpoint
app.post('/api/create-order', async (req, res) => {
  const { amount, product, customerEmail } = req.body;

  try {
    // Create StablePay order
    const response = await fetch('https://stablepay-nine.vercel.app/api/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantId: process.env.STABLEPAY_MERCHANT_ID,
        amount: amount,
        chain: 'BASE_MAINNET',
        customerEmail: customerEmail,
        customerName: product,
        paymentAddress: process.env.STABLEPAY_WALLET_ADDRESS
      })
    });

    const { order } = await response.json();

    // Save to your database
    await db.orders.create({
      id: order.id,
      stablePayOrderId: order.id,
      amount: amount,
      product: product,
      customerEmail: customerEmail,
      status: 'pending'
    });

    res.json({ orderId: order.id });
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Webhook endpoint (future)
app.post('/api/webhooks/stablepay', async (req, res) => {
  const { event, data } = req.body;

  if (event === 'order.confirmed') {
    // Update your database
    await db.orders.update(
      { stablePayOrderId: data.orderId },
      {
        status: 'confirmed',
        txHash: data.txHash,
        confirmedAt: new Date()
      }
    );

    // Trigger fulfillment
    await fulfillOrder(data.orderId);
  }

  res.json({ received: true });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

---

## Shopify

### Custom App Integration

```javascript
// Add to your Shopify theme's checkout page customization

<script src="https://stablepay-nine.vercel.app/checkout-widget.js"></script>

<div class="stablepay-checkout"
     data-merchant="{{ shop.metafields.stablepay.merchant_id }}"
     data-amount="{{ checkout.total_price | money_without_currency }}"
     data-chain="BASE_MAINNET"
     data-customer-email="{{ checkout.email }}">
</div>

<script>
document.querySelector('.stablepay-checkout')
    .addEventListener('stablepay:payment.success', function(event) {
        // Call Shopify API to mark order as paid
        fetch('/admin/api/2024-01/orders/{{ checkout.order_id }}/transactions.json', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': '{{ shop.metafields.stablepay.api_token }}'
            },
            body: JSON.stringify({
                transaction: {
                    kind: 'capture',
                    status: 'success',
                    amount: '{{ checkout.total_price }}',
                    gateway: 'StablePay',
                    source_name: 'web',
                    receipt: {
                        txHash: event.detail.txHash,
                        orderId: event.detail.orderId
                    }
                }
            })
        });
    });
</script>
```

---

**Need help with a specific framework?** Contact support@stablepay.com
