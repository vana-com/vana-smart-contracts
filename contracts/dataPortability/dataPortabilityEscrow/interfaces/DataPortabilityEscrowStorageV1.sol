// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./IDataPortabilityEscrow.sol";

/**
 * @title Storage for DataPortabilityEscrow
 * @notice For future upgrades, do not change DataPortabilityEscrowStorageV1. Create a new
 * contract which implements DataPortabilityEscrowStorageV1.
 */
abstract contract DataPortabilityEscrowStorageV1 is IDataPortabilityEscrow {
    /// @dev account => asset => balance. Asset `address(0)` is native VANA.
    mapping(address account => mapping(address asset => uint256 balance)) internal _balances;

    /// @dev Whitelisted ERC-20s eligible for deposit. Native (address(0)) is always supported and not tracked here.
    mapping(address token => bool whitelisted) public override isWhitelistedToken;

    /// @dev Cross-referenced permissions contract used by `registerAndSettle`.
    ///      Set post-deploy via `setPermissions`. If left unset, `registerAndSettle`
    ///      reverts with `PermissionsNotSet`.
    IDataPortabilityPermissionsV2 public override permissions;

    /// @dev Cross-referenced data-registry contract used by `recordAccessAndSettle`.
    ///      Set post-deploy via `setDataRegistry`. If left unset,
    ///      `recordAccessAndSettle` reverts with `DataRegistryNotSet`.
    IDataRegistryV2 public override dataRegistry;

    /// @dev Enumerable set of every target address that currently has at least
    ///      one allowed selector. Maintained in lockstep with
    ///      `_allowedSelectorsByTarget` so off-chain consumers can list every
    ///      contract `runOpAndSettle` may dispatch to.
    EnumerableSet.AddressSet internal _allowedTargets;

    /// @dev Per-target enumerable set of allowed function selectors (left-aligned
    ///      `bytes4` stored as `bytes32`). Lookup via
    ///      `EnumerableSet.contains(_allowedSelectorsByTarget[target], bytes32(selector))`.
    mapping(address target => EnumerableSet.Bytes32Set selectors) internal _allowedSelectorsByTarget;
}
