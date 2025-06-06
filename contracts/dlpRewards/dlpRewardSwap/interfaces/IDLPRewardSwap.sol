// SPDX-License-Identifier: MIT
pragma solidity >= 0.8.26;

// import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "./INonfungiblePositionManager.sol";
import "../../swapHelper/interfaces/ISwapHelper.sol";

interface IDLPRewardSwap {
    event Reward(
        address indexed sender,
        address indexed recipient,
        address indexed token,
        uint256 usedVanaForReward,
        uint256 tokenRewardAmount,
        uint256 usedVanaForLp,
        uint256 liquidityDelta,
        uint256 spareVana,
        uint256 spareToken
    );

    error DLPRewardSwap__ZeroAddress();
    error DLPRewardSwap__ZeroAmount();
    error DLPRewardSwap__ZeroAmountSwapIn();
    error DLPRewardSwap__ZeroLiquidity();
    error DLPRewardSwap__InsufficientAmount(address token, uint256 expected, uint256 actual);
    error DLPRewardSwap__InvalidRange();
    error DLPRewardSwap__LPAmountMismatch();
    error DLPRewardSwap__SpareAmountMismatch(address token, uint256 expected, uint256 actual);
    error DLPRewardSwap__LiquidityMismatch(uint128 expected, uint128 actual);
    error DLPRewardSwap__VanaInMismatch(uint256 expected, uint256 actual);
    error DLPRewardSwap__AmountMismatch(uint256 amountIn, uint256 used, uint256 spareVana, uint256 unusedVana);
    error DLPRewardSwap__InvalidSlippagePercentage();
    error DLPRewardSwap__InvalidRewardPercentage();
    error DLPRewardSwap__InvalidLpTokenId();

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

    struct QuoteLpSwapParams {
        uint256 amountIn;
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint256 maximumSlippagePercentage;
        uint160 sqrtRatioLowerX96;
        uint160 sqrtRatioUpperX96;
    }

    struct LpSwapQuote {
        uint256 amountSwapIn;
        uint256 spareIn;
        uint256 spareOut;
        uint128 liquidityDelta;
        uint160 sqrtPriceX96After;
    }

    struct LpSwapParams {
        uint256 amountIn;
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint256 maximumSlippagePercentage;
        uint256 lpTokenId;
    }

    struct SplitRewardSwapParams {
        uint256 lpTokenId;
        uint256 rewardPercentage;
        uint256 maximumSlippagePercentage;
        address rewardRecipient;
        address spareRecipient;
    }

    function splitRewardSwap(
        SplitRewardSwapParams calldata params
    )
        external
        payable
        returns (uint256 tokenRewardAmount, uint256 spareToken, uint256 spareVana, uint256 usedVanaAmount);

    struct QuoteSplitRewardSwapParams {
        uint256 amountIn;
        uint256 lpTokenId;
        uint256 rewardPercentage;
        uint256 maximumSlippagePercentage;
    }

    function quoteSplitRewardSwap(
        QuoteSplitRewardSwapParams calldata params
    ) external view returns (uint256 tokenRewardAmount, uint256 spareToken, uint256 spareVana, uint256 usedVanaAmount);
}
