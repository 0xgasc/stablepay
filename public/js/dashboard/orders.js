// StablePay Dashboard - Orders Module
// Handles order listing, filtering, and order management

let ordersCache = [];
let currentSort = { field: 'createdAt', direction: 'desc' };
let currentFilters = { status: 'all', chain: 'all' };

// Load orders from API
async function loadOrders() {
    try {
        const merchantId = sessionStorage.getItem('merchantId');
        const merchantToken = sessionStorage.getItem('merchantToken');

        if (!merchantId || !merchantToken) {
            console.error('No merchant authentication for orders');
            return;
        }

        const response = await fetch(`/api/v1/orders?merchantId=${merchantId}`, {
            headers: { 'Authorization': `Bearer ${merchantToken}` }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch orders');
        }

        const orders = await response.json();
        ordersCache = orders;

        updateStats(orders);
        renderOrdersTable(orders);
    } catch (error) {
        console.error('Error loading orders:', error);
        const ordersTableBody = document.getElementById('ordersTableBody');
        if (ordersTableBody) {
            ordersTableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-8 text-red-400">
                        Error loading orders. Please try again.
                    </td>
                </tr>
            `;
        }
    }
}

// Update statistics display
function updateStats(orders) {
    const orderCount = document.getElementById('orderCount');
    const totalVolume = document.getElementById('totalVolume');
    const confirmedCount = document.getElementById('confirmedCount');

    if (!Array.isArray(orders)) {
        orders = [];
    }

    const total = orders.length;
    const confirmed = orders.filter(o => o.status === 'CONFIRMED' || o.status === 'PAID').length;
    const volume = orders
        .filter(o => o.status === 'CONFIRMED' || o.status === 'PAID')
        .reduce((sum, o) => sum + parseFloat(o.amount || 0), 0);

    if (orderCount) orderCount.textContent = total;
    if (totalVolume) totalVolume.textContent = `$${volume.toFixed(2)}`;
    if (confirmedCount) confirmedCount.textContent = confirmed;
}

// Render orders table
function renderOrdersTable(orders) {
    const ordersTableBody = document.getElementById('ordersTableBody');
    if (!ordersTableBody) return;

    if (!orders || orders.length === 0) {
        ordersTableBody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-8 text-slate-400">
                    No orders yet. Create your first test payment to get started!
                </td>
            </tr>
        `;
        return;
    }

    // Apply filters
    let filteredOrders = orders;
    if (currentFilters.status !== 'all') {
        filteredOrders = filteredOrders.filter(o => o.status === currentFilters.status);
    }
    if (currentFilters.chain !== 'all') {
        filteredOrders = filteredOrders.filter(o => o.chain === currentFilters.chain);
    }

    // Apply sorting
    filteredOrders.sort((a, b) => {
        let aVal = a[currentSort.field];
        let bVal = b[currentSort.field];

        if (currentSort.field === 'amount') {
            aVal = parseFloat(aVal);
            bVal = parseFloat(bVal);
        } else if (currentSort.field === 'createdAt') {
            aVal = new Date(aVal);
            bVal = new Date(bVal);
        }

        if (currentSort.direction === 'asc') {
            return aVal > bVal ? 1 : -1;
        } else {
            return aVal < bVal ? 1 : -1;
        }
    });

    ordersTableBody.innerHTML = filteredOrders.map(order => {
        const statusColors = {
            'PENDING': 'bg-yellow-500/20 text-yellow-300',
            'PAID': 'bg-blue-500/20 text-blue-300',
            'CONFIRMED': 'bg-green-500/20 text-green-300',
            'EXPIRED': 'bg-red-500/20 text-red-300',
            'REFUNDED': 'bg-purple-500/20 text-purple-300'
        };

        const statusColor = statusColors[order.status] || 'bg-slate-500/20 text-slate-300';
        const formatChainName = window.DashboardChains?.formatChainName || (c => c);
        const createdAt = new Date(order.createdAt).toLocaleString();

        return `
            <tr class="border-b border-slate-700/50 hover:bg-slate-800/50">
                <td class="py-4 px-4">
                    <span class="font-mono text-xs">${order.id.substring(0, 8)}...</span>
                </td>
                <td class="py-4 px-4">
                    <span class="font-bold">$${parseFloat(order.amount).toFixed(2)}</span>
                    <span class="text-slate-400 text-xs ml-1">USDC</span>
                </td>
                <td class="py-4 px-4">
                    <span class="text-sm">${formatChainName(order.chain)}</span>
                </td>
                <td class="py-4 px-4">
                    <span class="px-2 py-1 rounded-full text-xs font-medium ${statusColor}">
                        ${order.status}
                    </span>
                </td>
                <td class="py-4 px-4 text-slate-400 text-sm">${createdAt}</td>
                <td class="py-4 px-4">
                    <button onclick="viewReceipt('${order.id}')"
                            class="text-blue-400 hover:text-blue-300 text-sm">
                        View
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Sort orders by field
function sortOrders(field) {
    if (currentSort.field === field) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.field = field;
        currentSort.direction = 'desc';
    }
    renderOrdersTable(ordersCache);
}

// Filter orders
function filterOrders(type, value) {
    currentFilters[type] = value;
    renderOrdersTable(ordersCache);
}

// View order receipt
function viewReceipt(orderId) {
    const order = ordersCache.find(o => o.id === orderId);
    if (!order) {
        alert('Order not found');
        return;
    }

    const modal = document.getElementById('receiptModal');
    if (!modal) return;

    // Populate receipt details
    const receiptOrderId = document.getElementById('receiptOrderId');
    if (receiptOrderId) receiptOrderId.textContent = order.id;

    const receiptAmount = document.getElementById('receiptAmount');
    if (receiptAmount) receiptAmount.textContent = `$${parseFloat(order.amount).toFixed(2)} USDC`;

    const receiptChain = document.getElementById('receiptChain');
    const formatChainName = window.DashboardChains?.formatChainName || (c => c);
    if (receiptChain) receiptChain.textContent = formatChainName(order.chain);

    const receiptStatus = document.getElementById('receiptStatus');
    if (receiptStatus) receiptStatus.textContent = order.status;

    const receiptCreated = document.getElementById('receiptCreated');
    if (receiptCreated) receiptCreated.textContent = new Date(order.createdAt).toLocaleString();

    const receiptCustomer = document.getElementById('receiptCustomer');
    if (receiptCustomer) receiptCustomer.textContent = order.customerEmail || 'Anonymous';

    // Show transaction hash if available
    const txSection = document.getElementById('receiptTxSection');
    if (txSection && order.transactions && order.transactions.length > 0) {
        const tx = order.transactions[0];
        const receiptTxHash = document.getElementById('receiptTxHash');
        if (receiptTxHash) {
            const getExplorerLink = window.DashboardChains?.getExplorerLink || (() => '#');
            receiptTxHash.innerHTML = `<a href="${getExplorerLink(order.chain, tx.txHash)}" target="_blank" class="text-blue-400 hover:text-blue-300">${tx.txHash.substring(0, 20)}...</a>`;
        }
        txSection.classList.remove('hidden');
    } else if (txSection) {
        txSection.classList.add('hidden');
    }

    modal.classList.remove('hidden');
}

// Close receipt modal
function closeReceiptModal() {
    const modal = document.getElementById('receiptModal');
    if (modal) modal.classList.add('hidden');
}

// Print receipt
function printReceipt(orderId) {
    const order = ordersCache.find(o => o.id === orderId);
    if (!order) return;

    const printWindow = window.open('', '_blank');
    const formatChainName = window.DashboardChains?.formatChainName || (c => c);

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Receipt - ${order.id}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                .header { text-align: center; margin-bottom: 30px; }
                .details { margin: 20px 0; }
                .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>StablePay Receipt</h1>
                <p>Order #${order.id}</p>
            </div>
            <div class="details">
                <div class="row"><span>Amount:</span><span>$${parseFloat(order.amount).toFixed(2)} USDC</span></div>
                <div class="row"><span>Chain:</span><span>${formatChainName(order.chain)}</span></div>
                <div class="row"><span>Status:</span><span>${order.status}</span></div>
                <div class="row"><span>Date:</span><span>${new Date(order.createdAt).toLocaleString()}</span></div>
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.print();
}

// Export for use in other modules
window.DashboardOrders = {
    loadOrders,
    updateStats,
    renderOrdersTable,
    sortOrders,
    filterOrders,
    viewReceipt,
    closeReceiptModal,
    printReceipt
};

// Make functions globally available
window.loadOrders = loadOrders;
window.viewReceipt = viewReceipt;
window.sortOrders = sortOrders;
window.printReceipt = printReceipt;
