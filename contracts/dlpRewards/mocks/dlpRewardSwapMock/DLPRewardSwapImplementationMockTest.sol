// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract DLPRewardSwapImplementationMock
{
    address public constant VANA = address(0);
    uint256 public constant ONE_HUNDRED_PERCENT = 100e18;

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

    uint256 public tokenRewardAmount;
    uint256 public spareToken;
    uint256 public spareVana;
    uint256 public usedVanaAmount;

    function setSplitRewardSwapResponse(
        uint256 _tokenRewardAmount,
        uint256 _spareToken,
        uint256 _spareVana,
        uint256 _usedVanaAmount
    ) external {
        tokenRewardAmount = _tokenRewardAmount;
        spareToken = _spareToken;
        spareVana = _spareVana;
        usedVanaAmount = _usedVanaAmount;
    }

    struct SplitRewardSwapParams {
        uint256 lpTokenId;
        uint256 rewardPercentage;
        uint256 maximumSlippagePercentage;
        address rewardRecipient;
        address spareRecipient;
    }

    struct QuoteSplitRewardSwapParams {
        uint256 amountIn;
        uint256 lpTokenId;
        uint256 rewardPercentage;
        uint256 maximumSlippagePercentage;
    }

    function splitRewardSwap(
        SplitRewardSwapParams calldata params
    )
        external
        payable
        returns (uint256 tokenRewardAmount, uint256 spareToken, uint256 spareVana, uint256 usedVanaAmount)
    {
        uint256 amountIn = msg.value;
        require(amountIn > 0, DLPRewardSwap__ZeroAmount());
        require(params.rewardPercentage <= ONE_HUNDRED_PERCENT, DLPRewardSwap__InvalidRewardPercentage());
        require(params.maximumSlippagePercentage <= ONE_HUNDRED_PERCENT, DLPRewardSwap__InvalidSlippagePercentage());
        require(params.rewardRecipient != address(0), DLPRewardSwap__ZeroAddress());
        require(params.spareRecipient != address(0), DLPRewardSwap__ZeroAddress());

        tokenRewardAmount = this.tokenRewardAmount();
        spareToken = this.spareToken();
        spareVana = this.spareVana();
        usedVanaAmount = this.usedVanaAmount();
    }

    function quoteSplitRewardSwap(
        QuoteSplitRewardSwapParams calldata params
    )
        external
        returns (uint256 tokenRewardAmount, uint256 spareToken, uint256 spareVana, uint256 usedVanaAmount)
    {
        require(params.amountIn > 0, DLPRewardSwap__ZeroAmount());
        require(params.rewardPercentage <= ONE_HUNDRED_PERCENT, DLPRewardSwap__InvalidRewardPercentage());
        require(params.maximumSlippagePercentage <= ONE_HUNDRED_PERCENT, DLPRewardSwap__InvalidSlippagePercentage());

        tokenRewardAmount = this.tokenRewardAmount();
        spareToken = this.spareToken();
        spareVana = this.spareVana();
        usedVanaAmount = this.usedVanaAmount();
    }
}
