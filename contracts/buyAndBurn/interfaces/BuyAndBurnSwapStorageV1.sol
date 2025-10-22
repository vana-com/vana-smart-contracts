// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./interfaces/IBuyAndBurnSwap.sol";

/**
 * @title Storage for BuyAndBurnSwap
 * @notice For future upgrades, do not change BuyAndBurnSwapStorageV1. 
 * Create a new contract which implements BuyAndBurnSwapStorageV1.
 */
abstract contract BuyAndBurnSwapStorageV1 is IBuyAndBurnSwap {
    ISwapHelper public override swapHelper;
    INonfungiblePositionManager public override positionManager;
}
