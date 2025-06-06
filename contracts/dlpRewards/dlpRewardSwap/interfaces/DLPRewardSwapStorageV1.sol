// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./IDLPRewardSwap.sol";

/**
 * @title Storage for DLPRewardSwap
 * @notice For future upgrades, do not change DLPRewardSwapStorageV1. 
 * Create a new contract which implements DLPRewardSwapStorageV1.
 */
abstract contract DLPRewardSwapStorageV1 is IDLPRewardSwap {
    ISwapHelper public override swapHelper;
    INonfungiblePositionManager public override positionManager;
}