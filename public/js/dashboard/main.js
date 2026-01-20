// StablePay Dashboard - Main Module
// Initializes the dashboard and ties all modules together

// Global state
window.currentMerchant = null;
window.currentTab = 'orders';
window.merchantWallets = [];

// Volume-based pricing tiers (automatic based on 30-day volume)
const VOLUME_TIERS = [
    { name: 'Starter', minVolume: 0, maxVolume: 10000, feePercent: 0.5 },
    { name: 'Growth', minVolume: 10000, maxVolume: 50000, feePercent: 0.4 },
    { name: 'Scale', minVolume: 50000, maxVolume: 250000, feePercent: 0.3 },
    { name: 'Volume', minVolume: 250000, maxVolume: Infinity, feePercent: 0.2 }
];

// Test mode limits
const TEST_MODE_LIMITS = {
    mainnetVolume: 100,
    mainnetTxns: 10
};

// Legacy tier mapping for backwards compatibility
const PRICING_TIERS = {
    FREE: { name: 'Test Mode', blockchains: 6, refunds: true, webhooks: true },
    STARTER: { name: 'Live', blockchains: 6, refunds: true, webhooks: true },
    PRO: { name: 'Live', blockchains: 6, refunds: true, webhooks: true },
    ENTERPRISE: { name: 'Enterprise', blockchains: 6, refunds: true, webhooks: true }
};

// Get volume tier based on monthly volume
function getVolumeTier(monthlyVolume) {
    for (const tier of VOLUME_TIERS) {
        if (monthlyVolume >= tier.minVolume && monthlyVolume < tier.maxVolume) {
            return tier;
        }
    }
    return VOLUME_TIERS[VOLUME_TIERS.length - 1];
}

// Update pricing tier display
function updatePricingTierDisplay(merchant) {
    const monthlyVolume = parseFloat(merchant.monthlyVolumeUsed || 0);
    const tier = getVolumeTier(monthlyVolume);

    // Update tier name display
    const tierName = document.getElementById('currentTierName');
    if (tierName) tierName.textContent = tier.name;

    // Update fee rate display
    const feeRate = document.getElementById('currentFeeRate');
    if (feeRate) feeRate.textContent = `${tier.feePercent}%`;

    // Update volume display
    const volumeDisplay = document.getElementById('monthlyVolumeDisplay');
    if (volumeDisplay) volumeDisplay.textContent = `$${monthlyVolume.toFixed(2)}`;

    // Update next tier info
    const nextTierIndex = VOLUME_TIERS.indexOf(tier) + 1;
    const nextTierInfo = document.getElementById('nextTierInfo');

    if (nextTierIndex < VOLUME_TIERS.length && nextTierInfo) {
        const nextTier = VOLUME_TIERS[nextTierIndex];
        const volumeNeeded = nextTier.minVolume - monthlyVolume;
        nextTierInfo.innerHTML = `
            <span class="text-slate-400">$${volumeNeeded.toFixed(0)} more volume to reach</span>
            <span class="text-blue-400 font-medium">${nextTier.name} (${nextTier.feePercent}% fee)</span>
        `;
        nextTierInfo.classList.remove('hidden');
    } else if (nextTierInfo) {
        nextTierInfo.classList.add('hidden');
    }

    // Show upgrade button for test mode
    const upgradeBtn = document.getElementById('upgradeToLiveBtn');
    if (upgradeBtn) {
        if (merchant.plan === 'FREE') {
            upgradeBtn.classList.remove('hidden');
            upgradeBtn.onclick = () => window.location.href = '/pricing.html#volume-tiers';
        } else {
            upgradeBtn.classList.add('hidden');
        }
    }
}

// Update widget code in developer section
function updateWidgetCode() {
    const codeBlock = document.getElementById('widgetCodeBlock');
    if (!codeBlock || !window.currentMerchant) return;

    const merchantId = window.currentMerchant.id;
    codeBlock.innerHTML = `&lt;script src="${window.location.origin}/sdk/stablepay.js"&gt;&lt;/script&gt;
&lt;script&gt;
  StablePay.init({
    merchantId: '${merchantId}',
    onSuccess: (order) =&gt; console.log('Payment complete:', order),
    onError: (error) =&gt; console.error('Payment failed:', error)
  });

  // Open payment modal
  StablePay.checkout({
    amount: 10.00,
    productName: 'My Product'
  });
&lt;/script&gt;`;
}

// Initialize dashboard
async function initDashboard() {
    // Check authentication
    const isAuthenticated = window.DashboardAuth?.isAuthenticated;
    if (isAuthenticated && !isAuthenticated()) {
        window.location.href = '/login.html';
        return;
    }

    // Apply system settings
    if (typeof applySystemSettings === 'function') {
        applySystemSettings();
    } else if (window.DashboardUI?.applySystemSettings) {
        window.DashboardUI.applySystemSettings();
    }

    // Initialize night mode
    if (window.DashboardUI?.initNightMode) {
        window.DashboardUI.initNightMode();
    }

    // Initialize language
    if (window.DashboardUI?.initLanguage) {
        window.DashboardUI.initLanguage();
    }

    // Load merchant data
    if (typeof loadMerchantData === 'function') {
        await loadMerchantData();
    } else if (window.DashboardAuth?.loadMerchantData) {
        await window.DashboardAuth.loadMerchantData();
    }

    // Set up tab click handlers
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.getAttribute('data-tab');
            if (tabName) {
                if (typeof switchTab === 'function') {
                    switchTab(tabName);
                } else if (window.DashboardUI?.switchTab) {
                    window.DashboardUI.switchTab(tabName);
                }
            }
        });
    });

    // Set up logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (window.DashboardAuth?.logout) {
                window.DashboardAuth.logout();
            } else {
                sessionStorage.removeItem('merchantId');
                sessionStorage.removeItem('merchantToken');
                window.location.href = '/login.html';
            }
        });
    }

    // Show React framework by default in Developer tab
    setTimeout(() => {
        if (typeof showFramework === 'function') {
            showFramework('react');
        } else if (window.DashboardUI?.showFramework) {
            window.DashboardUI.showFramework('react');
        }
    }, 100);
}

// Make functions globally available
window.getVolumeTier = getVolumeTier;
window.updatePricingTierDisplay = updatePricingTierDisplay;
window.updateWidgetCode = updateWidgetCode;
window.VOLUME_TIERS = VOLUME_TIERS;
window.PRICING_TIERS = PRICING_TIERS;
window.TEST_MODE_LIMITS = TEST_MODE_LIMITS;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initDashboard);

// Export main module
window.DashboardMain = {
    initDashboard,
    getVolumeTier,
    updatePricingTierDisplay,
    updateWidgetCode,
    VOLUME_TIERS,
    PRICING_TIERS,
    TEST_MODE_LIMITS
};
