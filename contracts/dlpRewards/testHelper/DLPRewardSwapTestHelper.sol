// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "../dlpRewardSwap/DLPRewardSwapImplementation.sol";

contract DLPRewardSwapTestHelper is DLPRewardSwapImplementation {
    function callQuoteLpSwap(QuoteLpSwapParams memory params) external returns (LpSwapQuote memory) {
        return quoteLpSwap(params);
    }

    function callLpSwap(
        LpSwapParams memory params
    ) external payable returns (uint128 liquidityDelta, uint256 spareIn, uint256 spareOut) {
        return lpSwap(params);
    }
}
