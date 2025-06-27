// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "../swapHelper/libraries/SqrtPriceMath.sol";
import "../swapHelper/libraries/TickMath.sol";
import "../swapHelper/libraries/LiquidityAmounts.sol";
import "./interfaces/DLPRewardSwapStorageV1.sol";

contract DLPRewardSwapImplementation is
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    DLPRewardSwapStorageV1
{
    using Address for address payable;
    using SafeERC20 for IERC20;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    address public constant VANA = address(0);
    uint256 public constant ONE_HUNDRED_PERCENT = 100e18;

    receive() external payable {}

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the contract
    function initialize(
        address ownerAddress,
        ISwapHelper initSwapHelper,
        INonfungiblePositionManager initPositionManager
    ) external initializer {
        __UUPSUpgradeable_init();
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        swapHelper = initSwapHelper;
        positionManager = initPositionManager;

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    /// @notice Upgrades the contract to a new implementation
    /// @param newImplementation The address of the new implementation
    /// @dev This function is called by the UUPS proxy to authorize upgrades
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {
        /// @dev Access control is handled by the onlyRole modifier
        /// No additional validation needed
    }

    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function updateSwapHelper(ISwapHelper newSwapHelper) external override onlyRole(MAINTAINER_ROLE) {
        require(address(newSwapHelper) != address(0), DLPRewardSwap__ZeroAddress());
        swapHelper = newSwapHelper;
    }

    function updatePositionManager(
        INonfungiblePositionManager newPositionManager
    ) external override onlyRole(MAINTAINER_ROLE) {
        require(address(newPositionManager) != address(0), DLPRewardSwap__ZeroAddress());
        positionManager = newPositionManager;
    }

    function getAmountsDelta(
        uint160 sqrtRatioX96,
        uint160 sqrtRatioLowerX96,
        uint160 sqrtRatioUpperX96,
        uint128 liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        require(sqrtRatioLowerX96 <= sqrtRatioUpperX96, DLPRewardSwap__InvalidRange());

        if (sqrtRatioX96 <= sqrtRatioLowerX96) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtRatioLowerX96, sqrtRatioUpperX96, liquidity, true);
        } else if (sqrtRatioX96 < sqrtRatioUpperX96) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtRatioX96, sqrtRatioUpperX96, liquidity, true);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtRatioLowerX96, sqrtRatioX96, liquidity, true);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtRatioLowerX96, sqrtRatioUpperX96, liquidity, true);
        }
    }

    function quoteLpSwap(QuoteLpSwapParams memory params) internal view returns (LpSwapQuote memory res) {
        require(params.amountIn > 0, DLPRewardSwap__ZeroAmount());
        require(params.tokenOut != address(0), DLPRewardSwap__ZeroAddress());
        require(params.sqrtRatioLowerX96 <= params.sqrtRatioUpperX96, DLPRewardSwap__InvalidRange());

        IWVANA WVANA = swapHelper.WVANA();
        address tokenIn = params.tokenIn == VANA ? address(WVANA) : params.tokenIn;
        address tokenOut = params.tokenOut == VANA ? address(WVANA) : params.tokenOut;

        IUniswapV3Pool pool = swapHelper.getPool(tokenIn, tokenOut, params.fee);
        (uint160 currentSqrtPriceX96, , , , , , ) = pool.slot0();

        uint128 currentLiquidity = pool.liquidity();

        bool zeroForOne = tokenIn < tokenOut;

        uint128 bestLiquidityDelta = 0;
        uint256 bestAmount0Used = 0;
        uint256 bestAmount1Used = 0;

        /// @dev Cases of increaseLiquidity without swap, so the price does not move
        if (currentSqrtPriceX96 <= params.sqrtRatioLowerX96 && zeroForOne) {
            /// @dev The current sqrtPriceX96 is below the specified range.
            /// The position is only activated when the price goes up
            /// (aka only when the pool sells token0).
            /// Thus, only tokenIn (token0) is provided and no need to swap.
            bestLiquidityDelta = LiquidityAmounts.getLiquidityForAmount0(
                params.sqrtRatioLowerX96,
                params.sqrtRatioUpperX96,
                params.amountIn
            );
            bestAmount0Used = SqrtPriceMath.getAmount0Delta(
                params.sqrtRatioLowerX96,
                params.sqrtRatioUpperX96,
                bestLiquidityDelta,
                true
            );
            return
                LpSwapQuote({
                    amountSwapIn: 0,
                    spareIn: params.amountIn - bestAmount0Used,
                    spareOut: 0,
                    liquidityDelta: bestLiquidityDelta,
                    sqrtPriceX96After: currentSqrtPriceX96
                });
        }

        if (currentSqrtPriceX96 >= params.sqrtRatioUpperX96 && !zeroForOne) {
            /// @dev The current sqrtPriceX96 is above the specified range.
            /// The position is only activated when the price goes down
            /// (aka only when the pool sells token1).
            /// Thus, only tokenIn (token1) is provided and no need to swap.
            bestLiquidityDelta = LiquidityAmounts.getLiquidityForAmount1(
                params.sqrtRatioLowerX96,
                params.sqrtRatioUpperX96,
                params.amountIn
            );
            bestAmount1Used = SqrtPriceMath.getAmount1Delta(
                params.sqrtRatioLowerX96,
                params.sqrtRatioUpperX96,
                bestLiquidityDelta,
                true
            );
            return
                LpSwapQuote({
                    amountSwapIn: 0,
                    spareIn: params.amountIn - bestAmount1Used,
                    spareOut: 0,
                    liquidityDelta: bestLiquidityDelta,
                    sqrtPriceX96After: currentSqrtPriceX96
                });
        }

        /// @dev Cases of increaseLiquidity with swap from tokenIn to tokenOut.
        /// The price moves down if tokenIn is token0, up if tokenIn is token1.

        uint256 low = 1;
        uint256 high = params.amountIn;
        uint256 bestSwapIn = 0;
        uint256 bestSwapOut = 0;
        uint160 bestSqrtPriceX96After = 0;

        while (low < high) {
            uint256 mid = low + (high - low) / 2;

            ISwapHelper.Quote memory quote = swapHelper.quoteSlippageExactInputSingle(
                ISwapHelper.QuoteSlippageExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: params.fee,
                    amountIn: mid,
                    sqrtPriceX96: currentSqrtPriceX96,
                    liquidity: currentLiquidity,
                    maximumSlippagePercentage: params.maximumSlippagePercentage
                })
            );

            /// @dev Amounts to be added to the position after the swap.
            uint256 amount0 = zeroForOne ? params.amountIn - quote.amountToPay : quote.amountReceived;
            uint256 amount1 = zeroForOne ? quote.amountReceived : params.amountIn - quote.amountToPay;

            uint128 liquidityDelta;

            if (quote.sqrtPriceX96After <= params.sqrtRatioLowerX96) {
                liquidityDelta = LiquidityAmounts.getLiquidityForAmount0(
                    params.sqrtRatioLowerX96,
                    params.sqrtRatioUpperX96,
                    amount0
                );

                if (zeroForOne) {
                    /// @dev All remaining tokenIn (token0) after the swap is added to the position,
                    /// while the tokenOut (token1) is not added to the pool. We should use less token0 in the swap,
                    /// so that more token0 can be added to the position.
                    /// zeroForOne purchase: sqrtPriceLimitX96 <= sqrtPriceX96After.
                    /// When using less token0 in the swap, the price goes up so the limit is not reached.
                    high = mid;
                } else {
                    /// @dev Only tokenOut (token0) is added to the position.
                    /// We should use more tokenIn (token1) in the swap to get more token0.
                    /// oneForZero purchase: sqrtPriceX96After <= sqrtPriceLimitX96.
                    /// When using more token1 in the swap, the price goes up to the limit.
                    /// If we reach the limit, when putting more token1, we still get the same amount of token0.
                    if (quote.sqrtPriceX96After == quote.sqrtPriceLimitX96) {
                        if (liquidityDelta > bestLiquidityDelta) {
                            bestLiquidityDelta = liquidityDelta;
                            bestSwapIn = quote.amountToPay;
                            bestSwapOut = quote.amountReceived;
                            bestSqrtPriceX96After = quote.sqrtPriceX96After;
                        }
                        break;
                    }
                    low = mid + 1;
                }
            } else if (quote.sqrtPriceX96After < params.sqrtRatioUpperX96) {
                uint128 liquidity0 = LiquidityAmounts.getLiquidityForAmount0(
                    quote.sqrtPriceX96After,
                    params.sqrtRatioUpperX96,
                    amount0
                );
                uint128 liquidity1 = LiquidityAmounts.getLiquidityForAmount1(
                    params.sqrtRatioLowerX96,
                    quote.sqrtPriceX96After,
                    amount1
                );
                if (liquidity0 < liquidity1) {
                    liquidityDelta = liquidity0;

                    /// @dev token0 is the limiting factor. We should have more token0
                    /// after the swap to increase the liquidity more.
                    if (zeroForOne) {
                        /// @dev We should use less token0 in the swap.
                        high = mid;
                    } else {
                        /// @dev token0 is tokenOut.
                        if (quote.sqrtPriceX96After == quote.sqrtPriceLimitX96) {
                            if (liquidityDelta > bestLiquidityDelta) {
                                bestLiquidityDelta = liquidityDelta;
                                bestSwapIn = quote.amountToPay;
                                bestSwapOut = quote.amountReceived;
                                bestSqrtPriceX96After = quote.sqrtPriceX96After;
                            }
                            break;
                        }
                        /// @dev We should use more token1 in the swap to have more token0.
                        low = mid + 1;
                    }
                } else if (liquidity0 > liquidity1) {
                    liquidityDelta = liquidity1;

                    /// @dev token1 is the limiting factor. We should have more token1
                    /// after the swap to increase the liquidity more.
                    if (zeroForOne) {
                        /// @dev token1 is tokenOut.
                        if (quote.sqrtPriceX96After == quote.sqrtPriceLimitX96) {
                            if (liquidityDelta > bestLiquidityDelta) {
                                bestLiquidityDelta = liquidityDelta;
                                bestSwapIn = quote.amountToPay;
                                bestSwapOut = quote.amountReceived;
                                bestSqrtPriceX96After = quote.sqrtPriceX96After;
                            }
                            break;
                        }
                        /// @dev We should use more token0 in the swap to have more token1.
                        low = mid + 1;
                    } else {
                        /// @dev We should use less token1 in the swap.
                        high = mid;
                    }
                } else {
                    // liquidity0 == liquidity1
                    /// @dev The swap is optimal.
                    liquidityDelta = liquidity0;

                    if (liquidityDelta > bestLiquidityDelta) {
                        bestLiquidityDelta = liquidityDelta;
                        bestSwapIn = quote.amountToPay;
                        bestSwapOut = quote.amountReceived;
                        bestSqrtPriceX96After = quote.sqrtPriceX96After;
                    }
                    break;
                }
            } else {
                // quote.sqrtPriceX96After >= params.sqrtRatioUpperX96
                liquidityDelta = LiquidityAmounts.getLiquidityForAmount1(
                    params.sqrtRatioLowerX96,
                    params.sqrtRatioUpperX96,
                    amount1
                );

                if (zeroForOne) {
                    /// @dev Only tokenOut (token1) is added to the position.
                    /// We should use more tokenIn (token0) in the swap to get more tokenOut.
                    /// zeroForOne purchase: sqrtPriceLimitX96 <= sqrtPriceX96After.
                    /// When using more token0 in the swap, the price goes down to the limit.
                    /// If we reach the limit, when putting more token0, we still get the same amount of token1.
                    if (quote.sqrtPriceX96After == quote.sqrtPriceLimitX96) {
                        if (liquidityDelta > bestLiquidityDelta) {
                            bestLiquidityDelta = liquidityDelta;
                            bestSwapIn = quote.amountToPay;
                            bestSwapOut = quote.amountReceived;
                            bestSqrtPriceX96After = quote.sqrtPriceX96After;
                        }
                        break;
                    }
                    low = mid + 1;
                } else {
                    /// @dev All remaining tokenIn (token1) after the swap is added to the position,
                    /// while the tokenOut is not added to the pool. We should use less token1 in the swap,
                    /// so that more token1 can be added to the position.
                    /// oneForZero purchase: sqrtPriceX96After <= sqrtPriceLimitX96.
                    /// When using less token1 in the swap, the price goes down so the limit is not reached.
                    high = mid;
                }
            }

            if (liquidityDelta > bestLiquidityDelta) {
                bestLiquidityDelta = liquidityDelta;
                bestSwapIn = quote.amountToPay;
                bestSwapOut = quote.amountReceived;
                bestSqrtPriceX96After = quote.sqrtPriceX96After;
            }
        }

        if (low == high) {
            ISwapHelper.Quote memory quote = swapHelper.quoteSlippageExactInputSingle(
                ISwapHelper.QuoteSlippageExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: params.fee,
                    amountIn: low,
                    sqrtPriceX96: currentSqrtPriceX96,
                    liquidity: currentLiquidity,
                    maximumSlippagePercentage: params.maximumSlippagePercentage
                })
            );
            uint256 amount0 = zeroForOne ? params.amountIn - quote.amountToPay : quote.amountReceived;
            uint256 amount1 = zeroForOne ? quote.amountReceived : params.amountIn - quote.amountToPay;
            uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
                quote.sqrtPriceX96After,
                params.sqrtRatioLowerX96,
                params.sqrtRatioUpperX96,
                amount0,
                amount1
            );
            if (liquidity > bestLiquidityDelta) {
                bestLiquidityDelta = liquidity;
                bestSwapIn = quote.amountToPay;
                bestSwapOut = quote.amountReceived;
                bestSqrtPriceX96After = quote.sqrtPriceX96After;
            }
        }

        (bestAmount0Used, bestAmount1Used) = getAmountsDelta(
            bestSqrtPriceX96After,
            params.sqrtRatioLowerX96,
            params.sqrtRatioUpperX96,
            bestLiquidityDelta
        );

        res.liquidityDelta = bestLiquidityDelta;
        res.sqrtPriceX96After = bestSqrtPriceX96After;
        res.amountSwapIn = bestSwapIn;
        res.spareIn = zeroForOne
            ? params.amountIn - bestSwapIn - bestAmount0Used
            : params.amountIn - bestSwapIn - bestAmount1Used;
        res.spareOut = zeroForOne ? bestSwapOut - bestAmount1Used : bestSwapOut - bestAmount0Used;
    }

    function lpSwap(
        LpSwapParams memory params
    ) internal returns (uint128 liquidityDelta, uint256 spareIn, uint256 spareOut) {
        require(params.amountIn > 0, DLPRewardSwap__ZeroAmount());
        if (params.tokenIn == VANA) {
            require(msg.value >= params.amountIn, DLPRewardSwap__InsufficientAmount(VANA, params.amountIn, msg.value));
        }

        (, , , , , int24 tickLower, int24 tickUpper, , , , , ) = positionManager.positions(params.lpTokenId);
        uint160 sqrtRatioLowerX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioUpperX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        LpSwapQuote memory quote = quoteLpSwap(
            QuoteLpSwapParams({
                amountIn: params.amountIn,
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                fee: params.fee,
                maximumSlippagePercentage: params.maximumSlippagePercentage,
                sqrtRatioLowerX96: sqrtRatioLowerX96,
                sqrtRatioUpperX96: sqrtRatioUpperX96
            })
        );
        require(quote.liquidityDelta > 0, DLPRewardSwap__ZeroLiquidity());

        uint256 amountSwapInUsed;
        uint256 amountSwapOut;

        if (quote.amountSwapIn > 0) {
            (amountSwapInUsed, amountSwapOut) = swapHelper.slippageExactInputSingle{value: quote.amountSwapIn}(
                ISwapHelper.SlippageSwapParams({
                    tokenIn: params.tokenIn,
                    tokenOut: params.tokenOut,
                    fee: params.fee,
                    recipient: address(this),
                    amountIn: quote.amountSwapIn,
                    maximumSlippagePercentage: params.maximumSlippagePercentage
                })
            );
        }
        require(amountSwapInUsed == quote.amountSwapIn, DLPRewardSwap__LPAmountMismatch());

        IWVANA WVANA = swapHelper.WVANA();
        address tokenIn = params.tokenIn == VANA ? address(WVANA) : params.tokenIn;
        address tokenOut = params.tokenOut == VANA ? address(WVANA) : params.tokenOut;
        bool zeroForOne = tokenIn < tokenOut;

        uint256 amountLpIn = params.amountIn - amountSwapInUsed;
        if (params.tokenIn == VANA) {
            WVANA.deposit{value: amountLpIn}();
        }

        address token0 = zeroForOne ? tokenIn : tokenOut;
        address token1 = zeroForOne ? tokenOut : tokenIn;

        uint256 amount0Desired = zeroForOne ? amountLpIn : amountSwapOut;
        uint256 amount1Desired = zeroForOne ? amountSwapOut : amountLpIn;

        uint256 token0Balance = IERC20(token0).balanceOf(address(this));
        uint256 token1Balance = IERC20(token1).balanceOf(address(this));
        require(
            token0Balance >= amount0Desired,
            DLPRewardSwap__InsufficientAmount(token0, amount0Desired, token0Balance)
        );
        require(
            token1Balance >= amount1Desired,
            DLPRewardSwap__InsufficientAmount(token1, amount1Desired, token1Balance)
        );

        IERC20(token0).forceApprove(address(positionManager), amount0Desired);
        IERC20(token1).forceApprove(address(positionManager), amount1Desired);

        IUniswapV3Pool pool = swapHelper.getPool(tokenIn, tokenOut, params.fee);
        (uint160 currentSqrtPriceX96, , , , , , ) = pool.slot0();
        uint128 liquidityDeltaDesired = LiquidityAmounts.getLiquidityForAmounts(
            currentSqrtPriceX96,
            sqrtRatioLowerX96,
            sqrtRatioUpperX96,
            amount0Desired,
            amount1Desired
        );
        require(
            liquidityDeltaDesired == quote.liquidityDelta,
            DLPRewardSwap__LiquidityMismatch(quote.liquidityDelta, liquidityDeltaDesired)
        );

        uint256 amount0;
        uint256 amount1;
        (liquidityDelta, amount0, amount1) = positionManager.increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: params.lpTokenId,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp
            })
        );

        spareIn = zeroForOne ? amount0Desired - amount0 : amount1Desired - amount1;
        spareOut = zeroForOne ? amount1Desired - amount1 : amount0Desired - amount0;

        /// @dev Check invariants
        require(
            liquidityDelta == quote.liquidityDelta,
            DLPRewardSwap__LiquidityMismatch(quote.liquidityDelta, liquidityDelta)
        );
        require(spareIn == quote.spareIn, DLPRewardSwap__SpareAmountMismatch(params.tokenIn, quote.spareIn, spareIn));
        require(
            spareOut == quote.spareOut,
            DLPRewardSwap__SpareAmountMismatch(params.tokenOut, quote.spareOut, spareOut)
        );

        if (params.tokenIn == VANA && spareIn > 0) {
            WVANA.withdraw(spareIn);
        }
    }

    function splitRewardSwap(
        SplitRewardSwapParams calldata params
    )
        external
        payable
        override
        nonReentrant
        whenNotPaused
        returns (uint256 tokenRewardAmount, uint256 spareToken, uint256 spareVana, uint256 usedVanaAmount)
    {
        uint256 amountIn = msg.value;
        require(amountIn > 0, DLPRewardSwap__ZeroAmount());
        require(params.rewardPercentage <= ONE_HUNDRED_PERCENT, DLPRewardSwap__InvalidRewardPercentage());
        require(params.maximumSlippagePercentage <= ONE_HUNDRED_PERCENT, DLPRewardSwap__InvalidSlippagePercentage());
        require(params.rewardRecipient != address(0), DLPRewardSwap__ZeroAddress());
        require(params.spareRecipient != address(0), DLPRewardSwap__ZeroAddress());

        (, , address token0, address token1, uint24 fee, , , , , , , ) = positionManager.positions(params.lpTokenId);
        IWVANA WVANA = swapHelper.WVANA();
        require(token0 == address(WVANA) || token1 == address(WVANA), DLPRewardSwap__InvalidLpTokenId());
        address dlpToken = token0 == address(WVANA) ? token1 : token0;

        uint256 rewardAmount = (amountIn * params.rewardPercentage) / ONE_HUNDRED_PERCENT;

        uint256 lpAmount = amountIn - rewardAmount;

        /// @dev Use VANA to increase liquidity

        uint128 liquidityDelta;
        (liquidityDelta, spareVana, spareToken) = lpSwap(
            LpSwapParams({
                amountIn: lpAmount,
                tokenIn: VANA,
                tokenOut: dlpToken,
                fee: fee,
                maximumSlippagePercentage: params.maximumSlippagePercentage,
                lpTokenId: params.lpTokenId
            })
        );
        uint256 usedVanaAmountForLp = lpAmount - spareVana;

        /// @dev Send spare tokens to the recipient
        if (spareVana > 0) {
            payable(params.spareRecipient).sendValue(spareVana);
        }
        if (spareToken > 0) {
            IERC20(dlpToken).safeTransfer(params.spareRecipient, spareToken);
        }

        /// @dev Swap VANA reward to dlpToken
        uint256 usedVanaAmountForReward;
        uint256 unusedVanaAmountForReward;

        if (rewardAmount > 0) {
            (usedVanaAmountForReward, tokenRewardAmount) = swapHelper.slippageExactInputSingle{value: rewardAmount}(
                ISwapHelper.SlippageSwapParams({
                    tokenIn: VANA,
                    tokenOut: dlpToken,
                    fee: fee,
                    recipient: params.rewardRecipient,
                    amountIn: rewardAmount,
                    maximumSlippagePercentage: params.maximumSlippagePercentage
                })
            );
            unusedVanaAmountForReward = rewardAmount - usedVanaAmountForReward;
            if (unusedVanaAmountForReward > 0) payable(msg.sender).sendValue(unusedVanaAmountForReward);
        }

        usedVanaAmount = usedVanaAmountForLp + usedVanaAmountForReward;
        require(
            amountIn == usedVanaAmount + spareVana + unusedVanaAmountForReward,
            DLPRewardSwap__AmountMismatch(amountIn, usedVanaAmount, spareVana, unusedVanaAmountForReward)
        );

        emit Reward(
            msg.sender,
            params.rewardRecipient,
            dlpToken,
            usedVanaAmountForReward,
            tokenRewardAmount,
            usedVanaAmountForLp,
            liquidityDelta,
            spareVana,
            spareToken
        );
    }

    function quoteSplitRewardSwap(
        QuoteSplitRewardSwapParams calldata params
    )
        external
        view
        override
        returns (uint256 tokenRewardAmount, uint256 spareToken, uint256 spareVana, uint256 usedVanaAmount)
    {
        require(params.amountIn > 0, DLPRewardSwap__ZeroAmount());
        require(params.rewardPercentage <= ONE_HUNDRED_PERCENT, DLPRewardSwap__InvalidRewardPercentage());
        require(params.maximumSlippagePercentage <= ONE_HUNDRED_PERCENT, DLPRewardSwap__InvalidSlippagePercentage());

        (, , address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, , , , , ) = positionManager
            .positions(params.lpTokenId);
        uint160 sqrtRatioLowerX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioUpperX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        IWVANA WVANA = swapHelper.WVANA();
        require(token0 == address(WVANA) || token1 == address(WVANA), DLPRewardSwap__InvalidLpTokenId());
        address dlpToken = token0 == address(WVANA) ? token1 : token0;

        /// @dev We allow zero reward percentage to calculate the swap amounts
        uint256 rewardAmount = (params.amountIn * params.rewardPercentage) / ONE_HUNDRED_PERCENT;

        uint256 lpAmount = params.amountIn - rewardAmount;

        /// @dev Use VANA to increase liquidity
        LpSwapQuote memory lpSwapQuote = quoteLpSwap(
            QuoteLpSwapParams({
                amountIn: lpAmount,
                tokenIn: VANA,
                tokenOut: dlpToken,
                fee: fee,
                maximumSlippagePercentage: params.maximumSlippagePercentage,
                sqrtRatioLowerX96: sqrtRatioLowerX96,
                sqrtRatioUpperX96: sqrtRatioUpperX96
            })
        );

        /// @dev Swap VANA reward to dlpToken
        if (rewardAmount == 0) {
            // If rewardAmount is zero, we do not need to swap
            tokenRewardAmount = 0;
            spareToken = lpSwapQuote.spareOut;
            spareVana = lpSwapQuote.spareIn;
            usedVanaAmount = lpAmount - lpSwapQuote.spareIn;
            return (tokenRewardAmount, spareToken, spareVana, usedVanaAmount);
        }

        IUniswapV3Pool pool = swapHelper.getPool(VANA, dlpToken, fee);
        ISwapHelper.Quote memory rewardSwapQuote = swapHelper.quoteSlippageExactInputSingle(
            ISwapHelper.QuoteSlippageExactInputSingleParams({
                tokenIn: VANA,
                tokenOut: dlpToken,
                fee: fee,
                amountIn: rewardAmount,
                sqrtPriceX96: lpSwapQuote.sqrtPriceX96After,
                liquidity: pool.liquidity() + lpSwapQuote.liquidityDelta,
                maximumSlippagePercentage: params.maximumSlippagePercentage
            })
        );

        tokenRewardAmount = rewardSwapQuote.amountReceived;
        spareToken = lpSwapQuote.spareOut;
        spareVana = lpSwapQuote.spareIn;
        usedVanaAmount = lpAmount - lpSwapQuote.spareIn + rewardSwapQuote.amountToPay;
    }
}
