// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./SwapAndAddLiquidityLib.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SwapAndAddLiquidityLibTest
 * @notice Test harness for SwapAndAddLiquidityLib
 */
contract SwapAndAddLiquidityLibTest {
    using SwapAndAddLiquidityLib for SwapAndAddLiquidityLib.SwapParams;

    function testSwapAndAddLiquidity(
        SwapAndAddLiquidityLib.SwapParams memory params
    ) external returns (SwapAndAddLiquidityLib.SwapResult memory) {
        return SwapAndAddLiquidityLib.swapAndAddLiquidity(params);
    }

    // Allow contract to receive tokens
    receive() external payable {}
}