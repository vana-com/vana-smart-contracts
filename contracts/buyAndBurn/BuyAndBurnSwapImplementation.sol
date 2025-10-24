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

/**
 * @title BuyAndBurnSwapImplementation
 * @notice Implements a buy-and-burn mechanism that swaps tokens and adds liquidity to Uniswap V3 positions
 * @dev This contract facilitates the conversion of data access fees into DLP token burns by:
 *      1. Taking VANA tokens as input
 *      2. Swapping a calculated portion to DLP tokens
 *      3. Adding both tokens as liquidity to a Uniswap V3 position
 *      4. Sending spare DLP tokens to a burn address
 *      5. Returning spare VANA to a treasury
 *
 * Key features:
 * - Position-aware swap calculation optimizes token ratios based on pool price and LP range
 * - Supports both native VANA and ERC20 tokens as input/output
 * - Handles WVANA wrapping/unwrapping automatically
 * - Protects against excessive price impact and slippage
 * - Upgradeable via UUPS pattern
 *
 * Access control:
 * - DEFAULT_ADMIN_ROLE: Can upgrade contract and grant roles
 * - MAINTAINER_ROLE: Can pause/unpause and update helper contracts
 */
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
    address public constant VANA = address(0); // Represents native VANA token
    uint256 public constant ONE_HUNDRED_PERCENT = 100e18; // 100% in 18 decimal fixed point

    /// @notice Allows contract to receive native VANA
    receive() external payable {}

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the contract with required dependencies and roles
    /// @param ownerAddress Address that will receive DEFAULT_ADMIN_ROLE and MAINTAINER_ROLE
    /// @param initSwapHelper SwapHelper contract for executing token swaps
    /// @param initPositionManager Uniswap V3 NonfungiblePositionManager for LP operations
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

    /// @notice Authorizes contract upgrades
    /// @param newImplementation Address of the new implementation contract
    /// @dev Only callable by DEFAULT_ADMIN_ROLE
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {
        /// @dev Access control is handled by the onlyRole modifier
        /// No additional validation needed
    }

    /// @notice Returns the current contract version
    /// @return Contract version number
    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    /// @notice Pauses all swap and liquidity operations
    /// @dev Only callable by MAINTAINER_ROLE
    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    /// @notice Resumes all swap and liquidity operations
    /// @dev Only callable by MAINTAINER_ROLE
    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    /// @notice Updates the SwapHelper contract address
    /// @param newSwapHelper Address of the new SwapHelper contract
    /// @dev Only callable by MAINTAINER_ROLE, reverts if zero address
    function updateSwapHelper(ISwapHelper newSwapHelper) external override onlyRole(MAINTAINER_ROLE) {
        require(address(newSwapHelper) != address(0), BuyAndBurnSwap__ZeroAddress());
        swapHelper = newSwapHelper;
    }

    /// @notice Updates the Uniswap V3 PositionManager contract address
    /// @param newPositionManager Address of the new PositionManager contract
    /// @dev Only callable by MAINTAINER_ROLE, reverts if zero address
    function updatePositionManager(
        INonfungiblePositionManager newPositionManager
    ) external override onlyRole(MAINTAINER_ROLE) {
        require(address(newPositionManager) != address(0), BuyAndBurnSwap__ZeroAddress());
        positionManager = newPositionManager;
    }

    /// @notice Calculates optimal swap amount based on pool price position and LP range
    /// @param amountIn Total input amount available for swapping and LP
    /// @param currentSqrtPriceX96 Current pool price in sqrt(price) * 2^96 format
    /// @param sqrtRatioLowerX96 Lower bound of LP position range in sqrt(price) * 2^96
    /// @param sqrtRatioUpperX96 Upper bound of LP position range in sqrt(price) * 2^96
    /// @param zeroForOne Swap direction: true = token0→token1, false = token1→token0
    /// @return Recommended amount to swap (remainder goes directly to LP)
    /// @dev Strategy:
    ///      - Price outside range in favorable direction: 0% swap (no swap needed)
    ///      - Price below range: 25% swap if token0→token1, 75% if token1→token0
    ///      - Price above range: 75% swap if token0→token1, 25% if token1→token0
    ///      - Price in range: 50% swap (balanced approach)
    function calculateSwapAmount(
        uint256 amountIn,
        uint160 currentSqrtPriceX96,
        uint160 sqrtRatioLowerX96,
        uint160 sqrtRatioUpperX96,
        bool zeroForOne
    ) internal pure returns (uint256) {
        // No swap needed if price is outside range in the "right" direction
        // (already have the token the position needs most)
        if ((currentSqrtPriceX96 <= sqrtRatioLowerX96 && zeroForOne) ||
            (currentSqrtPriceX96 >= sqrtRatioUpperX96 && !zeroForOne)) {
            return 0;
        }

        // Determine optimal swap percentage based on price position and direction
        if (currentSqrtPriceX96 < sqrtRatioLowerX96) {
            // Price below range → LP position needs more token0
            if (zeroForOne) {
                // Swapping token0→token1: keep most token0, swap 25%
                return amountIn / 4;
            } else {
                // Swapping token1→token0: need to acquire token0, swap 75%
                return (amountIn * 3) / 4;
            }
        } else if (currentSqrtPriceX96 > sqrtRatioUpperX96) {
            // Price above range → LP position needs more token1
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

    /// @notice Swaps tokens and adds liquidity to a Uniswap V3 position in a single transaction
    /// @param params Struct containing all parameters for the operation
    /// @return liquidityDelta Amount of liquidity added to the position
    /// @return spareIn Amount of input token not used for liquidity (sent to spareTokenInRecipient)
    /// @return spareOut Amount of output token not used for liquidity (sent to tokenOutRecipient)
    /// @dev Process flow:
    ///      1. Transfer input tokens from caller
    ///      2. Calculate optimal swap amount based on pool price and LP position range
    ///      3. Execute swap with slippage protection
    ///      4. Handle WVANA wrapping/unwrapping as needed
    ///      5. Add liquidity to the specified LP position
    ///      6. Send spare tokens to designated recipients
    ///
    /// Requirements:
    /// - Caller must approve this contract for the LP position NFT
    /// - If tokenIn is VANA, msg.value must equal params.amountIn
    /// - If tokenIn is ERC20, caller must approve this contract for params.amountIn
    /// - Contract must not be paused
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
            // For native VANA, verify msg.value matches amountIn
            require(msg.value >= params.amountIn, BuyAndBurnSwap__InsufficientAmount(VANA, params.amountIn, msg.value));
        } else {
            // For ERC20, transfer from caller to this contract
            IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        }

        // Get LP position details to determine tick range
        (, , , , , int24 tickLower, int24 tickUpper, , , , , ) = positionManager.positions(params.lpTokenId);
        uint160 sqrtRatioLowerX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioUpperX96 = TickMath.getSqrtRatioAtTick(tickUpper);

        // Convert VANA to WVANA addresses for pool interactions
        IWVANA WVANA = swapHelper.WVANA();
        address tokenIn = params.tokenIn == VANA ? address(WVANA) : params.tokenIn;
        address tokenOut = params.tokenOut == VANA ? address(WVANA) : params.tokenOut;

        // Get current pool state for swap calculation
        IUniswapV3Pool pool = swapHelper.getPool(tokenIn, tokenOut, params.fee);
        (uint160 currentSqrtPriceX96, , , , , , ) = pool.slot0();
        uint128 currentLiquidity = pool.liquidity();

        // Determine swap direction based on token addresses (Uniswap convention: token0 < token1)
        bool zeroForOne = tokenIn < tokenOut;

        uint256 amountSwapIn;
        uint256 amountSwapOut;

        // Track WVANA balance before swap to detect what format swap returns (WVANA vs native VANA)
        uint256 wvanaBalanceBefore = params.tokenOut == VANA ? IERC20(address(WVANA)).balanceOf(address(this)) : 0;

        // Calculate optimal swap amount based on pool price position relative to LP range
        uint256 targetSwapAmount = calculateSwapAmount(
            params.amountIn,
            currentSqrtPriceX96,
            sqrtRatioLowerX96,
            sqrtRatioUpperX96,
            zeroForOne
        );

        if (targetSwapAmount > 0) {
            // Quote the swap to check price impact and get actual executable amount
            // Uses singleBatchImpactThreshold to limit price impact
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

            // Use the amount from quote (may be reduced if price impact too high)
            amountSwapIn = quote.amountToPay;

            // Execute swap if we have a valid amount
            if (amountSwapIn > 0) {
                // Approve swapHelper if tokenIn is ERC20
                if (params.tokenIn != VANA) {
                    IERC20(params.tokenIn).forceApprove(address(swapHelper), amountSwapIn);
                }

                // Execute swap with slippage protection using perSwapSlippageCap
                // SwapHelper handles both VANA and ERC20 tokens appropriately
                (uint256 amountSwapInUsed, uint256 amountReceived) = swapHelper.slippageExactInputSingle{
                        value: params.tokenIn == VANA ? amountSwapIn : 0
                    }(
                    ISwapHelper.SlippageSwapParams({
                        tokenIn: params.tokenIn,    // Use original address (VANA or ERC20)
                        tokenOut: params.tokenOut,  // Use original address (VANA or ERC20)
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

        // Calculate amount going directly to LP (not swapped)
        uint256 amountLpIn = params.amountIn - amountSwapIn;

        // Wrap VANA to WVANA for LP if tokenIn is native VANA
        if (params.tokenIn == VANA && amountLpIn > 0) {
            WVANA.deposit{value: amountLpIn}();
        }

        // Handle WVANA wrapping for tokenOut based on what SwapHelper returned
        if (params.tokenOut == VANA && amountSwapOut > 0) {
            // Check if swap returned WVANA or native VANA
            uint256 wvanaBalanceAfter = IERC20(address(WVANA)).balanceOf(address(this));
            uint256 wvanaReceived = wvanaBalanceAfter > wvanaBalanceBefore ? wvanaBalanceAfter - wvanaBalanceBefore : 0;

            // If we received less WVANA than expected, wrap the native VANA we received
            if (wvanaReceived < amountSwapOut) {
                uint256 ethToWrap = amountSwapOut - wvanaReceived;
                require(address(this).balance >= ethToWrap, "Insufficient ETH received from swap");
                WVANA.deposit{value: ethToWrap}();
            }
        }

        // Determine token0 and token1 based on swap direction (Uniswap ordering)
        address token0 = zeroForOne ? tokenIn : tokenOut;
        address token1 = zeroForOne ? tokenOut : tokenIn;

        // Calculate amounts for each token in Uniswap V3 position
        uint256 amount0Desired = zeroForOne ? amountLpIn : amountSwapOut;
        uint256 amount1Desired = zeroForOne ? amountSwapOut : amountLpIn;

        // Check if we have meaningful amounts for liquidity addition
        // Uniswap V3 concentrated liquidity can accept one-sided deposits when price is outside range
        bool hasMinimumLiquidity = amount0Desired > 0 || amount1Desired > 0;

        if (hasMinimumLiquidity) {
            // Verify we have sufficient balances
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

            // Approve position manager to spend tokens
            IERC20(token0).forceApprove(address(positionManager), amount0Desired);
            IERC20(token1).forceApprove(address(positionManager), amount1Desired);

            // Add liquidity to the position
            // Position manager will use as much as it can based on current price
            uint256 amount0;
            uint256 amount1;
            (liquidityDelta, amount0, amount1) = positionManager.increaseLiquidity(
                INonfungiblePositionManager.IncreaseLiquidityParams({
                    tokenId: params.lpTokenId,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired,
                    amount0Min: 0, // No minimum to allow price movement
                    amount1Min: 0, // No minimum to allow price movement
                    deadline: block.timestamp
                })
            );

            // Calculate spare amounts (what wasn't used for liquidity)
            spareIn = zeroForOne ? amount0Desired - amount0 : amount1Desired - amount1;
            spareOut = zeroForOne ? amount1Desired - amount1 : amount0Desired - amount0;
        } else {
            // No liquidity to add, all becomes spare
            spareIn = params.amountIn - amountSwapIn;
            spareOut = amountSwapOut;
        }

        // Unwrap WVANA to native VANA for spareIn if needed
        if (params.tokenIn == VANA && spareIn > 0) {
            WVANA.withdraw(spareIn);
        }

        // Transfer spare input tokens to designated recipient
        if (spareIn > 0) {
            if (params.tokenIn == VANA) {
                payable(params.spareTokenInRecipient).sendValue(spareIn);
            } else {
                IERC20(params.tokenIn).safeTransfer(params.spareTokenInRecipient, spareIn);
            }
        }

        // Transfer spare output tokens to designated recipient
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
