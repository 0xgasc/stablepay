// StablePay Dashboard - Authentication Module
// Handles merchant authentication, profile loading, and session management

// Load merchant data and populate dashboard
async function loadMerchantData() {
    try {
        // Get merchant ID and token from session
        const merchantId = sessionStorage.getItem('merchantId');
        const merchantToken = sessionStorage.getItem('merchantToken');

        if (!merchantId && !merchantToken) {
            console.error('No merchant authentication found');
            window.location.href = '/login.html';
            return;
        }

        // Fetch actual merchant data from API
        const response = await fetch(`/api/merchant-profile?${merchantId ? 'id=' + merchantId : 'token=' + merchantToken}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('API error:', errorText);
            throw new Error('Failed to load merchant data: ' + errorText);
        }

        window.currentMerchant = await response.json();

        // Set defaults if missing
        window.currentMerchant.plan = window.currentMerchant.plan || 'STARTER';
        window.currentMerchant.networkMode = window.currentMerchant.networkMode || 'TESTNET';
        window.currentMerchant.paymentMode = window.currentMerchant.paymentMode || 'DIRECT';

        // Apply visibility settings based on merchant config
        if (typeof applySystemSettings === 'function') {
            applySystemSettings();
        }

        // Update UI elements
        updateMerchantUI(window.currentMerchant);

        // Populate merchantWallets immediately so Quick Actions work
        if (window.currentMerchant.wallets) {
            window.merchantWallets = window.currentMerchant.wallets;
        }

        // Load current tab content after merchant data is ready
        if (window.currentTab === 'orders' && typeof loadOrders === 'function') {
            loadOrders();
        } else if (window.currentTab === 'wallets' && typeof loadWallets === 'function') {
            loadWallets();
        } else if (window.currentTab === 'fees' && typeof loadFeeBalance === 'function') {
            loadFeeBalance();
        }

        // Always check for fees to show alert badge
        if (typeof checkFeeBalance === 'function') {
            checkFeeBalance();
        }
    } catch (error) {
        console.error('Error loading merchant data:', error);
        document.getElementById('merchantName').textContent = 'Error Loading Data';
        alert('Failed to load merchant data. Please check console for details.');
    }
}

// Update UI with merchant data
function updateMerchantUI(merchant) {
    // Update merchant name in header
    const merchantNameEl = document.getElementById('merchantName');
    if (merchantNameEl) merchantNameEl.textContent = merchant.companyName;

    // Update profile card
    const profileCompanyName = document.getElementById('profileCompanyName');
    if (profileCompanyName) profileCompanyName.textContent = merchant.companyName;

    const profileEmail = document.getElementById('profileEmail');
    if (profileEmail) profileEmail.textContent = merchant.email;

    const profileContact = document.getElementById('profileContact');
    if (profileContact) profileContact.textContent = merchant.contactName;

    const profilePlan = document.getElementById('profilePlan');
    if (profilePlan) profilePlan.textContent = merchant.plan || 'FREE';

    const profileOrderCount = document.getElementById('profileOrderCount');
    if (profileOrderCount) profileOrderCount.textContent = merchant.orderCount || 0;

    // Set company initial
    const profileInitial = document.getElementById('profileInitial');
    if (profileInitial) {
        const initial = merchant.companyName ? merchant.companyName.charAt(0).toUpperCase() : '?';
        profileInitial.textContent = initial;
    }

    // Format created date
    const profileCreatedAt = document.getElementById('profileCreatedAt');
    if (profileCreatedAt && merchant.createdAt) {
        const created = new Date(merchant.createdAt);
        profileCreatedAt.textContent = created.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }

    // Update pricing tier card
    if (typeof updatePricingTierDisplay === 'function') {
        updatePricingTierDisplay(merchant);
    }

    // Update status badge
    const statusBadge = document.getElementById('profileStatusBadge');
    const pendingBanner = document.getElementById('pendingBanner');
    if (statusBadge) {
        if (merchant.isActive) {
            statusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium mb-2 bg-green-500/20 text-green-300';
            statusBadge.innerHTML = '<span>Active</span>';
            if (pendingBanner) pendingBanner.classList.add('hidden');
        } else {
            statusBadge.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium mb-2 bg-yellow-500/20 text-yellow-300';
            statusBadge.innerHTML = '<span>Pending</span>';
            if (pendingBanner) pendingBanner.classList.remove('hidden');
        }
    }

    // Update settings form
    const companyNameInput = document.getElementById('companyName');
    if (companyNameInput) companyNameInput.value = merchant.companyName;

    const contactNameInput = document.getElementById('contactName');
    if (contactNameInput) contactNameInput.value = merchant.contactName;

    const emailInput = document.getElementById('email');
    if (emailInput) emailInput.value = merchant.email;

    const planInput = document.getElementById('plan');
    if (planInput) planInput.value = merchant.plan;

    // Update API developer section
    const apiMerchantId = document.getElementById('apiMerchantId');
    if (apiMerchantId) apiMerchantId.textContent = merchant.id;

    // Update merchant ID in code example
    const exampleMerchantId = document.getElementById('exampleMerchantId');
    if (exampleMerchantId) exampleMerchantId.textContent = merchant.id;

    // Update widget code with merchant ID
    if (typeof updateWidgetCode === 'function') {
        updateWidgetCode();
    }

    // Update quick action links with merchant ID
    if (typeof updateQuickActionLinks === 'function') {
        updateQuickActionLinks();
    }
}

// Logout function
function logout() {
    sessionStorage.removeItem('merchantId');
    sessionStorage.removeItem('merchantToken');
    window.location.href = '/login.html';
}

// Check if user is authenticated
function isAuthenticated() {
    const merchantId = sessionStorage.getItem('merchantId');
    const merchantToken = sessionStorage.getItem('merchantToken');
    return !!(merchantId || merchantToken);
}

// Get auth headers for API calls
function getAuthHeaders() {
    const merchantToken = sessionStorage.getItem('merchantToken');
    return {
        'Authorization': `Bearer ${merchantToken}`,
        'Content-Type': 'application/json'
    };
}

// Get merchant ID from session
function getMerchantId() {
    return sessionStorage.getItem('merchantId');
}

// Get merchant token from session
function getMerchantToken() {
    return sessionStorage.getItem('merchantToken');
}

// Export for use in other modules
window.DashboardAuth = {
    loadMerchantData,
    updateMerchantUI,
    logout,
    isAuthenticated,
    getAuthHeaders,
    getMerchantId,
    getMerchantToken
};
