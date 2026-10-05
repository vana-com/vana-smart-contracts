// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../dataPortabilityPermissionsV2/interfaces/IDataPortabilityPermissionsV2.sol";
import "../../data/dataRegistryV2/interfaces/IDataRegistryV2.sol";
import "./interfaces/IERC3009.sol";
import "./interfaces/DataPortabilityEscrowStorageV1.sol";

/**
 * @title DataPortabilityEscrowImplementation
 * @notice Per-account escrow custody for native VANA and whitelisted ERC-20s.
 * @dev UUPS upgradeable. Deposits are open; only FACILITATOR_ROLE can move funds out.
 *
 *      Withdrawal/settlement do NOT re-check the token whitelist: once funds are
 *      credited, they remain movable even if the token is later de-whitelisted.
 *      The whitelist only gates incoming deposits.
 *
 *      Reentrancy model:
 *      - Every state-mutating external entry point is `nonReentrant`. The guard
 *        is a single shared lock, so callbacks during native sends, ERC-20 hooks
 *        (e.g. ERC-777), or facilitator-controlled receivers cannot re-enter any
 *        balance-touching function on this contract.
 *      - `withdraw` follows checks-effects-interactions: the sender's balance
 *        is debited before the external send, so even without the guard a
 *        recursive call would observe the post-debit state.
 *      - `receive()` reverts; the contract never accepts bare native transfers.
 */
contract DataPortabilityEscrowImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    DataPortabilityEscrowStorageV1
{
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    bytes32 public constant FACILITATOR_ROLE = keccak256("FACILITATOR_ROLE");

    /// @inheritdoc IDataPortabilityEscrow
    uint256 public constant override MAX_ACCESS_BATCH = 200;

    /// @inheritdoc IDataPortabilityEscrow
    /// @dev A data access pays one fee leg today; 8 leaves room for a split
    ///      (owner / protocol / referrer) without making the batch unbounded.
    uint256 public constant override MAX_ACCESS_BUNDLE_OPS = 8;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address ownerAddress, address facilitatorAddress) external initializer {
        if (ownerAddress == address(0) || facilitatorAddress == address(0)) revert ZeroAddress();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(FACILITATOR_ROLE, facilitatorAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    // ====================== Admin ======================

    function pause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setTokenWhitelisted(address token, bool whitelisted)
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        // address(0) is reserved for native VANA — never on the whitelist.
        if (token == address(0)) revert ZeroAddress();
        isWhitelistedToken[token] = whitelisted;
        emit TokenWhitelistUpdated(token, whitelisted);
    }

    function setPermissions(address newPermissions) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newPermissions == address(0)) revert ZeroAddress();
        address previous = address(permissions);
        permissions = IDataPortabilityPermissionsV2(newPermissions);
        emit PermissionsUpdated(previous, newPermissions);
    }

    function setDataRegistry(address newDataRegistry) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newDataRegistry == address(0)) revert ZeroAddress();
        address previous = address(dataRegistry);
        dataRegistry = IDataRegistryV2(newDataRegistry);
        emit DataRegistryUpdated(previous, newDataRegistry);
    }

    /// @inheritdoc IDataPortabilityEscrow
    /// @dev Maintains both `_allowedSelectorsByTarget[target]` (the actual gate)
    ///      and `_allowedTargets` (the enumerable target list). The target is
    ///      auto-added when its first selector is allowed and auto-removed when
    ///      its last selector is disallowed — admins never manage the target
    ///      set directly.
    ///
    ///      Idempotent: setting an already-correct flag is a no-op (no event)
    ///      so off-chain indexers don't see spurious enable/disable churn.
    function setOpAllowed(address target, bytes4 selector, bool allowed)
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (target == address(0)) revert ZeroAddress();

        EnumerableSet.Bytes32Set storage selectors = _allowedSelectorsByTarget[target];
        bytes32 selectorKey = bytes32(selector);

        if (allowed) {
            if (!selectors.add(selectorKey)) return; // already allowed — idempotent
            // First selector for this target → also register it in the target set.
            _allowedTargets.add(target);
            emit OpAllowed(target, selector);
        } else {
            if (!selectors.remove(selectorKey)) return; // wasn't allowed — idempotent
            // Last selector for this target → drop it from the target set too.
            if (selectors.length() == 0) {
                _allowedTargets.remove(target);
            }
            emit OpDisallowed(target, selector);
        }
    }

    // ====================== Views ======================

    function balanceOf(address account, address asset) external view override returns (uint256) {
        return _balances[account][asset];
    }

    function isAllowedOp(address target, bytes4 selector) external view override returns (bool) {
        return _allowedSelectorsByTarget[target].contains(bytes32(selector));
    }

    function getAllowedTargets() external view override returns (address[] memory) {
        return _allowedTargets.values();
    }

    function getAllowedSelectors(address target) external view override returns (bytes4[] memory out) {
        bytes32[] memory raw = _allowedSelectorsByTarget[target].values();
        uint256 len = raw.length;
        out = new bytes4[](len);
        for (uint256 i = 0; i < len; ) {
            out[i] = bytes4(raw[i]);
            unchecked { ++i; }
        }
    }

    // ====================== Deposits ======================

    function depositNative(address account) external payable override whenNotPaused nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        if (account == address(0)) revert ZeroAddress();

        _balances[account][address(0)] += msg.value;
        emit Deposited(msg.sender, account, address(0), msg.value);
    }

    function depositToken(address account, address token, uint256 amount)
        external
        override
        whenNotPaused
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (account == address(0)) revert ZeroAddress();
        if (!isWhitelistedToken[token]) revert AssetNotSupported(token);

        // Credit only what was actually received, in case `token` deducts a fee
        // on transfer or otherwise diverges from the amount parameter.
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert ZeroAmount();

        _balances[account][token] += received;

        emit Deposited(msg.sender, account, token, received);
    }

    /// @inheritdoc IDataPortabilityEscrow
    /// @dev The nonce passed to the token is recomputed here from (account,
    ///      salt) rather than taken as a parameter. This is what makes the
    ///      beneficiary tamper-proof: the signer committed to the nonce inside
    ///      the EIP-3009 signature, so any relayer-substituted `account` yields
    ///      a nonce the signature doesn't cover and the token reverts.
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
    ) external override whenNotPaused nonReentrant {
        if (value == 0) revert ZeroAmount();
        if (account == address(0) || from == address(0)) revert ZeroAddress();
        if (!isWhitelistedToken[token]) revert AssetNotSupported(token);

        // Beneficiary commitment: the signer derived this exact nonce from the
        // intended `account` when signing the authorization.
        bytes32 nonce = keccak256(abi.encode(account, salt));

        // The token verifies the EIP-712 signature, the (from, nonce) replay
        // state, the validity window, AND that msg.sender == to. Any failure
        // reverts inside the token with its own error.
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC3009(token).receiveWithAuthorization(
            from,
            address(this),
            value,
            validAfter,
            validBefore,
            nonce,
            v,
            r,
            s
        );
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert ZeroAmount();

        _balances[account][token] += received;

        emit Deposited(from, account, token, received);
    }

    // ====================== Facilitator: settle (pay external) ======================

    function settle(address from, address to, address asset, uint256 amount, OpKind opKind, bytes32 ref)
        external
        override
        whenNotPaused
        onlyRole(FACILITATOR_ROLE)
        nonReentrant
    {
        _payout(from, to, asset, amount);
        emit Settled(from, to, ref, asset, amount, opKind);
    }

    function settleBatch(SettleOp[] calldata ops)
        external
        override
        whenNotPaused
        onlyRole(FACILITATOR_ROLE)
        nonReentrant
    {
        uint256 len = ops.length;
        for (uint256 i = 0; i < len; ) {
            SettleOp calldata op = ops[i];
            _payout(op.from, op.to, op.asset, op.amount);
            emit Settled(op.from, op.to, op.ref, op.asset, op.amount, op.opKind);
            unchecked {
                ++i;
            }
        }
    }

    // ====================== Facilitator: withdraw (refund to account holder) ======================

    function withdraw(address account, address asset, uint256 amount, bytes32 ref)
        external
        override
        whenNotPaused
        onlyRole(FACILITATOR_ROLE)
        nonReentrant
    {
        _payout(account, account, asset, amount);
        emit Withdrawn(account, asset, amount, ref);
    }

    /// @dev Debit `from`'s in-escrow balance and send the funds to external address `to`.
    ///      Checks-effects-interactions: the balance is updated before the external send.
    function _payout(address from, address to, address asset, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        if (from == address(0) || to == address(0)) revert ZeroAddress();

        uint256 fromBal = _balances[from][asset];
        if (fromBal < amount) revert InsufficientBalance(from, asset, amount, fromBal);

        unchecked {
            _balances[from][asset] = fromBal - amount;
        }

        if (asset == address(0)) {
            (bool ok, ) = payable(to).call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }

    // ====================== Facilitator: register + settle (atomic) ======================

    /// @inheritdoc IDataPortabilityEscrow
    /// @dev Register first, then run the payouts. Any sub-failure reverts the
    ///      whole tx — so a partial state (grant on-chain but fee unpaid, or
    ///      vice versa) is impossible. Both PermissionSet (from the permissions
    ///      contract) and one Settled per op (from this contract) are emitted
    ///      identically to the underlying primitives — no wrapper event.
    function registerAndSettle(
        IDataPortabilityPermissionsV2.AddPermissionInput calldata input,
        bytes calldata signature,
        SettleOp[] calldata ops
    )
        external
        override
        onlyRole(FACILITATOR_ROLE)
        whenNotPaused
        nonReentrant
        returns (bytes32 grantId)
    {
        if (address(permissions) == address(0)) revert PermissionsNotSet();

        // Step 1: register on the permissions contract. Reverts on any of:
        // InvalidSignature, GrantorMismatch, InvalidGrantVersion, EmptyScopes,
        // ZeroAddress, ZeroGranteeId — all from addPermissionWithSignature.
        grantId = permissions.addPermissionWithSignature(input, signature);

        // Step 2: identical loop to settleBatch — preserves event shape so
        // indexers don't need a special case for bundled txs.
        uint256 len = ops.length;
        for (uint256 i = 0; i < len; ) {
            SettleOp calldata op = ops[i];
            _payout(op.from, op.to, op.asset, op.amount);
            emit Settled(op.from, op.to, op.ref, op.asset, op.amount, op.opKind);
            unchecked {
                ++i;
            }
        }
    }

    // ====================== Facilitator: record access + settle (atomic) ======================

    /// @inheritdoc IDataPortabilityEscrow
    /// @dev Same pattern as `registerAndSettle`. Bundle-level idempotency comes
    ///      for free from the EVM: `dataRegistry.recordDataAccess` reverts on
    ///      duplicate recordId (or untrusted server, unknown version, etc.),
    ///      which rolls back the entire bundle including the settle loop.
    function recordAccessAndSettle(
        address ownerAddress,
        string calldata scope,
        uint256 version_,
        address accessor,
        bytes32 recordId,
        bytes calldata serverSignature,
        SettleOp[] calldata ops
    )
        external
        override
        onlyRole(FACILITATOR_ROLE)
        whenNotPaused
        nonReentrant
    {
        if (address(dataRegistry) == address(0)) revert DataRegistryNotSet();

        // Step 1: record the access. Reverts on RecordIdAlreadyUsed,
        // UntrustedServer, UnknownVersion, InvalidSignature,
        // DataPortabilityServersNotSet — all from DataRegistryV2.
        dataRegistry.recordDataAccess(ownerAddress, scope, version_, accessor, recordId, serverSignature);

        // Step 2: identical loop to settleBatch — same event shape so indexers
        // don't need a special case for bundled txs.
        uint256 len = ops.length;
        for (uint256 i = 0; i < len; ) {
            SettleOp calldata op = ops[i];
            _payout(op.from, op.to, op.asset, op.amount);
            emit Settled(op.from, op.to, op.ref, op.asset, op.amount, op.opKind);
            unchecked {
                ++i;
            }
        }
    }

    // ====================== Facilitator: batch record access + settle ======================

    /// @inheritdoc IDataPortabilityEscrow
    /// @dev One registry call for the whole batch, then the settle loop per
    ///      recorded item. The registry's `recordDataAccessBatch` never
    ///      reverts on a single bad record (it returns `recorded[i] = false`
    ///      and emits `DataAccessSkipped`), so a skipped item simply has no
    ///      legs executed. `_payout` is unchanged, so a leg failure reverts
    ///      the entire batch as it does in `recordAccessAndSettle`.
    ///
    ///      Records are copied calldata → memory because the registry takes
    ///      one array and the bundle shape interleaves records with ops.
    function recordAccessAndSettleBatch(AccessBundle[] calldata bundles)
        external
        override
        onlyRole(FACILITATOR_ROLE)
        whenNotPaused
        nonReentrant
        returns (bool[] memory recorded)
    {
        if (address(dataRegistry) == address(0)) revert DataRegistryNotSet();
        uint256 len = bundles.length;
        if (len == 0) revert EmptyBatch();
        if (len > MAX_ACCESS_BATCH) revert BatchTooLarge(len, MAX_ACCESS_BATCH);

        IDataRegistryV2.AccessRecord[] memory records = new IDataRegistryV2.AccessRecord[](len);
        for (uint256 i = 0; i < len; ) {
            uint256 opsLen = bundles[i].ops.length;
            if (opsLen > MAX_ACCESS_BUNDLE_OPS) revert TooManyOps(i, opsLen, MAX_ACCESS_BUNDLE_OPS);
            records[i] = bundles[i].record;
            unchecked {
                ++i;
            }
        }

        // Step 1: record every access the registry accepts. Reverts only on
        // batch-level preconditions (servers unset, paused, role) — per-item
        // failures come back as `recorded[i] == false`.
        recorded = dataRegistry.recordDataAccessBatch(records);

        // Step 2: settle the legs of every recorded item, in batch order.
        // Same `_payout` + `Settled` shape as every other bundle here, with
        // an `AccessSettled` marker in front so the receipt groups legs per
        // read without the calldata. Token / recipient logs interleave with
        // `Settled`; the grouping rule is "this contract's `Settled` events
        // after the marker", see IDataPortabilityEscrow.AccessSettled.
        for (uint256 i = 0; i < len; ) {
            if (recorded[i]) {
                SettleOp[] calldata ops = bundles[i].ops;
                uint256 opsLen = ops.length;
                emit AccessSettled(i, bundles[i].record.recordId, opsLen);
                for (uint256 j = 0; j < opsLen; ) {
                    SettleOp calldata op = ops[j];
                    _payout(op.from, op.to, op.asset, op.amount);
                    emit Settled(op.from, op.to, op.ref, op.asset, op.amount, op.opKind);
                    unchecked {
                        ++j;
                    }
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    // ====================== Facilitator: generalized op + settle (atomic) ======================

    /// @inheritdoc IDataPortabilityEscrow
    /// @dev Generalized companion to `registerAndSettle` / `recordAccessAndSettle`.
    ///      The contract is intentionally NOT a router for arbitrary external
    ///      calls — every reachable `(target, selector)` pair must be admin-
    ///      allowlisted via `setOpAllowed`. The facilitator role only gates
    ///      *who* may submit; the *what* is gated by the allowlist.
    ///
    ///      Call semantics:
    ///        - Value forwarded: 0. The escrow never pays the target from its
    ///          own balance; any user-facing payment goes through `ops` and
    ///          `_payout`, which debit the named account.
    ///        - Revert bubbling: if the target reverts, its return data is
    ///          re-raised verbatim so callers observe the target's typed error
    ///          (e.g. `RecordIdAlreadyUsed`) rather than a generic wrapper.
    ///        - Idempotency: delegated to the target. Reusing a request that
    ///          the target rejects (e.g. duplicate `recordId`) reverts the
    ///          whole bundle including the settle loop.
    function runOpAndSettle(
        address target,
        bytes calldata callData,
        SettleOp[] calldata ops
    )
        external
        override
        onlyRole(FACILITATOR_ROLE)
        whenNotPaused
        nonReentrant
        returns (bytes memory returnData)
    {
        if (callData.length < 4) revert CallDataTooShort();
        bytes4 selector = bytes4(callData[:4]);
        if (!_allowedSelectorsByTarget[target].contains(bytes32(selector))) {
            revert OpNotAllowed(target, selector);
        }

        // Step 1: dispatch the call with zero value. Bubble the target's revert
        // data on failure so typed errors survive the wrapper.
        bool ok;
        (ok, returnData) = target.call(callData);
        if (!ok) {
            assembly {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        emit OpExecuted(target, selector, returnData);

        // Step 2: identical loop to settleBatch — preserves event shape so
        // indexers don't need a special case for bundled txs.
        uint256 len = ops.length;
        for (uint256 i = 0; i < len; ) {
            SettleOp calldata op = ops[i];
            _payout(op.from, op.to, op.asset, op.amount);
            emit Settled(op.from, op.to, op.ref, op.asset, op.amount, op.opKind);
            unchecked {
                ++i;
            }
        }
    }

    // ====================== Fallback ======================

    /// @dev Reject blind native transfers — depositors must call `depositNative(account)`
    ///      so the funds are accounted to a specific recipient.
    receive() external payable {
        revert UnexpectedNativeValue();
    }
}
