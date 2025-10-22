// SPDX-License-Identifier: MIT
pragma solidity >= 0.8.26;

import "./INonfungiblePositionManager.sol";
import "../../dlpRewards/swapHelper/interfaces/ISwapHelper.sol";

interface IBuyAndBurnSwap {
    error BuyAndBurnSwap__ZeroAddress();
    error BuyAndBurnSwap__ZeroAmount();
    error BuyAndBurnSwap__ZeroLiquidity();
    error BuyAndBurnSwap__InsufficientAmount(address token, uint256 expected, uint256 actual);
    error BuyAndBurnSwap__InvalidRange();
    error BuyAndBurnSwap__LPAmountMismatch();
    error BuyAndBurnSwap__SpareAmountMismatch(address token, uint256 expected, uint256 actual);
    error BuyAndBurnSwap__LiquidityMismatch(uint128 expected, uint128 actual);
    error BuyAndBurnSwap__InvalidSlippagePercentage();

    /// @notice Returns the current version of the contract
    /// @return The version of the contract
    function version() external view returns (uint256);

    /// @notice Pauses the contract
    function pause() external;

    /// @notice Unpauses the contract
    function unpause() external;

    /// @notice Returns the address of the swap helper contract
    /// @return The address of the swap helper contract
    function swapHelper() external view returns (ISwapHelper);

    /// @notice Updates the address of the swap helper contract
    /// @param newSwapHelper The address of the new swap helper contract
    function updateSwapHelper(ISwapHelper newSwapHelper) external;

    /// @notice Returns the address of the Uniswap position manager contract
    /// @return The address of the Uniswap position manager contract
    function positionManager() external view returns (INonfungiblePositionManager);

    /// @notice Updates the address of the Uniswap position manager contract
    /// @param newPositionManager The address of the new Uniswap position manager contract
    function updatePositionManager(INonfungiblePositionManager newPositionManager) external;

    struct SwapAndAddLiquidityParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address tokenOutRecipient;
        address spareTokenInRecipient;
        uint256 amountIn;
        uint256 maximumSlippagePercentage;
        uint256 lpTokenId;
    }

    /// @notice Swaps tokenIn for as much tokenOut as possible within slippage, then adds liquidity
    /// @dev Transfers spare tokenOut to tokenOutRecipient and spare tokenIn to spareTokenInRecipient
    /// @param params The parameters for the swap and liquidity addition
    /// @return liquidityDelta The amount of liquidity added
    /// @return spareIn The amount of tokenIn not used
    /// @return spareOut The amount of tokenOut not used
    function swapAndAddLiquidity(
        SwapAndAddLiquidityParams calldata params
    ) external payable returns (uint128 liquidityDelta, uint256 spareIn, uint256 spareOut);
}
