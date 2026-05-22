// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IDataPortabilityEscrow
 * @author Vana Network
 * @notice Per-account custodial escrow supporting native VANA and whitelisted ERC-20s.
 *
 * Roles:
 * - DEFAULT_ADMIN_ROLE: manages token whitelist, grants roles, upgrades the proxy
 * - FACILITATOR_ROLE: settles balances between accounts and withdraws to external addresses
 *
 * Conventions:
 * - The native asset (VANA) is represented by `address(0)`.
 * - Deposits are permissionless: any caller may credit any account.
 * - Settlement and withdrawal are restricted to FACILITATOR_ROLE and both
 *   transfer funds OUT of the contract:
 *     - `settle`   pays an arbitrary external `to` from `from`'s in-escrow balance
 *     - `withdraw` returns funds to the account holder (recipient == account)
 *
 * @custom:security-contact security@vana.org
 */
interface IDataPortabilityEscrow {
    /// @notice Single settlement entry used by `settleBatch`.
    /// @param from   In-escrow account whose balance is debited
    /// @param to     External recipient of the funds
    /// @param asset  Asset to transfer; `address(0)` for native VANA
    /// @param amount Amount to transfer
    /// @param ref    Caller-supplied tag (paymentId / invoice hash). May be zero.
    struct SettleOp {
        address from;
        address to;
        address asset;
        uint256 amount;
        bytes32 ref;
    }

    // ====================== Errors ======================

    error ZeroAmount();
    error ZeroAddress();
    error AssetNotSupported(address asset);
    error InsufficientBalance(address account, address asset, uint256 requested, uint256 available);
    error NativeTransferFailed();
    error UnexpectedNativeValue();

    // ====================== Events ======================

    /// @notice Emitted when funds are credited to an account.
    /// @param from   Address that supplied the funds (depositor / msg.sender)
    /// @param account Address whose escrow balance increased
    /// @param asset  Asset address; `address(0)` for native VANA
    event Deposited(address indexed from, address indexed account, address indexed asset, uint256 amount);

    /// @notice Emitted when the facilitator settles a payment: debits `from`'s
    ///         in-escrow balance and transfers funds to external address `to`.
    /// @param ref Caller-supplied tag (e.g. paymentId / invoice hash). May be zero.
    event Settled(
        address indexed from,
        address indexed to,
        address indexed asset,
        uint256 amount,
        bytes32 ref
    );

    /// @notice Emitted when the facilitator returns funds to the account holder:
    ///         debits `account`'s in-escrow balance and transfers funds to `account`.
    event Withdrawn(
        address indexed account,
        address indexed asset,
        uint256 amount,
        bytes32 ref
    );

    /// @notice Emitted when the admin updates the ERC-20 whitelist.
    event TokenWhitelistUpdated(address indexed token, bool whitelisted);

    // ====================== Views ======================

    function version() external pure returns (uint256);

    function isWhitelistedToken(address token) external view returns (bool);

    function balanceOf(address account, address asset) external view returns (uint256);

    // ====================== Admin ======================

    function setTokenWhitelisted(address token, bool whitelisted) external;

    function pause() external;

    function unpause() external;

    // ====================== Deposits (permissionless) ======================

    /// @notice Deposit native VANA to credit `account`'s escrow balance.
    function depositNative(address account) external payable;

    /// @notice Deposit a whitelisted ERC-20 to credit `account`'s escrow balance.
    /// @dev Caller must have approved `amount` to this contract.
    function depositToken(address account, address token, uint256 amount) external;

    // ====================== Facilitator ops ======================

    /// @notice Debit `from`'s in-escrow balance and transfer the funds to external address `to`.
    function settle(address from, address to, address asset, uint256 amount, bytes32 ref) external;

    /// @notice Batched variant of `settle`.
    function settleBatch(SettleOp[] calldata ops) external;

    /// @notice Debit `account`'s in-escrow balance and return the funds to `account` itself.
    function withdraw(address account, address asset, uint256 amount, bytes32 ref) external;
}
