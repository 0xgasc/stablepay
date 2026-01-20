// StablePay Dashboard - Refunds Module
// Handles refund listing, approval, and processing

let refundsCache = {
    pending: [],
    approved: [],
    processed: []
};

// Load refunds from API
async function loadRefunds() {
    try {
        const merchantId = sessionStorage.getItem('merchantId');
        const merchantToken = sessionStorage.getItem('merchantToken');

        if (!merchantId || !merchantToken) {
            console.error('No merchant authentication for refunds');
            return;
        }

        const response = await fetch(`/api/refunds?merchantId=${merchantId}`, {
            headers: { 'Authorization': `Bearer ${merchantToken}` }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch refunds');
        }

        const data = await response.json();
        const refunds = data.refunds || [];

        // Categorize refunds
        refundsCache.pending = refunds.filter(r => r.status === 'PENDING');
        refundsCache.approved = refunds.filter(r => r.status === 'APPROVED');
        refundsCache.processed = refunds.filter(r => r.status === 'PROCESSED');

        // Render all sections
        renderPendingRefunds();
        renderApprovedRefunds();
        renderProcessedRefunds();

        // Update counts
        updateRefundCounts();
    } catch (error) {
        console.error('Error loading refunds:', error);
    }
}

// Update refund tab counts
function updateRefundCounts() {
    const pendingCount = document.getElementById('pendingRefundsCount');
    const approvedCount = document.getElementById('approvedRefundsCount');
    const processedCount = document.getElementById('processedRefundsCount');

    if (pendingCount) pendingCount.textContent = refundsCache.pending.length;
    if (approvedCount) approvedCount.textContent = refundsCache.approved.length;
    if (processedCount) processedCount.textContent = refundsCache.processed.length;
}

// Render pending refunds
function renderPendingRefunds() {
    const container = document.getElementById('pendingRefundsList');
    if (!container) return;

    if (refundsCache.pending.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-slate-400">
                No pending refund requests
            </div>
        `;
        return;
    }

    container.innerHTML = refundsCache.pending.map(refund => `
        <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50 mb-3">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <span class="text-lg font-bold">$${parseFloat(refund.amount).toFixed(2)}</span>
                    <span class="text-slate-400 text-sm ml-2">USDC</span>
                </div>
                <span class="px-2 py-1 rounded-full text-xs bg-yellow-500/20 text-yellow-300">
                    Pending
                </span>
            </div>
            <div class="text-sm text-slate-400 mb-3">
                <div>Order: ${refund.orderId?.substring(0, 8)}...</div>
                <div>Reason: ${refund.reason}</div>
                <div>Requested: ${new Date(refund.createdAt).toLocaleString()}</div>
            </div>
            <div class="flex gap-2">
                <button onclick="approveRefund('${refund.id}')"
                        class="flex-1 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded font-medium">
                    Approve
                </button>
                <button onclick="rejectRefund('${refund.id}')"
                        class="flex-1 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded font-medium">
                    Reject
                </button>
            </div>
        </div>
    `).join('');
}

// Render approved refunds (ready to process)
function renderApprovedRefunds() {
    const container = document.getElementById('approvedRefundsList');
    if (!container) return;

    if (refundsCache.approved.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-slate-400">
                No approved refunds awaiting processing
            </div>
        `;
        return;
    }

    container.innerHTML = refundsCache.approved.map(refund => `
        <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50 mb-3">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <span class="text-lg font-bold">$${parseFloat(refund.amount).toFixed(2)}</span>
                    <span class="text-slate-400 text-sm ml-2">USDC</span>
                </div>
                <span class="px-2 py-1 rounded-full text-xs bg-blue-500/20 text-blue-300">
                    Approved
                </span>
            </div>
            <div class="text-sm text-slate-400 mb-3">
                <div>Order: ${refund.orderId?.substring(0, 8)}...</div>
                <div>Customer Wallet: ${refund.order?.transactions?.[0]?.fromAddress?.substring(0, 10) || 'Unknown'}...</div>
            </div>
            <button onclick="showProcessRefundModal('${refund.id}', '${refund.amount}')"
                    class="w-full bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-medium">
                Process Refund
            </button>
        </div>
    `).join('');
}

// Render processed refunds (history)
function renderProcessedRefunds() {
    const container = document.getElementById('processedRefundsList');
    if (!container) return;

    if (refundsCache.processed.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8 text-slate-400">
                No processed refunds yet
            </div>
        `;
        return;
    }

    container.innerHTML = refundsCache.processed.map(refund => {
        const getExplorerLink = window.DashboardChains?.getExplorerLink || (() => '#');
        const chain = refund.order?.chain || 'BASE_SEPOLIA';

        return `
            <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50 mb-3">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <span class="text-lg font-bold">$${parseFloat(refund.amount).toFixed(2)}</span>
                        <span class="text-slate-400 text-sm ml-2">USDC</span>
                    </div>
                    <span class="px-2 py-1 rounded-full text-xs bg-green-500/20 text-green-300">
                        Processed
                    </span>
                </div>
                <div class="text-sm text-slate-400">
                    <div>Order: ${refund.orderId?.substring(0, 8)}...</div>
                    ${refund.refundTxHash ? `
                        <div>
                            Tx: <a href="${getExplorerLink(chain, refund.refundTxHash)}" target="_blank"
                                   class="text-blue-400 hover:text-blue-300">
                                ${refund.refundTxHash.substring(0, 16)}...
                            </a>
                        </div>
                    ` : ''}
                    <div>Processed: ${new Date(refund.updatedAt).toLocaleString()}</div>
                </div>
            </div>
        `;
    }).join('');
}

// Approve a refund
async function approveRefund(refundId) {
    try {
        const merchantToken = sessionStorage.getItem('merchantToken');

        const response = await fetch(`/api/refunds/${refundId}/approve`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${merchantToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to approve refund');
        }

        // Reload refunds
        await loadRefunds();
    } catch (error) {
        console.error('Error approving refund:', error);
        alert('Failed to approve refund. Please try again.');
    }
}

// Reject a refund
async function rejectRefund(refundId) {
    const reason = prompt('Please provide a reason for rejection:');
    if (!reason) return;

    try {
        const merchantToken = sessionStorage.getItem('merchantToken');

        const response = await fetch(`/api/refunds/${refundId}/reject`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${merchantToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reason })
        });

        if (!response.ok) {
            throw new Error('Failed to reject refund');
        }

        // Reload refunds
        await loadRefunds();
    } catch (error) {
        console.error('Error rejecting refund:', error);
        alert('Failed to reject refund. Please try again.');
    }
}

// Process a refund (submit tx hash)
async function processRefund(refundId, txHash) {
    try {
        const merchantToken = sessionStorage.getItem('merchantToken');

        const response = await fetch(`/api/refunds/${refundId}/process`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${merchantToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ txHash })
        });

        if (!response.ok) {
            throw new Error('Failed to process refund');
        }

        // Hide modal and reload refunds
        if (typeof hideProcessRefundModal === 'function') {
            hideProcessRefundModal();
        }
        await loadRefunds();
    } catch (error) {
        console.error('Error processing refund:', error);
        alert('Failed to process refund. Please try again.');
    }
}

// Check for pending refunds (for badge)
async function checkPendingRefunds() {
    try {
        const merchantId = sessionStorage.getItem('merchantId');
        const merchantToken = sessionStorage.getItem('merchantToken');

        if (!merchantId || !merchantToken) return;

        const response = await fetch(`/api/refunds/pending`, {
            headers: { 'Authorization': `Bearer ${merchantToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            const badge = document.getElementById('refundsAlertBadge');
            if (badge) {
                if (data.refunds && data.refunds.length > 0) {
                    badge.classList.remove('hidden');
                    badge.textContent = data.refunds.length;
                } else {
                    badge.classList.add('hidden');
                }
            }
        }
    } catch (error) {
        console.error('Error checking pending refunds:', error);
    }
}

// Export for use in other modules
window.DashboardRefunds = {
    loadRefunds,
    renderPendingRefunds,
    renderApprovedRefunds,
    renderProcessedRefunds,
    approveRefund,
    rejectRefund,
    processRefund,
    checkPendingRefunds
};

// Make functions globally available
window.loadRefunds = loadRefunds;
window.approveRefund = approveRefund;
window.rejectRefund = rejectRefund;
window.processRefund = processRefund;
