// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title StablePaySplitter
 * @notice Payment splitter contract for StablePay - splits stablecoin payments between merchants and platform
 * @dev Supports variable fee tiers passed at transaction time (basis points)
 *
 * Fee Tiers (basis points):
 * - 50 = 0.50% (Starter: $0-10k volume)
 * - 40 = 0.40% (Growth: $10k-50k volume)
 * - 30 = 0.30% (Scale: $50k-250k volume)
 * - 20 = 0.20% (Volume: $250k+ volume)
 * - Custom rates for enterprise (1-50 basis points)
 */
contract StablePaySplitter is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    /// @notice Address where platform fees are collected
    address public feeRecipient;

    /// @notice Maximum fee allowed (5% = 500 basis points) - safety cap
    uint16 public constant MAX_FEE_BASIS_POINTS = 500;

    /// @notice Minimum fee allowed (0.1% = 10 basis points)
    uint16 public constant MIN_FEE_BASIS_POINTS = 10;

    /// @notice Mapping of whitelisted tokens (USDC, USDT, EURC addresses)
    mapping(address => bool) public allowedTokens;

    /// @notice Total fees collected per token (for analytics)
    mapping(address => uint256) public totalFeesCollected;

    /// @notice Total volume processed per token
    mapping(address => uint256) public totalVolumeProcessed;

    // ============ Events ============

    /// @notice Emitted when a payment is processed
    event PaymentProcessed(
        bytes32 indexed orderId,
        address indexed token,
        address indexed merchant,
        address payer,
        uint256 totalAmount,
        uint256 merchantAmount,
        uint256 feeAmount,
        uint16 feeBasisPoints
    );

    /// @notice Emitted when fee recipient is updated
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    /// @notice Emitted when a token is added/removed from whitelist
    event TokenWhitelistUpdated(address indexed token, bool allowed);

    /// @notice Emitted when fees are withdrawn (emergency)
    event EmergencyWithdraw(address indexed token, uint256 amount, address indexed to);

    // ============ Errors ============

    error InvalidFeeRecipient();
    error InvalidMerchant();
    error InvalidAmount();
    error InvalidFeeBasisPoints();
    error TokenNotAllowed();
    error InsufficientAllowance();
    error TransferFailed();

    // ============ Constructor ============

    /**
     * @notice Initialize the contract with fee recipient
     * @param _feeRecipient Address to receive platform fees
     * @param _initialTokens Array of initially allowed token addresses
     */
    constructor(address _feeRecipient, address[] memory _initialTokens) Ownable(msg.sender) {
        if (_feeRecipient == address(0)) revert InvalidFeeRecipient();

        feeRecipient = _feeRecipient;

        // Whitelist initial tokens
        for (uint256 i = 0; i < _initialTokens.length; i++) {
            if (_initialTokens[i] != address(0)) {
                allowedTokens[_initialTokens[i]] = true;
                emit TokenWhitelistUpdated(_initialTokens[i], true);
            }
        }
    }

    // ============ Core Functions ============

    /**
     * @notice Process a payment with automatic fee splitting
     * @param token ERC20 token address (USDC, USDT, EURC)
     * @param merchant Merchant's wallet address
     * @param amount Total payment amount (in token's smallest unit)
     * @param feeBasisPoints Fee percentage in basis points (50 = 0.5%)
     * @param orderId Unique order identifier for tracking
     *
     * @dev Caller must have approved this contract to spend `amount` of `token`
     * @dev Fee is calculated as: feeAmount = amount * feeBasisPoints / 10000
     */
    function processPayment(
        address token,
        address merchant,
        uint256 amount,
        uint16 feeBasisPoints,
        bytes32 orderId
    ) external nonReentrant whenNotPaused {
        // Validations
        if (!allowedTokens[token]) revert TokenNotAllowed();
        if (merchant == address(0)) revert InvalidMerchant();
        if (amount == 0) revert InvalidAmount();
        if (feeBasisPoints < MIN_FEE_BASIS_POINTS || feeBasisPoints > MAX_FEE_BASIS_POINTS) {
            revert InvalidFeeBasisPoints();
        }

        // Calculate fee split
        uint256 feeAmount = (amount * feeBasisPoints) / 10000;
        uint256 merchantAmount = amount - feeAmount;

        // Get token interface
        IERC20 tokenContract = IERC20(token);

        // Check allowance
        if (tokenContract.allowance(msg.sender, address(this)) < amount) {
            revert InsufficientAllowance();
        }

        // Transfer merchant's portion directly to merchant
        tokenContract.safeTransferFrom(msg.sender, merchant, merchantAmount);

        // Transfer fee portion to fee recipient
        tokenContract.safeTransferFrom(msg.sender, feeRecipient, feeAmount);

        // Update analytics
        totalFeesCollected[token] += feeAmount;
        totalVolumeProcessed[token] += amount;

        // Emit event for tracking
        emit PaymentProcessed(
            orderId,
            token,
            merchant,
            msg.sender,
            amount,
            merchantAmount,
            feeAmount,
            feeBasisPoints
        );
    }

    /**
     * @notice Process payment with permit (gasless approval) - EIP-2612
     * @dev For tokens that support permit (like USDC on some chains)
     */
    function processPaymentWithPermit(
        address token,
        address merchant,
        uint256 amount,
        uint16 feeBasisPoints,
        bytes32 orderId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        // Execute permit
        IERC20Permit(token).permit(msg.sender, address(this), amount, deadline, v, r, s);

        // Process payment (reuse logic)
        _processPaymentInternal(token, merchant, amount, feeBasisPoints, orderId);
    }

    /**
     * @notice Internal payment processing logic
     */
    function _processPaymentInternal(
        address token,
        address merchant,
        uint256 amount,
        uint16 feeBasisPoints,
        bytes32 orderId
    ) internal {
        if (!allowedTokens[token]) revert TokenNotAllowed();
        if (merchant == address(0)) revert InvalidMerchant();
        if (amount == 0) revert InvalidAmount();
        if (feeBasisPoints < MIN_FEE_BASIS_POINTS || feeBasisPoints > MAX_FEE_BASIS_POINTS) {
            revert InvalidFeeBasisPoints();
        }

        uint256 feeAmount = (amount * feeBasisPoints) / 10000;
        uint256 merchantAmount = amount - feeAmount;

        IERC20 tokenContract = IERC20(token);

        tokenContract.safeTransferFrom(msg.sender, merchant, merchantAmount);
        tokenContract.safeTransferFrom(msg.sender, feeRecipient, feeAmount);

        totalFeesCollected[token] += feeAmount;
        totalVolumeProcessed[token] += amount;

        emit PaymentProcessed(
            orderId,
            token,
            merchant,
            msg.sender,
            amount,
            merchantAmount,
            feeAmount,
            feeBasisPoints
        );
    }

    // ============ View Functions ============

    /**
     * @notice Calculate the fee and merchant amounts for a given payment
     * @param amount Total payment amount
     * @param feeBasisPoints Fee in basis points
     * @return merchantAmount Amount merchant receives
     * @return feeAmount Amount platform receives as fee
     */
    function calculateSplit(
        uint256 amount,
        uint16 feeBasisPoints
    ) external pure returns (uint256 merchantAmount, uint256 feeAmount) {
        feeAmount = (amount * feeBasisPoints) / 10000;
        merchantAmount = amount - feeAmount;
    }

    /**
     * @notice Check if a token is allowed for payments
     */
    function isTokenAllowed(address token) external view returns (bool) {
        return allowedTokens[token];
    }

    // ============ Admin Functions ============

    /**
     * @notice Update the fee recipient address
     * @param newFeeRecipient New address to receive fees
     */
    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        if (newFeeRecipient == address(0)) revert InvalidFeeRecipient();

        address oldRecipient = feeRecipient;
        feeRecipient = newFeeRecipient;

        emit FeeRecipientUpdated(oldRecipient, newFeeRecipient);
    }

    /**
     * @notice Add or remove a token from the whitelist
     * @param token Token address
     * @param allowed Whether the token is allowed
     */
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        allowedTokens[token] = allowed;
        emit TokenWhitelistUpdated(token, allowed);
    }

    /**
     * @notice Batch update token whitelist
     */
    function setTokensAllowed(address[] calldata tokens, bool allowed) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            allowedTokens[tokens[i]] = allowed;
            emit TokenWhitelistUpdated(tokens[i], allowed);
        }
    }

    /**
     * @notice Pause contract (emergency)
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency withdraw tokens (only if accidentally sent directly)
     * @dev This contract should never hold tokens under normal operation
     */
    function emergencyWithdraw(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
        emit EmergencyWithdraw(token, amount, to);
    }
}

/**
 * @dev Interface for EIP-2612 permit
 */
interface IERC20Permit {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
