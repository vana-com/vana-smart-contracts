// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ISwapRouter.sol";
import "./interfaces/INonfungiblePositionManager.sol";
import "./interfaces/IUniswapV3Pool.sol";
import "./interfaces/IUniswapV3Factory.sol";

/**
 * @title SwapAndAddLiquidityLib
 * @notice Library for executing token swaps and adding liquidity to Uniswap V3 positions
 * @dev Core logic for the buy-and-burn mechanism
 */
library SwapAndAddLiquidityLib {
    using SafeERC20 for IERC20;

    // Custom errors
    error InsufficientLiquidity();
    error SlippageExceeded();
    error InvalidTokenPair();
    error SwapFailed();
    error LiquidityAddFailed();

    // Events
    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 priceImpact
    );
    event LiquidityAdded(
        address indexed token0,
        address indexed token1,
        uint256 amount0,
        uint256 amount1,
        uint128 liquidity,
        uint256 lpTokenId
    );

    struct SwapParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 poolFee;
        uint256 maxSlippageBps; // Basis points (e.g., 200 = 2%)
        uint256 impactThreshold; // Basis points (e.g., 500 = 5%)
        uint256 lpTokenId; // 0 if no LP position exists
        address router; // DataDEX router address
        address positionManager; // Uniswap V3 Position Manager
        address factory; // Uniswap V3 Factory
    }

    struct SwapResult {
        uint256 tokenOutReceived;
        uint256 tokenInUsed;
        uint256 tokenInUnused;
        uint256 tokenOutSpare; // Amount available to burn
        uint256 lpAdded;
        uint256 priceImpact;
    }

    /**
     * @notice Main function to swap tokens and add liquidity
     * @param params Swap parameters
     * @return result Swap and liquidity add results
     */
    function swapAndAddLiquidity(
        SwapParams memory params
    ) internal returns (SwapResult memory result) {
        // Validate inputs
        if (params.tokenIn == address(0) || params.tokenOut == address(0)) {
            revert InvalidTokenPair();
        }
        if (params.tokenIn == params.tokenOut) {
            revert InvalidTokenPair();
        }

        // Determine effective threshold based on whether we have queued funds
        uint256 effectiveThreshold = params.impactThreshold;

        // Quote the best swap amount within threshold
        (uint256 amountToSwap, uint256 expectedOut, uint256 priceImpact) =
                        _quoteBestSwap(
                params.tokenIn,
                params.tokenOut,
                params.amountIn,
                effectiveThreshold,
                params.poolFee,
                params.factory
            );

        if (amountToSwap == 0) {
            // Cannot swap within threshold, return unused
            result.tokenInUnused = params.amountIn;
            result.priceImpact = priceImpact;
            return result;
        }

        // Execute swap
        result.tokenOutReceived = _executeSwap(
            params.tokenIn,
            params.tokenOut,
            amountToSwap,
            expectedOut,
            params.maxSlippageBps,
            params.poolFee,
            params.router
        );

        result.tokenInUsed = amountToSwap;
        result.tokenInUnused = params.amountIn - amountToSwap;
        result.priceImpact = priceImpact;

        emit SwapExecuted(
            params.tokenIn,
            params.tokenOut,
            amountToSwap,
            result.tokenOutReceived,
            priceImpact
        );

        // Add liquidity if we have both tokens remaining
        if (result.tokenInUnused > 0 && result.tokenOutReceived > 0 && params.lpTokenId > 0) {
            (uint256 lpAmount, uint256 amount0Used, uint256 amount1Used) =
                            _addLiquidity(
                    params.tokenIn,
                    params.tokenOut,
                    result.tokenInUnused,
                    result.tokenOutReceived,
                    params.lpTokenId,
                    params.positionManager
                );

            result.lpAdded = lpAmount;

            // Calculate spare amounts
            if (params.tokenIn < params.tokenOut) {
                // tokenIn is token0
                result.tokenInUnused -= amount0Used;
                result.tokenOutSpare = result.tokenOutReceived - amount1Used;
            } else {
                // tokenIn is token1
                result.tokenInUnused -= amount1Used;
                result.tokenOutSpare = result.tokenOutReceived - amount0Used;
            }

            emit LiquidityAdded(
                params.tokenIn < params.tokenOut ? params.tokenIn : params.tokenOut,
                params.tokenIn < params.tokenOut ? params.tokenOut : params.tokenIn,
                amount0Used,
                amount1Used,
                uint128(lpAmount),
                params.lpTokenId
            );
        } else {
            // No LP position or no tokens to add - all tokenOut is spare
            result.tokenOutSpare = result.tokenOutReceived;
        }

        return result;
    }

    /**
     * @notice Quote the best swap amount within price impact threshold
     * @dev Calculates maximum swap amount that stays within impact threshold
     */
    function _quoteBestSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 impactThreshold,
        uint24 poolFee,
        address factory
    ) private view returns (
        uint256 amountToSwap,
        uint256 expectedOut,
        uint256 priceImpact
    ) {
        // Get pool
        address pool = IUniswapV3Factory(factory).getPool(tokenIn, tokenOut, poolFee);
        if (pool == address(0)) {
            return (0, 0, 10000); // 100% impact if no pool
        }

        // Get pool reserves (simplified - in production, use sqrtPriceX96)
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        uint128 liquidity = IUniswapV3Pool(pool).liquidity();

        if (liquidity == 0) {
            return (0, 0, 10000);
        }

        // Calculate price impact for full amount
        // This is simplified - production should use Uniswap's quoter
        uint256 fullImpact = _estimatePriceImpact(amountIn, liquidity);

        if (fullImpact <= impactThreshold) {
            // Can swap full amount
            amountToSwap = amountIn;
            expectedOut = _estimateSwapOutput(amountIn, sqrtPriceX96, liquidity);
            priceImpact = fullImpact;
        } else {
            // Binary search for maximum amount within threshold
            uint256 left = 0;
            uint256 right = amountIn;

            while (right - left > amountIn / 1000) { // 0.1% precision
                uint256 mid = (left + right) / 2;
                uint256 impact = _estimatePriceImpact(mid, liquidity);

                if (impact <= impactThreshold) {
                    left = mid;
                } else {
                    right = mid;
                }
            }

            amountToSwap = left;
            if (amountToSwap > 0) {
                expectedOut = _estimateSwapOutput(amountToSwap, sqrtPriceX96, liquidity);
                priceImpact = _estimatePriceImpact(amountToSwap, liquidity);
            }
        }

        return (amountToSwap, expectedOut, priceImpact);
    }

    /**
     * @notice Estimate price impact for a swap amount
     * @dev Simplified calculation - production should be more sophisticated
     */
    function _estimatePriceImpact(
        uint256 amountIn,
        uint128 liquidity
    ) private pure returns (uint256) {
        if (liquidity == 0) return 10000; // 100%

        // Simplified: impact ≈ amountIn / liquidity * 10000
        // This is a rough approximation
        uint256 impact = (amountIn * 10000) / uint256(liquidity);
        return impact > 10000 ? 10000 : impact;
    }

    /**
     * @notice Estimate swap output
     * @dev Simplified calculation - production should use Uniswap's quoter
     */
    function _estimateSwapOutput(
        uint256 amountIn,
        uint160 sqrtPriceX96,
        uint128 liquidity
    ) private pure returns (uint256) {
        // Simplified calculation
        // In production, use QuoterV2 for accurate quotes
        uint256 priceX96 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        return (amountIn * priceX96) / (2**192);
    }

    /**
     * @notice Execute token swap via router
     */
    function _executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 expectedOut,
        uint256 maxSlippageBps,
        uint24 poolFee,
        address router
    ) private returns (uint256 amountOut) {
        // Approve router
        IERC20(tokenIn).safeIncreaseAllowance(router, amountIn);

        // Calculate minimum output with slippage
        uint256 amountOutMinimum = (expectedOut * (10000 - maxSlippageBps)) / 10000;

        // Prepare swap params
        ISwapRouter.ExactInputSingleParams memory swapParams = ISwapRouter
            .ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: poolFee,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        });

        // Execute swap
        try ISwapRouter(router).exactInputSingle(swapParams) returns (uint256 _amountOut) {
            amountOut = _amountOut;
        } catch {
            revert SwapFailed();
        }

        return amountOut;
    }

    /**
     * @notice Add liquidity to existing Uniswap V3 position
     */
    function _addLiquidity(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 lpTokenId,
        address positionManager
    ) private returns (
        uint256 liquidity,
        uint256 amount0,
        uint256 amount1
    ) {
        // Determine token0 and token1 (Uniswap V3 requires token0 < token1)
        (address token0, address token1) = tokenIn < tokenOut
            ? (tokenIn, tokenOut)
            : (tokenOut, tokenIn);

        uint256 amount0Desired = tokenIn < tokenOut ? amountIn : amountOut;
        uint256 amount1Desired = tokenIn < tokenOut ? amountOut : amountIn;

        // Approve position manager
        IERC20(token0).safeIncreaseAllowance(positionManager, amount0Desired);
        IERC20(token1).safeIncreaseAllowance(positionManager, amount1Desired);

        // Prepare increase liquidity params
        INonfungiblePositionManager.IncreaseLiquidityParams memory params =
                            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: lpTokenId,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: 0, // In production, calculate minimum amounts
                amount1Min: 0,
                deadline: block.timestamp
            });

        // Increase liquidity
        try INonfungiblePositionManager(positionManager).increaseLiquidity(params)
        returns (uint128 _liquidity, uint256 _amount0, uint256 _amount1) {
            liquidity = uint256(_liquidity);
            amount0 = _amount0;
            amount1 = _amount1;
        } catch {
            revert LiquidityAddFailed();
        }

        return (liquidity, amount0, amount1);
    }
}