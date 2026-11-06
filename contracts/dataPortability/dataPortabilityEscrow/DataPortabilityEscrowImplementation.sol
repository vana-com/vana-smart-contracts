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
import "./interfaces/DataPortabilityEscrowStorageV2.sol";

/**
 * @title DataPortabilityEscrowImplementation
 * @notice Per-account escrow custody for native VANA and whitelisted ERC-20s.
 * @dev UUPS upgradeable. Deposits are open; only FACILITATOR_ROLE can move funds out.
 *
 *      Withdrawal/settlement do NOT re-check the token whitelist: once funds are
 *      credited, they remain movable even if the token is later de-whitelisted.
 *      The whitelist only gates incoming deposits.
 *
 *      Payee pinning: every settle path (`settle`, `settleBatch` and the three
 *      `*AndSettle` bundles) requires `to` to equal the `feeRegistry` payee for
 *      the op's `OpKind`. A compromised FACILITATOR_ROLE key can then only pay
 *      escrowed balances to the payees the admin set in the FeeRegistry, not
 *      to itself. `withdraw` is unaffected: it can only pay the account holder.
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
    DataPortabilityEscrowStorageV2
{
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    bytes32 public constant FACILITATOR_ROLE = keccak256("FACILITATOR_ROLE");

    // FeeRegistry operation keys, keccak256 of the names data-gateway reads
    // (lib/fee-registry.ts) and the mainnet registry was configured with.
    bytes32 private constant DATA_REGISTRATION_OP = keccak256("data_registration");
    bytes32 private constant SERVER_REGISTRATION_OP = keccak256("server_registration");
    bytes32 private constant BUILDER_REGISTRATION_OP = keccak256("builder_registration");
    bytes32 private constant GRANT_REGISTRATION_OP = keccak256("grant_registration");
    bytes32 private constant DATA_ACCESS_OP = keccak256("data_access");

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

    /// @dev 2: settlement payee pinned to the FeeRegistry payee per OpKind.
    function version() external pure virtual override returns (uint256) {
        return 2;
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

    function setFeeRegistry(address newFeeRegistry) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newFeeRegistry == address(0)) revert ZeroAddress();
        address previous = address(feeRegistry);
        feeRegistry = IFeeRegistry(newFeeRegistry);
        emit FeeRegistryUpdated(previous, newFeeRegistry);
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

    function feeOperation(OpKind opKind) public pure override returns (bytes32) {
        if (opKind == OpKind.DataRegistration) return DATA_REGISTRATION_OP;
        if (opKind == OpKind.ServerRegistration) return SERVER_REGISTRATION_OP;
        if (opKind == OpKind.BuilderRegistration) return BUILDER_REGISTRATION_OP;
        if (opKind == OpKind.GrantRegistration) return GRANT_REGISTRATION_OP;
        if (opKind == OpKind.DataAccess) return DATA_ACCESS_OP;
        return bytes32(0);
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
        IFeeRegistry registry = _feeRegistryOrRevert();
        _checkPayee(registry, opKind, to);
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
        _settleOps(ops);
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

    /// @dev Pay each op in order, checking its payee first. Shared by
    ///      `settleBatch` and the `*AndSettle` bundles so every path applies
    ///      the same check and emits the same `Settled` event shape.
    function _settleOps(SettleOp[] calldata ops) internal {
        uint256 len = ops.length;
        if (len == 0) return; // a bundle with no fee ops needs no registry
        IFeeRegistry registry = _feeRegistryOrRevert();
        for (uint256 i = 0; i < len; ) {
            SettleOp calldata op = ops[i];
            _checkPayee(registry, op.opKind, op.to);
            _payout(op.from, op.to, op.asset, op.amount);
            emit Settled(op.from, op.to, op.ref, op.asset, op.amount, op.opKind);
            unchecked {
                ++i;
            }
        }
    }

    function _feeRegistryOrRevert() internal view returns (IFeeRegistry registry) {
        registry = feeRegistry;
        if (address(registry) == address(0)) revert FeeRegistryNotSet();
    }

    /// @dev `to` must be the FeeRegistry payee of `opKind`'s fee operation.
    ///      `enabled` is deliberately not checked: data-gateway snapshots the
    ///      payee when a fee is paid and still settles that payment after the
    ///      fee is disabled. Changing a payee, or clearing a fee, does block
    ///      settlements already snapshotted with the old payee, so drain them
    ///      first. A zero payee (cleared or never set) matches nothing.
    function _checkPayee(IFeeRegistry registry, OpKind opKind, address to) internal view {
        bytes32 operation = feeOperation(opKind);
        address expected = operation == bytes32(0) ? address(0) : registry.fees(operation).payee;
        if (expected == address(0) || to != expected) revert UnexpectedPayee(opKind, to, expected);
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

        // Step 2: same payee-checked payouts as settleBatch, same event shape,
        // so indexers don't need a special case for bundled txs.
        _settleOps(ops);
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

        // Step 2: same payee-checked payouts as settleBatch, same event shape,
        // so indexers don't need a special case for bundled txs.
        _settleOps(ops);
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

        // Step 2: same payee-checked payouts as settleBatch, same event shape,
        // so indexers don't need a special case for bundled txs.
        _settleOps(ops);
    }

    // ====================== Fallback ======================

    /// @dev Reject blind native transfers — depositors must call `depositNative(account)`
    ///      so the funds are accounted to a specific recipient.
    receive() external payable {
        revert UnexpectedNativeValue();
    }
}
