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

    /// @notice Calculates the optimal swap amount based on price position and swap direction
    /// @param amountIn Total amount of input token
    /// @param currentSqrtPriceX96 Current pool price
    /// @param sqrtRatioLowerX96 Lower bound of LP position
    /// @param sqrtRatioUpperX96 Upper bound of LP position
    /// @param zeroForOne Direction of swap (true = token0→token1, false = token1→token0)
    /// @return Recommended amount to swap
    function calculateSwapAmount(
        uint256 amountIn,
        uint160 currentSqrtPriceX96,
        uint160 sqrtRatioLowerX96,
        uint160 sqrtRatioUpperX96,
        bool zeroForOne
    ) internal pure returns (uint256) {
        // No swap needed if price is outside range in the "right" direction
        if ((currentSqrtPriceX96 <= sqrtRatioLowerX96 && zeroForOne) ||
            (currentSqrtPriceX96 >= sqrtRatioUpperX96 && !zeroForOne)) {
            return 0;
        }

        // Determine optimal swap percentage based on price position and direction
        if (currentSqrtPriceX96 < sqrtRatioLowerX96) {
            // Price below range → need more token0
            if (zeroForOne) {
                // Swapping token0→token1: keep most token0, swap 25%
                return amountIn / 4;
            } else {
                // Swapping token1→token0: need to acquire token0, swap 75%
                return (amountIn * 3) / 4;
            }
        } else if (currentSqrtPriceX96 > sqrtRatioUpperX96) {
            // Price above range → need more token1
            if (zeroForOne) {
                // Swapping token0→token1: need to acquire token1, swap 75%
                return (amountIn * 3) / 4;
            } else {
                // Swapping token1→token0: keep most token1, swap 25%
                return amountIn / 4;
            }
        } else {
            // Price in range → need both tokens relatively balanced, swap 50%
            return amountIn / 2;
        }
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

        IWVANA WVANA = swapHelper.WVANA();
        address tokenIn = params.tokenIn == VANA ? address(WVANA) : params.tokenIn;
        address tokenOut = params.tokenOut == VANA ? address(WVANA) : params.tokenOut;

        IUniswapV3Pool pool = swapHelper.getPool(tokenIn, tokenOut, params.fee);
        (uint160 currentSqrtPriceX96, , , , , , ) = pool.slot0();
        uint128 currentLiquidity = pool.liquidity();

        bool zeroForOne = tokenIn < tokenOut;

        uint256 amountSwapIn;
        uint256 amountSwapOut;

        // Track WVANA balance before swap to detect if we receive WVANA or native VANA
        uint256 wvanaBalanceBefore = params.tokenOut == VANA ? IERC20(address(WVANA)).balanceOf(address(this)) : 0;

        // Calculate optimal swap amount based on position-aware heuristic
        uint256 targetSwapAmount = calculateSwapAmount(
            params.amountIn,
            currentSqrtPriceX96,
            sqrtRatioLowerX96,
            sqrtRatioUpperX96,
            zeroForOne
        );

        if (targetSwapAmount > 0) {
            // Quote the swap with the calculated target amount
            ISwapHelper.Quote memory quote = swapHelper.quoteSlippageExactInputSingle(
                ISwapHelper.QuoteSlippageExactInputSingleParams({
                    tokenIn: tokenIn,           // Use wrapped address for quoting
                    tokenOut: tokenOut,         // Use wrapped address for quoting
                    fee: params.fee,
                    amountIn: targetSwapAmount,
                    sqrtPriceX96: currentSqrtPriceX96,
                    liquidity: currentLiquidity,
                    maximumSlippagePercentage: params.singleBatchImpactThreshold
                })
            );

            // Use the amount from quote (respects slippage limits)
            amountSwapIn = quote.amountToPay;

            // Execute swap if we have a valid amount
            if (amountSwapIn > 0) {
                // Approve swapHelper if tokenIn is ERC20
                if (params.tokenIn != VANA) {
                    IERC20(params.tokenIn).forceApprove(address(swapHelper), amountSwapIn);
                }

                // Execute swap - SwapHelper handles both VANA and ERC20
                // Use original addresses (params.tokenIn/tokenOut) for execution
                (uint256 amountSwapInUsed, uint256 amountReceived) = swapHelper.slippageExactInputSingle{
                        value: params.tokenIn == VANA ? amountSwapIn : 0
                    }(
                    ISwapHelper.SlippageSwapParams({
                        tokenIn: params.tokenIn,    // Use original address for execution
                        tokenOut: params.tokenOut,  // Use original address for execution
                        fee: params.fee,
                        recipient: address(this),
                        amountIn: amountSwapIn,
                        maximumSlippagePercentage: params.perSwapSlippageCap
                    })
                );
                amountSwapIn = amountSwapInUsed;
                amountSwapOut = amountReceived;
            }
        }

        uint256 amountLpIn = params.amountIn - amountSwapIn;

        // Wrap VANA for tokenIn if needed
        if (params.tokenIn == VANA && amountLpIn > 0) {
            WVANA.deposit{value: amountLpIn}();
        }

        // Handle VANA wrapping for tokenOut based on what SwapHelper returned
        if (params.tokenOut == VANA && amountSwapOut > 0) {
            // Check WVANA balance after swap to see if we received WVANA
            uint256 wvanaBalanceAfter = IERC20(address(WVANA)).balanceOf(address(this));
            uint256 wvanaReceived = wvanaBalanceAfter > wvanaBalanceBefore ? wvanaBalanceAfter - wvanaBalanceBefore : 0;

            // If we received WVANA from the swap, no wrapping needed
            if (wvanaReceived >= amountSwapOut) {
                // Already have WVANA, nothing to do
            } else {
                // We must have received native VANA, wrap it
                uint256 ethToWrap = amountSwapOut - wvanaReceived;
                require(address(this).balance >= ethToWrap, "Insufficient ETH received from swap");
                WVANA.deposit{value: ethToWrap}();
            }
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
