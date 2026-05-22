// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

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
}
