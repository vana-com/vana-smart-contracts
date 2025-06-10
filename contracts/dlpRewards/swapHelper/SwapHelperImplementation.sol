// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@uniswap/v3-core/contracts/libraries/FixedPoint96.sol";
import "@uniswap/v3-core/contracts/libraries/FixedPoint128.sol";
import "@uniswap/v3-core/contracts/libraries/BitMath.sol";
import "@uniswap/v3-core/contracts/libraries/LowGasSafeMath.sol";
import "@uniswap/v3-core/contracts/libraries/LiquidityMath.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IPeripheryImmutableState.sol";
import "@uniswap/swap-router-contracts/contracts/interfaces/IV3SwapRouter.sol";
import "./libraries/PoolAddress.sol";
import "./libraries/TickMath.sol";
import "./libraries/SwapMath.sol";
import "./interfaces/SwapHelperStorageV1.sol";

contract SwapHelperImplementation is UUPSUpgradeable, AccessControlUpgradeable, SwapHelperStorageV1 {
    using SafeERC20 for IERC20;
    using LowGasSafeMath for uint256;
    using LowGasSafeMath for int256;
    using SafeCast for uint256;
    using Address for address payable;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    address public constant VANA = address(0);
    uint256 public constant ONE_HUNDRED_PERCENT = 100e18;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    receive() external payable {}

    /// @notice Initializes the contract
    function initialize(
        address ownerAddress,
        address initUniswapV3Router,
        IQuoterV2 initUniswapV3Quoter
    ) external initializer {
        __UUPSUpgradeable_init();
        __AccessControl_init();

        require(ownerAddress != address(0), SwapHelper__ZeroAddress());

        /// @dev We allow the initial UniswapV3Router to be zero address
        /// to have the same SwapHelper address for all networks (because
        /// UniswapV3Router addresses are different on mainnet and Moksha).
        if (initUniswapV3Router != address(0)) {
            uniswapV3Router = initUniswapV3Router;
            WVANA = IWVANA(IPeripheryImmutableState(uniswapV3Router).WETH9());
        }
        uniswapV3Quoter = initUniswapV3Quoter;

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    /// @notice Upgrades the contract to a new implementation
    /// @param newImplementation The address of the new implementation
    /// @dev This function is called by the UUPS proxy to authorize upgrades
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure override returns (uint256) {
        return 1;
    }

    function updateUniswapV3Router(address newUniswapV3Router) external onlyRole(MAINTAINER_ROLE) {
        if (newUniswapV3Router == address(0)) revert SwapHelper__ZeroAddress();
        uniswapV3Router = newUniswapV3Router;
        WVANA = IWVANA(IPeripheryImmutableState(uniswapV3Router).WETH9());
    }

    function updateUniswapV3Quoter(IQuoterV2 newUniswapV3Quoter) external onlyRole(MAINTAINER_ROLE) {
        if (address(newUniswapV3Quoter) == address(0)) revert SwapHelper__ZeroAddress();
        uniswapV3Quoter = newUniswapV3Quoter;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) public view returns (IUniswapV3Pool) {
        tokenA = tokenA == VANA ? address(WVANA) : tokenA;
        tokenB = tokenB == VANA ? address(WVANA) : tokenB;
        return
            IUniswapV3Pool(
                PoolAddress.computeAddress(
                    IPeripheryImmutableState(uniswapV3Router).factory(),
                    PoolAddress.getPoolKey(tokenA, tokenB, fee)
                )
            );
    }

    function _exactInputSingle(
        ExactInputSingleParams memory params,
        uint160 sqrtPriceLimitX96
    ) internal returns (uint256 amountInUsed, uint256 amountOut) {
        require(params.recipient != address(0), SwapHelper__ZeroAddress());

        bool isVANATokenIn = params.tokenIn == VANA;

        // Transfer tokenIn from the caller to this contract
        if (isVANATokenIn) {
            require(params.amountIn == msg.value, SwapHelper__InvalidAmountIn());
            WVANA.deposit{value: msg.value}();
        } else {
            IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        }

        bool isVANATokenOut = params.tokenOut == VANA;

        address tokenIn = isVANATokenIn ? address(WVANA) : params.tokenIn;
        address tokenOut = isVANATokenOut ? address(WVANA) : params.tokenOut;
        /// @dev If the tokenOut is VANA, we send the output WVANA to this contract,
        /// so that WVANA can be converted to VANA before sending to the recipient.
        address recipient = isVANATokenOut ? address(this) : params.recipient;

        // Approve the Uniswap router to spend tokenIn
        IERC20(tokenIn).forceApprove(uniswapV3Router, params.amountIn);

        uint256 tokenInBalanceBefore = IERC20(tokenIn).balanceOf(address(this));

        // Perform the swap using Uniswap V3's exactInputSingle function
        IV3SwapRouter.ExactInputSingleParams memory swapParams = IV3SwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: params.fee,
            recipient: recipient,
            amountIn: params.amountIn,
            amountOutMinimum: params.amountOutMinimum,
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });
        amountOut = IV3SwapRouter(uniswapV3Router).exactInputSingle(swapParams);

        uint256 tokenInBalanceAfter = IERC20(tokenIn).balanceOf(address(this));
        amountInUsed = tokenInBalanceBefore - tokenInBalanceAfter;

        emit Swap(msg.sender, params.recipient, tokenIn, amountInUsed, tokenOut, amountOut);

        if (amountInUsed < params.amountIn) {
            uint256 amountInLeft = params.amountIn - amountInUsed;
            // Refund the remaining tokenIn to the caller
            if (isVANATokenIn) {
                WVANA.withdraw(amountInLeft);
                payable(msg.sender).sendValue(amountInLeft);
            } else {
                IERC20(tokenIn).safeTransfer(msg.sender, amountInLeft);
            }
        }

        if (isVANATokenOut) {
            // Withdraw WVANA to get VANA
            WVANA.withdraw(amountOut);
            // Transfer VANA to the recipient
            payable(params.recipient).sendValue(amountOut);
        }
    }

    /// @inheritdoc ISwapHelper
    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable override returns (uint256 amountOut) {
        (, amountOut) = _exactInputSingle(params, 0);
    }

    function _getSqrtPriceLimitX96(
        bool zeroForOne,
        uint160 currentSqrtPriceX96,
        uint256 maximumSlippagePercentage
    ) internal pure returns (uint160 sqrtPriceLimitX96) {
        require(maximumSlippagePercentage <= ONE_HUNDRED_PERCENT, SwapHelper__InvalidSlippagePercentage());

        uint256 slippageFactor = zeroForOne
            ? ONE_HUNDRED_PERCENT - maximumSlippagePercentage
            : ONE_HUNDRED_PERCENT + maximumSlippagePercentage;

        uint256 slippageFactorScaled = Math.mulDiv(
            slippageFactor,
            (1 << (2 * FixedPoint96.RESOLUTION)),
            ONE_HUNDRED_PERCENT
        );
        uint256 sqrtSlippageFactorX96 = Math.sqrt(slippageFactorScaled);
        sqrtPriceLimitX96 = Math
            .mulDiv(uint256(currentSqrtPriceX96), sqrtSlippageFactorX96, FixedPoint96.Q96)
            .toUint160();
    }

    /// @inheritdoc ISwapHelper
    function slippageExactInputSingle(
        SlippageSwapParams calldata params
    ) external payable override returns (uint256 amountInUsed, uint256 amountOut) {
        address tokenIn = params.tokenIn == VANA ? address(WVANA) : params.tokenIn;
        address tokenOut = params.tokenOut == VANA ? address(WVANA) : params.tokenOut;

        IUniswapV3Pool pool = getPool(tokenIn, tokenOut, params.fee);
        (uint160 currentSqrtPriceX96, , , , , , ) = pool.slot0();

        uint160 sqrtPriceLimitX96 = _getSqrtPriceLimitX96(
            tokenIn < tokenOut,
            currentSqrtPriceX96,
            params.maximumSlippagePercentage
        );

        (amountInUsed, amountOut) = _exactInputSingle(
            ExactInputSingleParams({
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                fee: params.fee,
                recipient: params.recipient,
                amountIn: params.amountIn,
                amountOutMinimum: 0
            }),
            sqrtPriceLimitX96
        );
    }

    /// @inheritdoc ISwapHelper
    function quoteExactInputSingle(
        QuoteExactInputSingleParams calldata params
    ) external override returns (uint256 amountOut) {
        address tokenIn = params.tokenIn == VANA ? address(WVANA) : params.tokenIn;
        address tokenOut = params.tokenOut == VANA ? address(WVANA) : params.tokenOut;

        (amountOut, , , ) = uniswapV3Quoter.quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: params.fee,
                amountIn: params.amountIn,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function quoteSlippageExactInputSingle(
        QuoteSlippageExactInputSingleParams calldata params
    ) external view override returns (Quote memory quote) {
        address tokenIn = params.tokenIn == VANA ? address(WVANA) : params.tokenIn;
        address tokenOut = params.tokenOut == VANA ? address(WVANA) : params.tokenOut;

        bool zeroForOne = tokenIn < tokenOut;

        IUniswapV3Pool pool = getPool(tokenIn, tokenOut, params.fee);

        uint128 liquidity = params.liquidity;
        if (liquidity == 0) {
            liquidity = pool.liquidity();
        }
        uint160 sqrtPriceX96 = params.sqrtPriceX96;
        if (sqrtPriceX96 == 0) {
            (sqrtPriceX96, , , , , , ) = pool.slot0();
        }

        Slot0 memory slot0Start = Slot0({
            sqrtPriceX96: sqrtPriceX96,
            tick: TickMath.getTickAtSqrtRatio(sqrtPriceX96),
            liquidity: liquidity
        });

        uint160 sqrtPriceLimitX96 = _getSqrtPriceLimitX96(zeroForOne, sqrtPriceX96, params.maximumSlippagePercentage);

        return simulateSwap(pool, zeroForOne, params.amountIn.toInt256(), sqrtPriceLimitX96, slot0Start);
    }

    /// @notice Computes the position in the mapping where the initialized bit for a tick lives
    /// @param tick The tick for which to compute the position
    /// @return wordPos The key in the mapping containing the word in which the bit is stored
    /// @return bitPos The bit position in the word where the flag is stored
    function position(int24 tick) internal pure returns (int16 wordPos, uint8 bitPos) {
        assembly ("memory-safe") {
            // signed arithmetic shift right
            wordPos := sar(8, signextend(2, tick)) // tick >> 8
            bitPos := and(tick, 0xff) // tick % 256
        }
    }

    /// @notice Returns the next initialized tick contained in the same word (or adjacent word) as the tick that is either
    /// to the left (less than or equal to) or right (greater than) of the given tick
    /// @param pool The pool address
    /// @param tick The starting tick
    /// @param tickSpacing The spacing between usable ticks
    /// @param lte Whether to search for the next initialized tick to the left (less than or equal to the starting tick)
    /// @return next The next initialized or uninitialized tick up to 256 ticks away from the current tick
    /// @return initialized Whether the next tick is initialized, as the function only searches within up to 256 ticks
    function nextInitializedTickWithinOneWord(
        IUniswapV3Pool pool,
        int24 tick,
        int24 tickSpacing,
        bool lte
    ) internal view returns (int24 next, bool initialized) {
        int24 compressed = tick / tickSpacing;
        if (tick < 0 && tick % tickSpacing != 0) compressed--; // round towards negative infinity

        if (lte) {
            (int16 wordPos, uint8 bitPos) = position(compressed);
            // all the 1s at or to the right of the current bitPos
            uint256 mask = (1 << bitPos) - 1 + (1 << bitPos);
            uint256 masked = pool.tickBitmap(wordPos) & mask;

            // if there are no initialized ticks to the right of or at the current tick, return rightmost in the word
            initialized = masked != 0;
            // overflow/underflow is possible, but prevented externally by limiting both tickSpacing and tick
            next = initialized
                ? (compressed - int24(uint24(bitPos - BitMath.mostSignificantBit(masked)))) * tickSpacing
                : (compressed - int24(uint24(bitPos))) * tickSpacing;
        } else {
            // start from the word of the next tick, since the current tick state doesn't matter
            (int16 wordPos, uint8 bitPos) = position(compressed + 1);
            // all the 1s at or to the left of the bitPos
            uint256 mask = ~((1 << bitPos) - 1);
            uint256 masked = pool.tickBitmap(wordPos) & mask;

            // if there are no initialized ticks to the left of the current tick, return leftmost in the word
            initialized = masked != 0;
            // overflow/underflow is possible, but prevented externally by limiting both tickSpacing and tick
            next = initialized
                ? (compressed + 1 + int24(uint24(BitMath.leastSignificantBit(masked) - bitPos))) * tickSpacing
                : (compressed + 1 + int24(uint24(type(uint8).max - bitPos))) * tickSpacing;
        }
    }

    struct Slot0 {
        // the current priceT
        uint160 sqrtPriceX96;
        // the current tick
        int24 tick;
        // // the most-recently updated index of the observations array
        // uint16 observationIndex;
        // // the current maximum number of observations that are being stored
        // uint16 observationCardinality;
        // // the next maximum number of observations to store, triggered in observations.write
        // uint16 observationCardinalityNext;
        // // the current protocol fee as a percentage of the swap fee taken on withdrawal
        // // represented as an integer denominator (1/x)%
        // uint8 feeProtocol;
        // // whether the pool is locked
        // bool unlocked;
        // the current liquidity in the pool
        uint128 liquidity;
    }

    function slot0(IUniswapV3Pool pool) internal view returns (Slot0 memory _slot0) {
        (_slot0.sqrtPriceX96, _slot0.tick, , , , , ) = pool.slot0();
        _slot0.liquidity = pool.liquidity();
    }

    // the top level state of the swap, the results of which are recorded in storage at the end
    struct SwapState {
        // the amount remaining to be swapped in/out of the input/output asset
        int256 amountSpecifiedRemaining;
        // the amount already swapped out/in of the output/input asset
        int256 amountCalculated;
        // current sqrt(price)
        uint160 sqrtPriceX96;
        // the tick associated with the current price
        int24 tick;
        // the current liquidity in range
        uint128 liquidity;
    }

    struct StepComputations {
        // the price at the beginning of the step
        uint160 sqrtPriceStartX96;
        // the next tick to swap to from the current tick in the swap direction
        int24 tickNext;
        // whether tickNext is initialized or not
        bool initialized;
        // sqrt(price) for the next tick (1/0)
        uint160 sqrtPriceNextX96;
        // how much is being swapped in in this step
        uint256 amountIn;
        // how much is being swapped out
        uint256 amountOut;
        // how much fee is being paid in
        uint256 feeAmount;
    }

    function simulateSwap(
        IUniswapV3Pool pool,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        Slot0 memory slot0Start
    ) public view returns (Quote memory quote) {
        require(amountSpecified != 0, Uniswap__AS());

        sqrtPriceLimitX96 = sqrtPriceLimitX96 == 0
            ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
            : sqrtPriceLimitX96;

        if (slot0Start.sqrtPriceX96 == 0) {
            slot0Start = slot0(pool);
        }

        require(
            zeroForOne
                ? sqrtPriceLimitX96 < slot0Start.sqrtPriceX96 && sqrtPriceLimitX96 > TickMath.MIN_SQRT_RATIO
                : sqrtPriceLimitX96 > slot0Start.sqrtPriceX96 && sqrtPriceLimitX96 < TickMath.MAX_SQRT_RATIO,
            Uniswap__SPL()
        );

        uint24 fee = pool.fee();

        int24 tickSpacing = pool.tickSpacing();

        bool exactInput = amountSpecified > 0;

        SwapState memory state = SwapState({
            amountSpecifiedRemaining: amountSpecified,
            amountCalculated: 0,
            sqrtPriceX96: slot0Start.sqrtPriceX96,
            tick: slot0Start.tick,
            liquidity: slot0Start.liquidity
        });

        // continue swapping as long as we haven't used the entire input/output and haven't reached the price limit
        while (state.amountSpecifiedRemaining != 0 && state.sqrtPriceX96 != sqrtPriceLimitX96) {
            StepComputations memory step;

            step.sqrtPriceStartX96 = state.sqrtPriceX96;

            (step.tickNext, step.initialized) = nextInitializedTickWithinOneWord(
                pool,
                state.tick,
                tickSpacing,
                zeroForOne
            );

            // ensure that we do not overshoot the min/max tick, as the tick bitmap is not aware of these bounds
            if (step.tickNext < TickMath.MIN_TICK) {
                step.tickNext = TickMath.MIN_TICK;
            } else if (step.tickNext > TickMath.MAX_TICK) {
                step.tickNext = TickMath.MAX_TICK;
            }

            // get the price for the next tick
            step.sqrtPriceNextX96 = TickMath.getSqrtRatioAtTick(step.tickNext);

            // compute values to swap to the target tick, price limit, or point where input/output amount is exhausted
            (state.sqrtPriceX96, step.amountIn, step.amountOut, step.feeAmount) = SwapMath.computeSwapStep(
                state.sqrtPriceX96,
                (zeroForOne ? step.sqrtPriceNextX96 < sqrtPriceLimitX96 : step.sqrtPriceNextX96 > sqrtPriceLimitX96)
                    ? sqrtPriceLimitX96
                    : step.sqrtPriceNextX96,
                state.liquidity,
                state.amountSpecifiedRemaining,
                fee
            );

            if (exactInput) {
                state.amountSpecifiedRemaining -= (step.amountIn + step.feeAmount).toInt256();
                state.amountCalculated = state.amountCalculated.sub(step.amountOut.toInt256());
            } else {
                state.amountSpecifiedRemaining += step.amountOut.toInt256();
                state.amountCalculated = state.amountCalculated.add((step.amountIn + step.feeAmount).toInt256());
            }

            // shift tick if we reached the next price
            if (state.sqrtPriceX96 == step.sqrtPriceNextX96) {
                // if the tick is initialized, run the tick transition
                if (step.initialized) {
                    (, int128 liquidityNet, , , , , , ) = pool.ticks(step.tickNext);

                    // if we're moving leftward, we interpret liquidityNet as the opposite sign
                    // safe because liquidityNet cannot be type(int128).min
                    if (zeroForOne) liquidityNet = -liquidityNet;

                    state.liquidity = LiquidityMath.addDelta(state.liquidity, liquidityNet);
                }

                state.tick = zeroForOne ? step.tickNext - 1 : step.tickNext;
            } else if (state.sqrtPriceX96 != step.sqrtPriceStartX96) {
                // recompute unless we're on a lower tick boundary (i.e. already transitioned ticks), and haven't moved
                state.tick = TickMath.getTickAtSqrtRatio(state.sqrtPriceX96);
            }
        }

        (int256 amount0Delta, int256 amount1Delta) = zeroForOne == exactInput
            ? (amountSpecified - state.amountSpecifiedRemaining, state.amountCalculated)
            : (state.amountCalculated, amountSpecified - state.amountSpecifiedRemaining);

        (uint256 amountToPay, uint256 amountReceived) = zeroForOne
            ? (uint256(amount0Delta), uint256(-amount1Delta))
            : (uint256(amount1Delta), uint256(-amount0Delta));

        quote = Quote({
            amount0Delta: amount0Delta,
            amount1Delta: amount1Delta,
            amountToPay: amountToPay,
            amountReceived: amountReceived,
            sqrtPriceX96After: state.sqrtPriceX96,
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });
    }
}
