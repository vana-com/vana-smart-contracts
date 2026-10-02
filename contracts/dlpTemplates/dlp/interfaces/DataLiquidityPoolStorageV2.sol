// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./DataLiquidityPoolStorageV1.sol";

/**
 * @title Storage for DataLiquidityPool, version 2
 * @notice Appends the DLP's own registry id so requestReward can bind a TEE proof
 * to this DLP. For future upgrades, do not change DataLiquidityPoolStorageV2. Create
 * a new contract which implements DataLiquidityPoolStorageV2
 */
abstract contract DataLiquidityPoolStorageV2 is DataLiquidityPoolStorageV1 {
    /// @notice The id this DLP holds in the DLPRegistry. Must be set by the owner
    /// after registration; requestReward reverts while it is 0.
    uint256 public override dlpId;
}
