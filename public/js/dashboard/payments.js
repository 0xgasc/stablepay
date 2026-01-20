// StablePay Dashboard - Payments Module
// Handles test payments, wallet connections, and payment execution

let connectedWallet = null;
let connectedChain = null;

// Open test payment modal
function openTestPayment() {
    const modal = document.getElementById('testPaymentModal');
    if (modal) {
        modal.classList.remove('hidden');
        resetTestPaymentModal();
    }
}

// Close test payment modal
function closeTestPayment() {
    const modal = document.getElementById('testPaymentModal');
    if (modal) modal.classList.add('hidden');
}

// Reset test payment modal to initial state
function resetTestPaymentModal() {
    connectedWallet = null;
    connectedChain = null;

    const amountInput = document.getElementById('testPaymentAmount');
    if (amountInput) amountInput.value = '1.00';

    const chainSelect = document.getElementById('testPaymentChain');
    if (chainSelect) chainSelect.value = '';

    const walletStatus = document.getElementById('walletConnectionStatus');
    if (walletStatus) walletStatus.classList.add('hidden');

    const payBtn = document.getElementById('executePaymentBtn');
    if (payBtn) {
        payBtn.disabled = true;
        payBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
}

// Initiate test payment
async function initiateTestPayment(amount, chainId, merchantWallet, token = 'USDC') {
    const getChainConfig = window.DashboardChains?.getChainConfig;
    const isSolanaChain = window.DashboardChains?.isSolanaChain;

    if (!getChainConfig) {
        alert('Chain configuration not loaded');
        return;
    }

    if (isSolanaChain && isSolanaChain(chainId)) {
        await initiateSolanaPayment(amount, chainId, merchantWallet, token);
    } else {
        await initiateEVMPayment(amount, chainId, merchantWallet, token);
    }
}

// Initiate EVM payment (MetaMask)
async function initiateEVMPayment(amount, chainId, merchantWallet, token = 'USDC') {
    try {
        const statusEl = document.getElementById('paymentStatus');
        if (statusEl) statusEl.textContent = 'Connecting to MetaMask...';

        // Check for MetaMask
        if (!window.ethereum) {
            alert('MetaMask not detected. Please install MetaMask.');
            return;
        }

        // Request account access
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const userAddress = accounts[0];

        if (statusEl) statusEl.textContent = 'Switching network...';

        // Get chain config
        const getChainConfig = window.DashboardChains?.getChainConfig;
        const config = getChainConfig ? getChainConfig(chainId, token) : {};

        // Switch to correct network
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: config.chainId }]
            });
        } catch (switchError) {
            // Network not added, try to add it
            if (switchError.code === 4902) {
                // Network needs to be added
                console.log('Network not found, user may need to add it manually');
            }
            throw switchError;
        }

        if (statusEl) statusEl.textContent = 'Preparing transaction...';

        // Create ethers provider and signer
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();

        // USDC contract interface (ERC-20)
        const usdcAbi = [
            'function transfer(address to, uint256 amount) returns (bool)',
            'function balanceOf(address account) view returns (uint256)',
            'function decimals() view returns (uint8)'
        ];

        const usdcContract = new ethers.Contract(config.tokenAddress, usdcAbi, signer);

        // Get decimals (USDC typically has 6)
        const decimals = await usdcContract.decimals();
        const amountInUnits = ethers.parseUnits(amount.toString(), decimals);

        // Check balance
        const balance = await usdcContract.balanceOf(userAddress);
        if (balance < amountInUnits) {
            alert(`Insufficient USDC balance. You have ${ethers.formatUnits(balance, decimals)} USDC.`);
            return;
        }

        if (statusEl) statusEl.textContent = 'Please confirm in MetaMask...';

        // Send transaction
        const tx = await usdcContract.transfer(merchantWallet, amountInUnits);

        if (statusEl) statusEl.textContent = 'Transaction submitted, waiting for confirmation...';

        // Wait for confirmation
        const receipt = await tx.wait();

        // Create order and confirm
        await createAndConfirmOrder(amount, chainId, merchantWallet, tx.hash, receipt.blockNumber);

        if (statusEl) statusEl.textContent = 'Payment successful!';

        // Show success
        showPaymentSuccess(tx.hash, chainId);

    } catch (error) {
        console.error('EVM payment error:', error);
        const statusEl = document.getElementById('paymentStatus');
        if (statusEl) statusEl.textContent = 'Payment failed: ' + error.message;
        alert('Payment failed: ' + error.message);
    }
}

// Initiate Solana payment (Phantom)
async function initiateSolanaPayment(amount, chainId, merchantWallet, token = 'USDC') {
    try {
        const statusEl = document.getElementById('paymentStatus');
        if (statusEl) statusEl.textContent = 'Connecting to Phantom...';

        // Check for Phantom
        const phantom = window.phantom?.solana || window.solana;
        if (!phantom) {
            alert('Phantom wallet not detected. Please install Phantom.');
            return;
        }

        // Connect to Phantom
        const response = await phantom.connect();
        const userPublicKey = response.publicKey;

        if (statusEl) statusEl.textContent = 'Preparing transaction...';

        // Get chain config
        const getChainConfig = window.DashboardChains?.getChainConfig;
        const config = getChainConfig ? getChainConfig(chainId, token) : {};

        // Create connection
        const connection = new solanaWeb3.Connection(config.rpcUrl, 'confirmed');

        // USDC mint
        const usdcMint = new solanaWeb3.PublicKey(config.tokenAddress);
        const recipientPubkey = new solanaWeb3.PublicKey(merchantWallet);

        // Get associated token accounts
        const senderATA = await window.splToken.getAssociatedTokenAddress(usdcMint, userPublicKey);
        const recipientATA = await window.splToken.getAssociatedTokenAddress(usdcMint, recipientPubkey);

        // USDC has 6 decimals
        const amountInLamports = Math.floor(parseFloat(amount) * 1_000_000);

        // Create transaction
        const transaction = new solanaWeb3.Transaction();

        // Check if recipient ATA exists, create if not
        const recipientATAInfo = await connection.getAccountInfo(recipientATA);
        if (!recipientATAInfo) {
            transaction.add(
                window.splToken.createAssociatedTokenAccountInstruction(
                    userPublicKey,
                    recipientATA,
                    recipientPubkey,
                    usdcMint
                )
            );
        }

        // Add transfer instruction
        transaction.add(
            window.splToken.createTransferInstruction(
                senderATA,
                recipientATA,
                userPublicKey,
                amountInLamports
            )
        );

        // Get recent blockhash
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = userPublicKey;

        if (statusEl) statusEl.textContent = 'Please approve in Phantom...';

        // Sign and send
        const signedTx = await phantom.signTransaction(transaction);
        const signature = await connection.sendRawTransaction(signedTx.serialize());

        if (statusEl) statusEl.textContent = 'Transaction submitted, waiting for confirmation...';

        // Wait for confirmation
        await connection.confirmTransaction(signature, 'confirmed');

        // Create order and confirm
        await createAndConfirmOrder(amount, chainId, merchantWallet, signature);

        if (statusEl) statusEl.textContent = 'Payment successful!';

        // Show success
        showPaymentSuccess(signature, chainId);

    } catch (error) {
        console.error('Solana payment error:', error);
        const statusEl = document.getElementById('paymentStatus');
        if (statusEl) statusEl.textContent = 'Payment failed: ' + error.message;
        alert('Payment failed: ' + error.message);
    }
}

// Create order and confirm payment
async function createAndConfirmOrder(amount, chainId, merchantWallet, txHash, blockNumber) {
    const merchantId = sessionStorage.getItem('merchantId');
    const merchantToken = sessionStorage.getItem('merchantToken');

    // Create order
    const createResponse = await fetch('/api/v1/orders', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${merchantToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            merchantId,
            amount: parseFloat(amount),
            chain: chainId,
            paymentAddress: merchantWallet,
            productName: 'Test Payment'
        })
    });

    if (!createResponse.ok) {
        throw new Error('Failed to create order');
    }

    const orderData = await createResponse.json();
    const orderId = orderData.order?.id;

    // Confirm order with tx hash
    const confirmResponse = await fetch(`/api/v1/orders/${orderId}/confirm`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${merchantToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            txHash,
            blockNumber: blockNumber || 0
        })
    });

    if (!confirmResponse.ok) {
        console.error('Failed to confirm order, but payment was successful');
    }

    return orderId;
}

// Show payment success
function showPaymentSuccess(txHash, chainId) {
    const getExplorerLink = window.DashboardChains?.getExplorerLink;
    const explorerUrl = getExplorerLink ? getExplorerLink(chainId, txHash) : '#';

    const successSection = document.getElementById('paymentSuccess');
    const txLink = document.getElementById('paymentTxLink');

    if (successSection) successSection.classList.remove('hidden');
    if (txLink) {
        txLink.href = explorerUrl;
        txLink.textContent = `${txHash.substring(0, 20)}...`;
    }

    // Reload orders after a delay
    setTimeout(() => {
        if (typeof loadOrders === 'function') {
            loadOrders();
        }
    }, 2000);
}

// Connect MetaMask
async function connectMetaMask() {
    try {
        if (!window.ethereum) {
            alert('MetaMask not detected. Please install MetaMask.');
            return null;
        }

        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        connectedWallet = accounts[0];
        return connectedWallet;
    } catch (error) {
        console.error('MetaMask connection error:', error);
        return null;
    }
}

// Connect Phantom
async function connectPhantom() {
    try {
        const phantom = window.phantom?.solana || window.solana;
        if (!phantom) {
            alert('Phantom wallet not detected. Please install Phantom.');
            return null;
        }

        const response = await phantom.connect();
        connectedWallet = response.publicKey.toString();
        return connectedWallet;
    } catch (error) {
        console.error('Phantom connection error:', error);
        return null;
    }
}

// Fee Balance Management
let currentFeeData = null;

// Check fee balance for alert badge
async function checkFeeBalance() {
    try {
        const merchantId = sessionStorage.getItem('merchantId');
        const merchantToken = sessionStorage.getItem('merchantToken');
        if (!merchantId || !merchantToken) return;

        const response = await fetch(`/api/fees/balance?merchantId=${merchantId}`, {
            headers: { 'Authorization': `Bearer ${merchantToken}` }
        });

        if (response.ok) {
            const data = await response.json();
            const badge = document.getElementById('feesAlertBadge');
            if (badge) {
                if (data.totalOwed > 0) {
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            }
        }
    } catch (error) {
        console.error('Error checking fee balance:', error);
    }
}

// Load fee balance details
async function loadFeeBalance() {
    try {
        const merchantId = sessionStorage.getItem('merchantId');
        const merchantToken = sessionStorage.getItem('merchantToken');

        if (!merchantId || !merchantToken) {
            console.error('No merchant authentication for fee balance');
            return;
        }

        const response = await fetch(`/api/fees/balance?merchantId=${merchantId}`, {
            headers: { 'Authorization': `Bearer ${merchantToken}` }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch fee balance');
        }

        currentFeeData = await response.json();

        // Update UI elements
        const previousBalance = document.getElementById('previousFeeBalance');
        const currentFees = document.getElementById('currentPeriodFees');
        const totalOwed = document.getElementById('totalFeesOwed');

        if (previousBalance) previousBalance.textContent = `$${currentFeeData.previousBalance.toFixed(2)}`;
        if (currentFees) currentFees.textContent = `$${currentFeeData.currentFees.toFixed(2)}`;
        if (totalOwed) totalOwed.textContent = `$${currentFeeData.totalOwed.toFixed(2)}`;

        // Update period info
        if (currentFeeData.currentPeriod) {
            const periodStart = document.getElementById('periodStart');
            const periodTransactions = document.getElementById('periodTransactions');
            const periodVolume = document.getElementById('periodVolume');
            const feeRate = document.getElementById('feeRate');

            if (periodStart) periodStart.textContent = new Date(currentFeeData.currentPeriod.start).toLocaleDateString();
            if (periodTransactions) periodTransactions.textContent = currentFeeData.currentPeriod.transactions;
            if (periodVolume) periodVolume.textContent = `$${currentFeeData.currentPeriod.volume.toFixed(2)}`;
            if (feeRate) feeRate.textContent = `${currentFeeData.currentPeriod.feePercent}%`;
        }

        // Show/hide pay section
        const noFeesMessage = document.getElementById('noFeesMessage');
        const payFeesSection = document.getElementById('payFeesSection');

        if (currentFeeData.totalOwed > 0) {
            if (noFeesMessage) noFeesMessage.classList.add('hidden');
            if (payFeesSection) payFeesSection.classList.remove('hidden');
        } else {
            if (noFeesMessage) noFeesMessage.classList.remove('hidden');
            if (payFeesSection) payFeesSection.classList.add('hidden');
        }

    } catch (error) {
        console.error('Error loading fee balance:', error);
    }
}

// Export for use in other modules
window.DashboardPayments = {
    openTestPayment,
    closeTestPayment,
    resetTestPaymentModal,
    initiateTestPayment,
    initiateEVMPayment,
    initiateSolanaPayment,
    createAndConfirmOrder,
    showPaymentSuccess,
    connectMetaMask,
    connectPhantom,
    checkFeeBalance,
    loadFeeBalance
};

// Make functions globally available
window.openTestPayment = openTestPayment;
window.closeTestPayment = closeTestPayment;
window.initiateTestPayment = initiateTestPayment;
window.checkFeeBalance = checkFeeBalance;
window.loadFeeBalance = loadFeeBalance;
