// StablePay Dashboard - UI Module
// Handles tab switching, modals, night mode, i18n, and system settings

// Apply system settings visibility
function applySystemSettings() {
    const showPaymentPlans = localStorage.getItem('showPaymentPlans') !== 'false';

    const planElements = document.querySelectorAll('.payment-plan-ref');
    planElements.forEach(el => {
        el.style.display = showPaymentPlans ? '' : 'none';
    });
}

// Tab switching
function switchTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));

    // Show selected tab
    document.getElementById(tabName + 'Tab').classList.remove('hidden');

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('border-blue-500', 'text-blue-400');
        btn.classList.add('border-transparent', 'text-slate-400', 'hover:text-slate-300', 'hover:border-slate-800');
    });

    // Highlight active tab
    const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeBtn) {
        activeBtn.classList.remove('border-transparent', 'text-slate-400', 'hover:text-slate-300', 'hover:border-slate-800');
        activeBtn.classList.add('border-blue-500', 'text-blue-400');
    }

    window.currentTab = tabName;

    // Load tab content
    if (tabName === 'orders' && typeof loadOrders === 'function') {
        loadOrders();
    } else if (tabName === 'wallets' && typeof loadWallets === 'function') {
        loadWallets();
    } else if (tabName === 'settings' && typeof loadSettings === 'function') {
        loadSettings();
    } else if (tabName === 'fees' && typeof loadFeeBalance === 'function') {
        loadFeeBalance();
    } else if (tabName === 'refunds' && typeof loadRefunds === 'function') {
        loadRefunds();
    }
}

// Modal helpers
function showAddWalletModal() {
    document.getElementById('addWalletModal').classList.remove('hidden');
}

function hideAddWalletModal() {
    document.getElementById('addWalletModal').classList.add('hidden');
}

function showProcessRefundModal(refundId, amount) {
    document.getElementById('processRefundModal').classList.remove('hidden');
    document.getElementById('processRefundId').value = refundId;
    document.getElementById('refundAmountDisplay').textContent = amount;
}

function hideProcessRefundModal() {
    document.getElementById('processRefundModal').classList.add('hidden');
}

// Copy to clipboard helper
function copyToClipboard(button, text) {
    navigator.clipboard.writeText(text).then(() => {
        const originalText = button.textContent;
        button.textContent = 'Copied!';
        setTimeout(() => { button.textContent = originalText; }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

// Copy merchant ID to clipboard
function copyMerchantId() {
    if (!window.currentMerchant || !window.currentMerchant.id) {
        alert('Merchant ID not available');
        return;
    }

    navigator.clipboard.writeText(window.currentMerchant.id).then(() => {
        const btn = document.getElementById('copyMerchantBtn');
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        prompt('Copy your Merchant ID:', window.currentMerchant.id);
    });
}

// Show framework documentation
function showFramework(framework) {
    document.querySelectorAll('.framework-content').forEach(el => el.classList.add('hidden'));
    const content = document.getElementById(framework + 'Content');
    if (content) content.classList.remove('hidden');

    document.querySelectorAll('.framework-tab').forEach(btn => {
        btn.classList.remove('bg-slate-700', 'text-white');
        btn.classList.add('text-slate-400', 'hover:text-white');
    });
    const activeBtn = document.querySelector(`[data-framework="${framework}"]`);
    if (activeBtn) {
        activeBtn.classList.add('bg-slate-700', 'text-white');
        activeBtn.classList.remove('text-slate-400', 'hover:text-white');
    }
}

// Day/Night mode toggle initialization
function initNightMode() {
    const nightModeToggle = document.getElementById('nightModeToggle');
    if (!nightModeToggle) return;

    const nightIcon = nightModeToggle.querySelector('.night-icon');
    const dayIcon = nightModeToggle.querySelector('.day-icon');

    // Check for saved preference (dayMode = light theme)
    const savedDayMode = localStorage.getItem('dayMode');
    if (savedDayMode === 'true') {
        document.body.classList.add('day-mode');
        if (nightIcon) nightIcon.classList.remove('hidden');
        if (dayIcon) dayIcon.classList.add('hidden');
    }

    nightModeToggle.addEventListener('click', () => {
        document.body.classList.toggle('day-mode');
        if (nightIcon) nightIcon.classList.toggle('hidden');
        if (dayIcon) dayIcon.classList.toggle('hidden');
        localStorage.setItem('dayMode', document.body.classList.contains('day-mode'));
    });
}

// i18n Translation system
let translations = {};
let currentLang = 'en';

async function changeLanguage(lang) {
    try {
        const response = await fetch(`./locales/dashboard-${lang}.json`);
        translations = await response.json();
        currentLang = lang;
        localStorage.setItem('language', lang);
        const selector = document.getElementById('langSelector');
        if (selector) selector.value = lang;
        updatePageText();
    } catch (error) {
        console.error('Error loading translation:', error);
    }
}

function updatePageText() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const keys = key.split('.');
        let value = translations;

        for (const k of keys) {
            value = value[k];
            if (!value) break;
        }

        if (value) {
            if (value.includes('<')) {
                element.innerHTML = value;
            } else {
                element.textContent = value;
            }
        }
    });
}

function initLanguage() {
    const savedLang = localStorage.getItem('language') || 'en';
    const selector = document.getElementById('langSelector');
    if (selector) selector.value = savedLang;
    changeLanguage(savedLang);
}

// Keep for backwards compatibility
function updateQuickActionLinks() {
    // No longer needed - modals handle this now
}

// Export for use in other modules
window.DashboardUI = {
    applySystemSettings,
    switchTab,
    showAddWalletModal,
    hideAddWalletModal,
    showProcessRefundModal,
    hideProcessRefundModal,
    copyToClipboard,
    copyMerchantId,
    showFramework,
    initNightMode,
    changeLanguage,
    updatePageText,
    initLanguage,
    updateQuickActionLinks
};
