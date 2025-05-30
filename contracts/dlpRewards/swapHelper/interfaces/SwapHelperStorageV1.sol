// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./ISwapHelper.sol";

/**
 * @title Storage for SwapHelper
 * @notice For future upgrades, do not change SwapHelperStorageV1. 
 * Create a new contract which implements SwapHelperStorageV1.
 */
abstract contract SwapHelperStorageV1 is ISwapHelper {
    /// @notice The address of the WVANA contract
    IWVANA public override WVANA;
    /// @notice The address of the Uniswap V3 router
    address public override uniswapV3Router;
    /// @notice The address of the Uniswap V3 quoter
    IQuoterV2 public override uniswapV3Quoter;
}
