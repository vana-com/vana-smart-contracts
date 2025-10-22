// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "./libraries/SqrtPriceMath.sol";
import "./libraries/TickMath.sol";
import "./libraries/LiquidityAmounts.sol";
import "./interfaces/BuyAndBurnSwapStorageV1.sol";

contract BuyAndBurnSwapImplementation is
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    BuyAndBurnSwapStorageV1
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
        require(address(newSwapHelper) != address(0), BuyAndBurnSwap__ZeroAddress());
        swapHelper = newSwapHelper;
    }

    function updatePositionManager(
        INonfungiblePositionManager newPositionManager
    ) external override onlyRole(MAINTAINER_ROLE) {
        require(address(newPositionManager) != address(0), BuyAndBurnSwap__ZeroAddress());
        positionManager = newPositionManager;
    }

    function getAmountsDelta(
        uint160 sqrtRatioX96,
        uint160 sqrtRatioLowerX96,
        uint160 sqrtRatioUpperX96,
        uint128 liquidity
    ) internal pure returns (uint256 amount0, uint256 amount1) {
        require(sqrtRatioLowerX96 <= sqrtRatioUpperX96, BuyAndBurnSwap__InvalidRange());

        if (sqrtRatioX96 <= sqrtRatioLowerX96) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtRatioLowerX96, sqrtRatioUpperX96, liquidity, true);
        } else if (sqrtRatioX96 < sqrtRatioUpperX96) {
            amount0 = SqrtPriceMath.getAmount0Delta(sqrtRatioX96, sqrtRatioUpperX96, liquidity, true);
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtRatioLowerX96, sqrtRatioX96, liquidity, true);
        } else {
            amount1 = SqrtPriceMath.getAmount1Delta(sqrtRatioLowerX96, sqrtRatioUpperX96, liquidity, true);
        }
    }

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

    function quoteLpSwap(QuoteLpSwapParams memory params) internal view returns (LpSwapQuote memory res) {
        require(params.amountIn > 0, BuyAndBurnSwap__ZeroAmount());
        require(params.sqrtRatioLowerX96 <= params.sqrtRatioUpperX96, BuyAndBurnSwap__InvalidRange());

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

    function swapAndAddLiquidity(
        SwapAndAddLiquidityParams calldata params
    )
        external
        payable
        override
        nonReentrant
        whenNotPaused
        returns (uint128 liquidityDelta, uint256 spareIn, uint256 spareOut)
    {
        require(params.amountIn > 0, BuyAndBurnSwap__ZeroAmount());

        // Handle token transfer based on tokenIn type
        if (params.tokenIn == VANA) {
            require(msg.value >= params.amountIn, BuyAndBurnSwap__InsufficientAmount(VANA, params.amountIn, msg.value));
        } else {
            // Transfer ERC20 tokens from caller to this contract
            IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
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
        require(quote.liquidityDelta > 0, BuyAndBurnSwap__ZeroLiquidity());

        uint256 amountSwapInUsed;
        uint256 amountSwapOut;

        if (quote.amountSwapIn > 0) {
            // Approve swapHelper if tokenIn is ERC20
            if (params.tokenIn != VANA) {
                IERC20(params.tokenIn).forceApprove(address(swapHelper), quote.amountSwapIn);
            }

            // Execute swap - only pass value if tokenIn is VANA
            if (params.tokenIn == VANA) {
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
            } else {
                (amountSwapInUsed, amountSwapOut) = swapHelper.slippageExactInputSingle(
                    ISwapHelper.SlippageSwapParams({
                        tokenIn: params.tokenIn,
                        tokenOut: params.tokenOut,
                        fee: params.fee,
                        recipient: address(this),
                        amountIn: quote.amountSwapIn,
                        maximumSlippagePercentage: params.maximumSlippagePercentage
                }));
            }
        }
        require(amountSwapInUsed == quote.amountSwapIn, BuyAndBurnSwap__LPAmountMismatch());

        IWVANA WVANA = swapHelper.WVANA();
        address tokenIn = params.tokenIn == VANA ? address(WVANA) : params.tokenIn;
        address tokenOut = params.tokenOut == VANA ? address(WVANA) : params.tokenOut;
        bool zeroForOne = tokenIn < tokenOut;

        uint256 amountLpIn = params.amountIn - amountSwapInUsed;
        if (params.tokenIn == VANA) {
            WVANA.deposit{value: amountLpIn}();
        }

        if (params.tokenOut == VANA && amountSwapOut > 0) {
            WVANA.deposit{value: amountSwapOut}();
        }

        address token0 = zeroForOne ? tokenIn : tokenOut;
        address token1 = zeroForOne ? tokenOut : tokenIn;

        uint256 amount0Desired = zeroForOne ? amountLpIn : amountSwapOut;
        uint256 amount1Desired = zeroForOne ? amountSwapOut : amountLpIn;

        uint256 token0Balance = IERC20(token0).balanceOf(address(this));
        uint256 token1Balance = IERC20(token1).balanceOf(address(this));
        require(
            token0Balance >= amount0Desired,
            BuyAndBurnSwap__InsufficientAmount(token0, amount0Desired, token0Balance)
        );
        require(
            token1Balance >= amount1Desired,
            BuyAndBurnSwap__InsufficientAmount(token1, amount1Desired, token1Balance)
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
            BuyAndBurnSwap__LiquidityMismatch(quote.liquidityDelta, liquidityDeltaDesired)
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
            BuyAndBurnSwap__LiquidityMismatch(quote.liquidityDelta, liquidityDelta)
        );
        require(spareIn == quote.spareIn, BuyAndBurnSwap__SpareAmountMismatch(params.tokenIn, quote.spareIn, spareIn));
        require(
            spareOut == quote.spareOut,
            BuyAndBurnSwap__SpareAmountMismatch(params.tokenOut, quote.spareOut, spareOut)
        );

        if (params.tokenIn == VANA && spareIn > 0) {
            WVANA.withdraw(spareIn);
        }

        /// @dev Transfer spare tokens to recipients
        if (spareIn > 0) {
            if (params.tokenIn == VANA) {
                payable(params.spareTokenInRecipient).sendValue(spareIn);
            } else {
                IERC20(params.tokenIn).safeTransfer(params.spareTokenInRecipient, spareIn);
            }
        }
        if (spareOut > 0) {
            if (params.tokenOut == VANA) {
                WVANA.withdraw(spareOut);
                payable(params.tokenOutRecipient).sendValue(spareOut);
            } else {
                IERC20(params.tokenOut).safeTransfer(params.tokenOutRecipient, spareOut);
            }
        }
    }
}
