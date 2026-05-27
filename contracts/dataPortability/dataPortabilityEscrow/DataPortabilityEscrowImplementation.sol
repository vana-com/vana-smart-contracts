// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../dataPortabilityPermissionsV2/interfaces/IDataPortabilityPermissionsV2.sol";
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

    bytes32 public constant FACILITATOR_ROLE = keccak256("FACILITATOR_ROLE");

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

    // ====================== Views ======================

    function balanceOf(address account, address asset) external view override returns (uint256) {
        return _balances[account][asset];
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

    // ====================== Facilitator: settle (pay external) ======================

    function settle(address from, address to, address asset, uint256 amount, bytes32 ref)
        external
        override
        whenNotPaused
        onlyRole(FACILITATOR_ROLE)
        nonReentrant
    {
        _payout(from, to, asset, amount);
        emit Settled(from, to, asset, amount, ref);
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
            emit Settled(op.from, op.to, op.asset, op.amount, op.ref);
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
            emit Settled(op.from, op.to, op.asset, op.amount, op.ref);
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
