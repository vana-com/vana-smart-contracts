// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../dataPortabilityPermissionsV2/interfaces/IDataPortabilityPermissionsV2.sol";
import "../../../data/dataRegistryV2/interfaces/IDataRegistryV2.sol";

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
    ///         to classify. Wire format is `uint8` — future additions should
    ///         append (never reorder) once any non-test usage exists.
    enum OpKind {
        Unspecified,         // 0 — default catch-all
        DataRegistration,    // 1 — fee for registering / adding data
        ServerRegistration,  // 2 — fee for registering a personal server
        BuilderRegistration, // 3 — fee for registering a builder / grantee
        GrantRegistration,   // 4 — fee for registering a grant (was named `Registration` previously)
        DataAccess           // 5 — per-access payment for data use
    }

    /// @notice Single settlement entry used by `settleBatch` / `registerAndSettle`.
    /// @param from   In-escrow account whose balance is debited
    /// @param to     External recipient of the funds
    /// @param asset  Asset to transfer; `address(0)` for native VANA
    /// @param amount Amount to transfer
    /// @param opKind Classification of the operation (off-chain hint).
    /// @param ref    Caller-asserted correlation id joining this settlement to
    ///               the protocol entity it pays for. NOT verified on-chain —
    ///               an indexing hint, not consensus data. Every value below is
    ///               content-addressed and precomputable before the tx.
    ///
    ///               Convention by `opKind`:
    ///                 Unspecified         — `bytes32(0)` or free-form
    ///                 DataRegistration    — dataPointId
    ///                                       = keccak256(abi.encode(owner, scope))
    ///                 ServerRegistration  — serverId
    ///                                       = keccak256(abi.encode(serversDomainSeparator,
    ///                                         serverAddress, publicKey, serverUrl))
    ///                 BuilderRegistration — granteeId (opaque bytes32 used in grants)
    ///                 GrantRegistration   — grantId
    ///                                       = keccak256(abi.encode(permissionsDomainSeparator,
    ///                                         grantorAddress, granteeId))
    ///                 DataAccess          — grantId under which the access was
    ///                                       authorized. (recordId is NOT the ref:
    ///                                       it is already joinable via the same-tx
    ///                                       `DataAccessRecorded` event; grantId is
    ///                                       the link that event lacks.)
    struct SettleOp {
        address from;
        address to;
        address asset;
        uint256 amount;
        OpKind opKind;
        bytes32 ref;
    }

    /// @notice One item of `recordAccessAndSettleBatch`: an access record and
    ///         the payment legs that pay for exactly that access.
    /// @param record The access record, as `DataRegistryV2.recordDataAccess`
    ///               takes it (owner, scope, version, accessor, recordId,
    ///               server signature).
    /// @param ops    Payouts executed only if `record` is committed; may be
    ///               empty.
    struct AccessBundle {
        IDataRegistryV2.AccessRecord record;
        SettleOp[] ops;
    }

    // ====================== Errors ======================

    error ZeroAmount();
    error ZeroAddress();
    error AssetNotSupported(address asset);
    error InsufficientBalance(address account, address asset, uint256 requested, uint256 available);
    error NativeTransferFailed();
    error UnexpectedNativeValue();
    error PermissionsNotSet();
    error DataRegistryNotSet();
    error OpNotAllowed(address target, bytes4 selector);
    error CallDataTooShort();
    error EmptyBatch();
    error BatchTooLarge(uint256 size, uint256 max);

    // ====================== Events ======================

    /// @notice Emitted when funds are credited to an account.
    /// @param from   Address that supplied the funds (depositor / msg.sender)
    /// @param account Address whose escrow balance increased
    /// @param asset  Asset address; `address(0)` for native VANA
    event Deposited(address indexed from, address indexed account, address indexed asset, uint256 amount);

    /// @notice Emitted when the facilitator settles a payment: debits `from`'s
    ///         in-escrow balance and transfers funds to external address `to`.
    /// @dev `ref` is indexed (instead of `asset`) so indexers can filter
    ///      settlements by grantId / dataPointId / serverId via log topics —
    ///      e.g. "all payments under grant X" is a single eth_getLogs query.
    ///      See the `SettleOp.ref` docs for the per-OpKind ref convention.
    /// @param opKind Classification of the operation (off-chain hint).
    /// @param ref    Caller-asserted correlation id (see SettleOp.ref).
    event Settled(
        address indexed from,
        address indexed to,
        bytes32 indexed ref,
        address asset,
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

    /// @notice Emitted when the admin updates the cross-referenced data-registry contract.
    event DataRegistryUpdated(address indexed previous, address indexed current);

    /// @notice Emitted when admin allows a `(target, selector)` pair to be invoked via `runOpAndSettle`.
    event OpAllowed(address indexed target, bytes4 indexed selector);

    /// @notice Emitted when admin removes a previously-allowed `(target, selector)` pair.
    event OpDisallowed(address indexed target, bytes4 indexed selector);

    /// @notice Emitted for each call dispatched through `runOpAndSettle`.
    event OpExecuted(address indexed target, bytes4 indexed selector, bytes returnData);

    /// @notice Emitted by `recordAccessAndSettleBatch` for each item whose
    ///         record was committed, immediately BEFORE that item's `Settled`
    ///         events. The `opCount` Settled events that follow belong to
    ///         `recordId`, so a receipt alone groups payment legs per read.
    ///         Not emitted for skipped items (the registry emits
    ///         `DataAccessSkipped` for those) and not emitted by the
    ///         single-record `recordAccessAndSettle`.
    /// @param index    Position of the item in the submitted batch.
    /// @param recordId The committed access record's id.
    /// @param opCount  Number of `Settled` events that follow for this item.
    event AccessSettled(uint256 indexed index, bytes32 indexed recordId, uint256 opCount);

    // ====================== Views ======================

    function version() external pure returns (uint256);

    function isWhitelistedToken(address token) external view returns (bool);

    function balanceOf(address account, address asset) external view returns (uint256);

    /// @notice Cross-referenced permissions contract used by `registerAndSettle`.
    ///         Settable post-deploy via `setPermissions` (admin-only).
    function permissions() external view returns (IDataPortabilityPermissionsV2);

    /// @notice Cross-referenced data-registry contract used by `recordAccessAndSettle`.
    ///         Settable post-deploy via `setDataRegistry` (admin-only).
    function dataRegistry() external view returns (IDataRegistryV2);

    /// @notice True iff the `(target, selector)` pair is allowed for `runOpAndSettle`.
    function isAllowedOp(address target, bytes4 selector) external view returns (bool);

    /// @notice Hard cap on `recordAccessAndSettleBatch` length. Never above
    ///         the registry's `MAX_ACCESS_BATCH`.
    function MAX_ACCESS_BATCH() external view returns (uint256);

    /// @notice Enumerate every target address that currently has at least one allowed selector.
    function getAllowedTargets() external view returns (address[] memory);

    /// @notice Enumerate the selectors currently allowed for a given target.
    function getAllowedSelectors(address target) external view returns (bytes4[] memory);

    // ====================== Admin ======================

    function setTokenWhitelisted(address token, bool whitelisted) external;

    /// @notice Set or update the permissions contract used by `registerAndSettle`.
    function setPermissions(address newPermissions) external;

    /// @notice Set or update the data-registry contract used by `recordAccessAndSettle`.
    function setDataRegistry(address newDataRegistry) external;

    /// @notice Allow or disallow a `(target, selector)` pair for `runOpAndSettle`.
    /// @dev When the last selector for a target is removed, the target is also removed
    ///      from `getAllowedTargets`. When the first selector for a fresh target is
    ///      added, the target is added.
    function setOpAllowed(address target, bytes4 selector, bool allowed) external;

    function pause() external;

    function unpause() external;

    // ====================== Deposits (permissionless) ======================

    /// @notice Deposit native VANA to credit `account`'s escrow balance.
    function depositNative(address account) external payable;

    /// @notice Deposit a whitelisted ERC-20 to credit `account`'s escrow balance.
    /// @dev Caller must have approved `amount` to this contract.
    function depositToken(address account, address token, uint256 amount) external;

    /// @notice Deposit a whitelisted EIP-3009 ERC-20 (e.g. USDC) using the token
    ///         owner's off-chain authorization — no prior `approve` tx needed —
    ///         crediting `account`'s escrow balance (which may differ from the
    ///         token owner `from`).
    ///
    ///         The beneficiary is tamper-proof despite not being a field of the
    ///         EIP-3009 payload: the authorization's nonce MUST be computed as
    ///
    ///           nonce = keccak256(abi.encode(account, salt))
    ///
    ///         The signer derives the nonce from the intended beneficiary when
    ///         signing; the escrow recomputes it from the caller-supplied
    ///         `account` and `salt`. A relayer that substitutes a different
    ///         `account` produces a different nonce, and the token's signature
    ///         check fails. Self-deposit is simply `account == from`.
    /// @dev Uses `receiveWithAuthorization` (not `transferWithAuthorization`):
    ///      the token enforces `msg.sender == to == this escrow`, so the
    ///      authorization cannot be front-run directly against the token to
    ///      strand funds. Replay protection is the token's own (from, nonce)
    ///      tracking; the token reverts on reuse, expiry, or bad signature.
    ///      Balance-diff accounting credits only what actually arrived.
    /// @param account     Escrow account to credit (committed via the nonce).
    /// @param from        Token owner who signed the EIP-3009 authorization.
    /// @param token       Whitelisted EIP-3009 token to deposit.
    /// @param value       Amount authorized for transfer.
    /// @param validAfter  Authorization not valid before this unix time.
    /// @param validBefore Authorization not valid at/after this unix time.
    /// @param salt        Signer-chosen entropy making the nonce unique per
    ///                    deposit; reuse with the same `account` collides in the
    ///                    token's (from, nonce) replay state and reverts.
    /// @param v           Signature v.
    /// @param r           Signature r.
    /// @param s           Signature s.
    function depositTokenWithAuthorization(
        address account,
        address from,
        address token,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    // ====================== Facilitator ops ======================

    /// @notice Debit `from`'s in-escrow balance and transfer the funds to external address `to`.
    /// @param ref Correlation id — see `SettleOp.ref` for the per-OpKind convention.
    function settle(
        address from,
        address to,
        address asset,
        uint256 amount,
        OpKind opKind,
        bytes32 ref
    ) external;

    /// @notice Batched variant of `settle`.
    function settleBatch(SettleOp[] calldata ops) external;

    /// @notice Debit `account`'s in-escrow balance and return the funds to `account` itself.
    function withdraw(address account, address asset, uint256 amount, bytes32 ref) external;

    /// @notice Atomically record a data access and execute associated payouts.
    ///         Both succeed or both revert.
    /// @dev Order: record first (via `dataRegistry.recordDataAccess`), then loop
    ///      the ops calling `_payout` + emitting `Settled`. The inner record
    ///      reverts on duplicate recordId, untrusted server, unknown version,
    ///      etc. — bundle-level idempotency falls out of EVM atomicity.
    /// @param ownerAddress    Data point owner whose counter is incremented.
    /// @param scope           Data point scope.
    /// @param version_        Version against which the access is recorded.
    /// @param accessor        Address that performed the access.
    /// @param recordId        Caller-chosen unique id; reverts if reused.
    /// @param serverSignature EIP-712 signature by a personal server trusted by `ownerAddress`.
    /// @param ops             Payouts to execute after a successful record; may be empty.
    function recordAccessAndSettle(
        address ownerAddress,
        string calldata scope,
        uint256 version_,
        address accessor,
        bytes32 recordId,
        bytes calldata serverSignature,
        SettleOp[] calldata ops
    ) external;

    /// @notice Record up to `MAX_ACCESS_BATCH` accesses and settle each one's
    ///         payment legs in a single transaction.
    ///
    ///         Failure semantics — skip-and-emit per item, all-or-nothing
    ///         within an item:
    ///           - The registry validates every record independently
    ///             (`DataRegistryV2.recordDataAccessBatch`). A record it
    ///             rejects (duplicate recordId, bad signature, untrusted
    ///             server, unknown version) is skipped: it emits
    ///             `DataAccessSkipped` on the registry, and NONE of its `ops`
    ///             are executed. Other items are unaffected.
    ///           - A record it commits emits `DataAccessRecorded` on the
    ///             registry, then `AccessSettled(index, recordId, opCount)`
    ///             here, then one `Settled` per op — the same events as
    ///             `recordAccessAndSettle` plus the `AccessSettled` marker.
    ///           - A payment leg that cannot execute (`ZeroAmount`,
    ///             `ZeroAddress`, `InsufficientBalance`, transfer failure)
    ///             reverts the WHOLE batch, exactly as it reverts the single
    ///             call: escrow balances only move through the facilitator,
    ///             so the facilitator can simulate this away before
    ///             broadcasting, whereas a record rejection can be raced by
    ///             the facilitator's own earlier transactions.
    ///         A receipt is therefore self-describing: per item exactly one
    ///         of `DataAccessRecorded` / `DataAccessSkipped`, and for
    ///         recorded items the `Settled` events between its
    ///         `AccessSettled` marker and the next marker are its legs.
    /// @dev    Reverts with `DataRegistryNotSet`, `EmptyBatch`,
    ///         `BatchTooLarge`, or the registry's batch-level errors
    ///         (`DataPortabilityServersNotSet`, `EnforcedPause`).
    /// @param  bundles  Items to process, in order.
    /// @return recorded `recorded[i]` is true iff `bundles[i].record` was
    ///                  committed (and its ops executed).
    function recordAccessAndSettleBatch(AccessBundle[] calldata bundles)
        external
        returns (bool[] memory recorded);

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

    /// @notice Atomically dispatch an admin-allowed call to an external contract and execute
    ///         associated payouts. Both succeed or both revert.
    /// @dev Authorization model:
    ///        - Caller must hold `FACILITATOR_ROLE` (gate against unsolicited bundles).
    ///        - The `(target, selector)` pair must be admin-allowlisted via `setOpAllowed`.
    ///        - The target contract is responsible for its own per-call authentication
    ///          (e.g. embedded EIP-712 signatures, replay protection / idempotency).
    ///        The escrow forwards `callData` verbatim with zero value attached. The
    ///        target's revert reason is bubbled up unmodified on failure, so callers
    ///        observe the target's typed error rather than a generic wrapper.
    /// @param target   Contract to invoke. Must be in `getAllowedTargets`.
    /// @param callData ABI-encoded call (selector + args). First 4 bytes are matched
    ///                 against the per-target allowlist.
    /// @param ops      Payouts to execute after the call succeeds; may be empty.
    /// @return returnData Raw return data from the target call. Callers that don't need
    ///                    it can ignore the value; on-chain consumers can decode it.
    function runOpAndSettle(
        address target,
        bytes calldata callData,
        SettleOp[] calldata ops
    ) external returns (bytes memory returnData);
}
