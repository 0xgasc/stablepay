// StablePay Dashboard - Wallets Module
// Handles wallet configuration and management

// Load wallets from API
async function loadWallets() {
    try {
        const merchantId = sessionStorage.getItem('merchantId');
        const merchantToken = sessionStorage.getItem('merchantToken');

        if (!merchantId || !merchantToken) {
            console.error('No merchant authentication for wallets');
            return;
        }

        const response = await fetch(`/api/merchant-profile?id=${merchantId}`, {
            headers: { 'Authorization': `Bearer ${merchantToken}` }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch wallets');
        }

        const merchant = await response.json();
        window.merchantWallets = merchant.wallets || [];

        renderChainToggles();
    } catch (error) {
        console.error('Error loading wallets:', error);
    }
}

// Render chain toggles for wallet configuration
function renderChainToggles() {
    const container = document.getElementById('chainTogglesContainer');
    if (!container) return;

    const CHAIN_GROUPS = window.DashboardChains?.CHAIN_GROUPS || [];

    container.innerHTML = CHAIN_GROUPS.map(group => `
        <div class="mb-6">
            <h4 class="text-lg font-bold mb-3 flex items-center gap-2">
                <span class="w-3 h-3 rounded-full" style="background: ${group.color}"></span>
                ${group.name}
            </h4>
            <div class="space-y-3">
                ${group.networks.map(net => {
                    const wallet = window.merchantWallets?.find(w => w.chain === net.id);
                    const isActive = wallet?.isActive;
                    const address = wallet?.address || '';

                    return `
                        <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                            <div class="flex items-center justify-between mb-2">
                                <div>
                                    <span class="font-medium">${net.label}</span>
                                    <span class="text-xs ml-2 px-2 py-0.5 rounded-full ${net.type === 'mainnet' ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-300'}">
                                        ${net.type}
                                    </span>
                                </div>
                                <label class="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" class="sr-only peer chain-toggle"
                                           data-chain="${net.id}"
                                           ${isActive ? 'checked' : ''}
                                           onchange="toggleChain('${net.id}', this.checked)">
                                    <div class="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:bg-blue-500 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                                </label>
                            </div>
                            <div class="flex gap-2">
                                <input type="text"
                                       id="wallet-${net.id}"
                                       value="${address}"
                                       placeholder="Enter wallet address"
                                       class="flex-1 bg-slate-900/50 border border-slate-600 rounded px-3 py-2 text-sm font-mono"
                                       ${!isActive ? 'disabled' : ''}>
                                <button onclick="saveWallet('${net.id}')"
                                        class="btn-brutal px-4 py-2 text-sm ${!isActive ? 'opacity-50 cursor-not-allowed' : ''}"
                                        ${!isActive ? 'disabled' : ''}>
                                    Save
                                </button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `).join('');
}

// Toggle chain enabled/disabled
async function toggleChain(chainId, enabled) {
    const input = document.getElementById(`wallet-${chainId}`);
    const saveBtn = input?.nextElementSibling;

    if (input) {
        input.disabled = !enabled;
    }
    if (saveBtn) {
        saveBtn.disabled = !enabled;
        saveBtn.classList.toggle('opacity-50', !enabled);
        saveBtn.classList.toggle('cursor-not-allowed', !enabled);
    }

    // If enabling and no address, don't save yet
    if (enabled && !input?.value) {
        return;
    }

    // Save the toggle state
    await saveWallet(chainId, enabled);
}

// Save wallet address
async function saveWallet(chainId, isActive = true) {
    try {
        const merchantId = sessionStorage.getItem('merchantId');
        const merchantToken = sessionStorage.getItem('merchantToken');
        const input = document.getElementById(`wallet-${chainId}`);
        const address = input?.value?.trim();

        if (!address && isActive) {
            alert('Please enter a wallet address');
            return;
        }

        const response = await fetch('/api/merchant/wallets', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${merchantToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                merchantId,
                chain: chainId,
                address: address || '',
                isActive
            })
        });

        if (!response.ok) {
            throw new Error('Failed to save wallet');
        }

        // Update local cache
        const existingIndex = window.merchantWallets?.findIndex(w => w.chain === chainId);
        if (existingIndex >= 0) {
            window.merchantWallets[existingIndex] = { chain: chainId, address, isActive };
        } else if (window.merchantWallets) {
            window.merchantWallets.push({ chain: chainId, address, isActive });
        }

        // Show success feedback
        const btn = input?.nextElementSibling;
        if (btn) {
            const originalText = btn.textContent;
            btn.textContent = 'Saved!';
            setTimeout(() => { btn.textContent = originalText; }, 2000);
        }
    } catch (error) {
        console.error('Error saving wallet:', error);
        alert('Failed to save wallet. Please try again.');
    }
}

// Reset wallet connection state
function resetWalletConnection() {
    window.connectedWallet = null;
    window.connectedChain = null;
}

// Update test wallet display
function updateTestWalletDisplay(chainId) {
    const wallet = window.merchantWallets?.find(w => w.chain === chainId);
    const display = document.getElementById('testPaymentWallet');
    if (display && wallet) {
        display.textContent = wallet.address
            ? `${wallet.address.substring(0, 6)}...${wallet.address.substring(wallet.address.length - 4)}`
            : 'Not configured';
    }
}

// Load settings (alias for backwards compatibility)
function loadSettings() {
    loadWallets();
}

// Export for use in other modules
window.DashboardWallets = {
    loadWallets,
    renderChainToggles,
    toggleChain,
    saveWallet,
    resetWalletConnection,
    updateTestWalletDisplay,
    loadSettings
};

// Make functions globally available
window.loadWallets = loadWallets;
window.loadSettings = loadSettings;
window.toggleChain = toggleChain;
window.saveWallet = saveWallet;
