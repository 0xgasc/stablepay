# Skeleton Implementation Guide for Lovable

## What's Already Built (Skeletons)

### ✅ Refund Feature - Dashboard UI Complete

**Location:** `/public/dashboard.html`

**What exists:**
- "Refund" button in Orders table (line 1037-1041)
- Full refund modal UI (lines 635-698)
- JavaScript handlers (lines 2132-2228)
- Feature gate: `localStorage.getItem('refundsEnabled')`
- API call stub: `POST /api/v1/orders/${orderId}/refund`

**What's missing:**
1. Admin toggle in `/public/enterprise-admin.html`
2. Admin "Refunds" tab to view/approve requests
3. API endpoint implementation
4. Actual USDC sending logic

---

## What Needs to be Implemented

### 1. Refund System - Backend

#### API Endpoints to Create

**File:** `/api/v1/orders/[orderId]/refund.js` (NEW)

```javascript
// POST /api/v1/orders/:orderId/refund
// Create refund request

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { orderId } = req.query;
    const { amount, reason, customerWallet } = req.body;

    // Validate order exists and is confirmed
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { transactions: true }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status !== 'CONFIRMED' && order.status !== 'PAID') {
      return res.status(400).json({ error: 'Order must be confirmed to refund' });
    }

    // Create refund record
    const refund = await prisma.refund.create({
      data: {
        orderId: orderId,
        amount: parseFloat(amount),
        reason: reason,
        status: 'PENDING',
        // Store customer wallet for refund processing
        metadata: JSON.stringify({ customerWallet })
      }
    });

    return res.json({
      success: true,
      refund: {
        id: refund.id,
        status: refund.status,
        amount: refund.amount
      }
    });
  } catch (error) {
    console.error('Refund creation error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
```

**File:** `/api/v1/admin/refunds.js` (NEW)

```javascript
// GET /api/v1/admin/refunds - List all refund requests
// POST /api/v1/admin/refunds/:refundId/approve - Approve refund
// POST /api/v1/admin/refunds/:refundId/reject - Reject refund
// POST /api/v1/admin/refunds/:refundId/process - Process approved refund

module.exports = async function handler(req, res) {
  // Admin authentication check
  // TODO: Implement admin auth

  if (req.method === 'GET') {
    // List refunds with optional status filter
    const { status } = req.query;

    const refunds = await prisma.refund.findMany({
      where: status ? { status } : {},
      include: {
        order: {
          include: {
            merchant: {
              select: { companyName: true, email: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json(refunds);
  }

  // Handle approve/reject/process actions
  // TODO: Implement approval workflow
};
```

#### Database Schema (Already Exists!)

The Refund table already exists in `/prisma/schema.prisma`:
```prisma
model Refund {
  id              String       @id @default(cuid())
  orderId         String
  amount          Decimal      @db.Decimal(18, 6)
  reason          String
  status          RefundStatus @default(PENDING)
  approvedBy      String?
  refundTxHash    String?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  order           Order        @relation(fields: [orderId], references: [id])
}

enum RefundStatus {
  PENDING
  APPROVED
  REJECTED
  PROCESSED
}
```

**Action:** Just use it! No schema changes needed.

---

### 2. Refund System - Admin UI

#### Admin Toggle for Refunds

**File:** `/public/enterprise-admin.html`

**Location:** In the System Settings section (search for "System Settings")

**Add this HTML:**

```html
<!-- Advanced Features Section -->
<div class="bg-slate-950 border shadow-sm border p-6 mt-6">
  <h3 class="text-lg font-semibold text-white mb-6">Advanced Features</h3>

  <!-- Refunds Toggle -->
  <div class="border-b border-slate-800 pb-6 mb-6">
    <label class="flex items-center justify-between cursor-pointer">
      <div class="flex-1">
        <div class="font-medium text-white mb-1">Enable Refunds</div>
        <div class="text-sm text-slate-400">
          Allow merchants to request refunds for confirmed orders
        </div>
      </div>
      <div>
        <input type="checkbox" id="enableRefunds"
               class="w-12 h-6 bg-gray-700 rounded-full appearance-none cursor-pointer
                      checked:bg-blue-600 transition-colors relative
                      before:content-[''] before:absolute before:w-5 before:h-5
                      before:rounded-full before:bg-white before:top-0.5 before:left-0.5
                      before:transition-transform checked:before:translate-x-6">
      </div>
    </label>

    <!-- Refunds Config (shows when enabled) -->
    <div id="refundsConfig" class="mt-4 pl-4 border-l-2 border-blue-600 hidden">
      <div class="space-y-3 text-sm">
        <div class="text-slate-300">
          <strong>Refund Mode:</strong> Admin Approval (Manual)
        </div>
        <div class="text-slate-400">
          Merchants can request refunds. Admins must approve each refund in the Refunds tab.
        </div>
      </div>
    </div>
  </div>

  <!-- Token Swaps Toggle -->
  <div>
    <label class="flex items-center justify-between cursor-pointer">
      <div class="flex-1">
        <div class="font-medium text-white mb-1">Accept Any Token (Swap to USDC)</div>
        <div class="text-sm text-slate-400">
          Allow customers to pay with any token - automatically swapped to USDC
        </div>
      </div>
      <div>
        <input type="checkbox" id="enableSwaps"
               class="w-12 h-6 bg-gray-700 rounded-full appearance-none cursor-pointer
                      checked:bg-purple-600 transition-colors relative
                      before:content-[''] before:absolute before:w-5 before:h-5
                      before:rounded-full before:bg-white before:top-0.5 before:left-0.5
                      before:transition-transform checked:before:translate-x-6">
      </div>
    </label>

    <div class="mt-3 bg-yellow-900/20 border border-yellow-800 rounded p-3">
      <div class="text-sm text-yellow-300 font-medium">⚠️ Coming Soon</div>
      <div class="text-xs text-yellow-400 mt-1">
        Smart contract integration required. Feature under development.
      </div>
    </div>
  </div>
</div>

<script>
// Toggle handlers
document.getElementById('enableRefunds').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  localStorage.setItem('refundsEnabled', enabled);
  document.getElementById('refundsConfig').classList.toggle('hidden', !enabled);
  alert(`Refunds ${enabled ? 'enabled' : 'disabled'} for all merchants`);
});

document.getElementById('enableSwaps').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  localStorage.setItem('swapsEnabled', enabled);
  alert(`Token swaps ${enabled ? 'enabled' : 'disabled'}`);
});

// Load saved state
document.addEventListener('DOMContentLoaded', () => {
  const refundsEnabled = localStorage.getItem('refundsEnabled') === 'true';
  const swapsEnabled = localStorage.getItem('swapsEnabled') === 'true';

  document.getElementById('enableRefunds').checked = refundsEnabled;
  document.getElementById('enableSwaps').checked = swapsEnabled;

  if (refundsEnabled) {
    document.getElementById('refundsConfig').classList.remove('hidden');
  }
});
</script>
```

#### Admin Refunds Tab

**File:** `/public/enterprise-admin.html`

**Location:** Add new tab button after "Orders" tab

**Tab Button:**
```html
<button class="tab-btn px-6 py-3 font-medium border-b-2 border-transparent text-slate-400 hover:text-slate-300 hover:border-slate-800 transition-all"
        data-tab="refunds">
    Refunds
</button>
```

**Tab Content:**
```html
<!-- Refunds Tab -->
<div id="refundsTab" class="tab-content hidden">
    <div class="mb-6">
        <h2 class="text-2xl font-bold text-white mb-2">Refund Requests</h2>
        <p class="text-slate-400">Review and process merchant refund requests</p>
    </div>

    <!-- Status Filter -->
    <div class="mb-6 flex gap-4">
        <button class="refund-filter active px-4 py-2 bg-slate-800 rounded" data-status="all">
            All
        </button>
        <button class="refund-filter px-4 py-2 bg-slate-800 rounded" data-status="PENDING">
            Pending
        </button>
        <button class="refund-filter px-4 py-2 bg-slate-800 rounded" data-status="APPROVED">
            Approved
        </button>
        <button class="refund-filter px-4 py-2 bg-slate-800 rounded" data-status="PROCESSED">
            Processed
        </button>
        <button class="refund-filter px-4 py-2 bg-slate-800 rounded" data-status="REJECTED">
            Rejected
        </button>
    </div>

    <!-- Refunds Table -->
    <div class="bg-slate-950 border border-slate-800 overflow-hidden">
        <table class="min-w-full">
            <thead class="bg-slate-900">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Refund ID</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Order ID</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Merchant</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Amount</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Reason</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Status</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Requested</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase">Actions</th>
                </tr>
            </thead>
            <tbody id="refundsTableBody" class="divide-y divide-slate-800">
                <!-- Populated via JavaScript -->
            </tbody>
        </table>
    </div>
</div>

<script>
// Load refunds
async function loadRefunds(status = 'all') {
    try {
        const url = status === 'all'
            ? '/api/v1/admin/refunds'
            : `/api/v1/admin/refunds?status=${status}`;

        const response = await fetch(url);
        const refunds = await response.json();

        renderRefundsTable(refunds);
    } catch (error) {
        console.error('Error loading refunds:', error);
    }
}

function renderRefundsTable(refunds) {
    const tbody = document.getElementById('refundsTableBody');

    if (refunds.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-6 py-12 text-center text-slate-400">No refund requests found</td></tr>';
        return;
    }

    tbody.innerHTML = refunds.map(refund => {
        const shortId = refund.id.slice(0, 8) + '...';
        const orderId = refund.orderId.slice(0, 8) + '...';
        const createdAt = new Date(refund.createdAt).toLocaleString();
        const merchantName = refund.order?.merchant?.companyName || 'Unknown';

        let actions = '';
        if (refund.status === 'PENDING') {
            actions = `
                <button onclick="approveRefund('${refund.id}')"
                        class="text-green-400 hover:text-green-300 text-sm mr-3">
                    Approve
                </button>
                <button onclick="rejectRefund('${refund.id}')"
                        class="text-red-400 hover:text-red-300 text-sm">
                    Reject
                </button>
            `;
        } else if (refund.status === 'APPROVED') {
            actions = `
                <button onclick="processRefund('${refund.id}')"
                        class="text-blue-400 hover:text-blue-300 text-sm">
                    Process Refund
                </button>
            `;
        } else if (refund.status === 'PROCESSED') {
            actions = `
                <a href="..." target="_blank" class="text-blue-400 text-sm">
                    View Tx ↗
                </a>
            `;
        }

        return `
            <tr class="hover:bg-slate-900">
                <td class="px-6 py-4 text-sm text-white">${shortId}</td>
                <td class="px-6 py-4 text-sm text-slate-400">${orderId}</td>
                <td class="px-6 py-4 text-sm text-slate-400">${merchantName}</td>
                <td class="px-6 py-4 text-sm font-semibold text-white">${refund.amount} USDC</td>
                <td class="px-6 py-4 text-sm text-slate-400 max-w-xs truncate">${refund.reason}</td>
                <td class="px-6 py-4">
                    <span class="px-2 py-1 text-xs rounded-full ${getRefundStatusClass(refund.status)}">
                        ${refund.status}
                    </span>
                </td>
                <td class="px-6 py-4 text-sm text-slate-400">${createdAt}</td>
                <td class="px-6 py-4 text-sm">${actions}</td>
            </tr>
        `;
    }).join('');
}

function getRefundStatusClass(status) {
    const classes = {
        'PENDING': 'bg-yellow-900/20 text-yellow-400',
        'APPROVED': 'bg-blue-900/20 text-blue-400',
        'REJECTED': 'bg-red-900/20 text-red-400',
        'PROCESSED': 'bg-green-900/20 text-green-400'
    };
    return classes[status] || 'bg-slate-800 text-slate-400';
}

// Refund actions
async function approveRefund(refundId) {
    if (!confirm('Approve this refund request?')) return;

    try {
        const response = await fetch(`/api/v1/admin/refunds/${refundId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approvedBy: 'admin@stablepay.com' })
        });

        if (response.ok) {
            alert('Refund approved! You can now process it.');
            loadRefunds();
        }
    } catch (error) {
        alert('Failed to approve refund: ' + error.message);
    }
}

async function rejectRefund(refundId) {
    const reason = prompt('Why are you rejecting this refund?');
    if (!reason) return;

    try {
        const response = await fetch(`/api/v1/admin/refunds/${refundId}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });

        if (response.ok) {
            alert('Refund rejected.');
            loadRefunds();
        }
    } catch (error) {
        alert('Failed to reject refund: ' + error.message);
    }
}

async function processRefund(refundId) {
    if (!confirm('Process this refund? This will send USDC to the customer.')) return;

    // TODO: Implement actual USDC sending
    alert('Refund processing not yet implemented. Need to integrate wallet signing.');
}

// Filter buttons
document.querySelectorAll('.refund-filter').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.refund-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadRefunds(btn.dataset.status);
    });
});

// Load refunds when tab is opened
// (Add to existing tab switching logic)
</script>
```

---

### 3. Token Swap Feature (Skeleton Only)

**This is more complex and should be Phase 2. For now, just add:**

1. Admin toggle (already included in HTML above)
2. Placeholder in checkout widget

**File:** `/public/checkout-widget.js` (when Lovable updates it)

Add token selector:
```html
<select id="paymentToken">
  <option value="USDC">USDC (Stablecoin)</option>
  <option value="ETH">ETH (Auto-swap to USDC)</option>
  <option value="MATIC">MATIC (Auto-swap to USDC)</option>
  <option value="SOL">SOL (Auto-swap to USDC)</option>
</select>
```

When selected, show quote:
```
Paying with: 0.005 ETH
Converts to: ~10.2 USDC
Rate: 1 ETH = 2040 USDC
```

**Smart Contract:** See `ADVANCED_FEATURES.md` for full Uniswap/Jupiter integration code.

---

## Implementation Priority

### Phase 1: Refunds (Do This First)
1. ✅ Dashboard UI (already done)
2. Create `/api/v1/orders/[orderId]/refund.js`
3. Create `/api/v1/admin/refunds.js`
4. Add admin toggle to `enterprise-admin.html`
5. Add refunds tab to `enterprise-admin.html`
6. Test end-to-end workflow

### Phase 2: Token Swaps (Future)
1. Research Uniswap V3 / Jupiter integration
2. Deploy smart contracts
3. Add token selector to checkout
4. Implement swap logic
5. Store original token + rate in database

---

## Testing Checklist

### Refunds
- [ ] Merchant sees "Refund" button only on confirmed orders
- [ ] Refund button disabled if refunds not enabled in admin
- [ ] Modal pre-fills customer wallet from transaction
- [ ] API creates Refund record with status PENDING
- [ ] Admin sees refund in Refunds tab
- [ ] Admin can approve refund
- [ ] Admin can reject refund
- [ ] Process refund sends USDC (manual for now)

### Admin Toggles
- [ ] Toggle refunds on/off in System Settings
- [ ] Merchants immediately see feature enabled/disabled
- [ ] Setting persists in localStorage
- [ ] Config section shows/hides when toggled

---

## Questions for Implementation

1. **Refund Sending:** How should admins send USDC?
   - Option A: Manual (admin copies wallet address, sends via MetaMask)
   - Option B: Backend wallet (requires storing private key - risky!)
   - Option C: Smart contract escrow (best, but requires contract deployment)

2. **Token Swaps:** Which DEX aggregator?
   - EVM: Uniswap V3, 1inch, or 0x Protocol?
   - Solana: Jupiter (recommended)

3. **Slippage Protection:** How much slippage tolerance?
   - Recommended: 0.5% for stablecoins, 1-2% for volatile tokens

---

## Files Modified

- ✅ `/public/dashboard.html` - Refund UI added
- ⏳ `/public/enterprise-admin.html` - Add toggles + refunds tab
- ⏳ `/api/v1/orders/[orderId]/refund.js` - Create endpoint
- ⏳ `/api/v1/admin/refunds.js` - Create endpoint
- ⏳ `/public/checkout-widget.js` - Add token selector (Phase 2)

---

## Ready for Lovable

This guide + `ADVANCED_FEATURES.md` + existing code = complete spec for implementation.

**Next Steps:**
1. Give this to Lovable
2. Lovable implements API endpoints
3. Lovable adds admin UI
4. Test refunds workflow
5. (Phase 2) Add token swaps
