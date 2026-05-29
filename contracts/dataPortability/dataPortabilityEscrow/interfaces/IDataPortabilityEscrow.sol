// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../dataPortabilityPermissionsV2/interfaces/IDataPortabilityPermissionsV2.sol";

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
    /// @notice Categorizes a settlement op for off-chain indexing / accounting.
    ///         `Unspecified` (0) is the zero default for callers who don't care
    ///         to classify. Extend by appending values — never reorder.
    enum OpKind {
        Unspecified,
        Registration, // registration fee for a grant (used by `registerAndSettle`)
        DataAccess    // per-access payment for data use
    }

    /// @notice Single settlement entry used by `settleBatch` / `registerAndSettle`.
    /// @param from   In-escrow account whose balance is debited
    /// @param to     External recipient of the funds
    /// @param asset  Asset to transfer; `address(0)` for native VANA
    /// @param amount Amount to transfer
    /// @param opKind Classification of the operation (off-chain hint).
    struct SettleOp {
        address from;
        address to;
        address asset;
        uint256 amount;
        OpKind opKind;
    }

    // ====================== Errors ======================

    error ZeroAmount();
    error ZeroAddress();
    error AssetNotSupported(address asset);
    error InsufficientBalance(address account, address asset, uint256 requested, uint256 available);
    error NativeTransferFailed();
    error UnexpectedNativeValue();
    error PermissionsNotSet();

    // ====================== Events ======================

    /// @notice Emitted when funds are credited to an account.
    /// @param from   Address that supplied the funds (depositor / msg.sender)
    /// @param account Address whose escrow balance increased
    /// @param asset  Asset address; `address(0)` for native VANA
    event Deposited(address indexed from, address indexed account, address indexed asset, uint256 amount);

    /// @notice Emitted when the facilitator settles a payment: debits `from`'s
    ///         in-escrow balance and transfers funds to external address `to`.
    /// @param opKind Classification of the operation (off-chain hint).
    event Settled(
        address indexed from,
        address indexed to,
        address indexed asset,
        uint256 amount,
        OpKind opKind
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

    /// @notice Emitted when the admin updates the cross-referenced permissions contract.
    event PermissionsUpdated(address indexed previous, address indexed current);

    // ====================== Views ======================

    function version() external pure returns (uint256);

    function isWhitelistedToken(address token) external view returns (bool);

    function balanceOf(address account, address asset) external view returns (uint256);

    /// @notice Cross-referenced permissions contract used by `registerAndSettle`.
    ///         Settable post-deploy via `setPermissions` (admin-only).
    function permissions() external view returns (IDataPortabilityPermissionsV2);

    // ====================== Admin ======================

    function setTokenWhitelisted(address token, bool whitelisted) external;

    /// @notice Set or update the permissions contract used by `registerAndSettle`.
    function setPermissions(address newPermissions) external;

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
    function settle(address from, address to, address asset, uint256 amount, OpKind opKind) external;

    /// @notice Batched variant of `settle`.
    function settleBatch(SettleOp[] calldata ops) external;

    /// @notice Debit `account`'s in-escrow balance and return the funds to `account` itself.
    function withdraw(address account, address asset, uint256 amount, bytes32 ref) external;

    /// @notice Atomically register a permission and execute associated payouts.
    ///         Both succeed or both revert.
    /// @dev Order: register first (via `permissions.addPermissionWithSignature`),
    ///      then loop the ops calling `_payout` + emitting `Settled`. Reverts if
    ///      the permissions contract is not set, the signature is invalid, the
    ///      grantor mismatches, the grantVersion is stale, scopes are empty,
    ///      or any op's balance is insufficient.
    /// @param input the permission registration payload (matches the gateway's
    ///        GrantRegistration EIP-712 type)
    /// @param signature grantor's EIP-712 signature over `input`
    /// @param ops payouts to execute after a successful registration; may be empty
    /// @return grantId the deterministic grant id returned by the permissions contract
    function registerAndSettle(
        IDataPortabilityPermissionsV2.AddPermissionInput calldata input,
        bytes calldata signature,
        SettleOp[] calldata ops
    ) external returns (bytes32 grantId);
}
