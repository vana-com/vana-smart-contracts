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
 * @notice Implements a buy-and-burn mechanism with greedy swap strategy and optional LP addition
 * @dev This contract facilitates the conversion of data access fees into DLP token burns by:
 *      1. Taking VANA tokens as input
 *      2. GREEDILY swapping as much as possible to DLP tokens (within price impact limits)
 *      3. If VANA remains, adding it as liquidity to a Uniswap V3 position
 *      4. Sending all remaining DLP tokens to a burn address
 *
 * Key Strategy - GREEDY BUY-AND-BURN:
 * - Priority: Maximize tokenOut (DLP) for burning
 * - Secondary: Use leftover tokenIn (VANA) for LP if any remains
 * - If pool has sufficient liquidity, entire amount can be swapped → no LP needed
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

    /// @notice Swaps tokens using greedy strategy and optionally adds liquidity
    /// @param params Struct containing all parameters for the operation
    /// @return liquidityDelta Amount of liquidity added to the position (0 if no LP added)
    /// @return spareIn Amount of input token not used (sent to spareTokenInRecipient)
    /// @return spareOut Amount of output token not used for liquidity (sent to tokenOutRecipient for burning)
    /// @dev GREEDY STRATEGY:
    ///      1. Quote swapping the ENTIRE params.amountIn within singleBatchImpactThreshold
    ///      2. Execute swap for maximum possible amount (priority: maximize tokenOut)
    ///      3. If tokenIn remains after swap, try to add it to LP position
    ///      4. Send all remaining tokenOut to burn address (tokenOutRecipient)
    ///
    /// Example scenarios:
    /// - Good liquidity: Entire amount swapped → all tokenOut to burn, no LP
    /// - Limited liquidity: Partial swap → leftover tokenIn added to LP, rest tokenOut to burn
    /// - LP fails: Leftover tokenIn treated as spare, sent to spareTokenInRecipient
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

        // Get LP position details
        (, , , , , int24 tickLower, int24 tickUpper, , , , , ) = positionManager.positions(params.lpTokenId);

        // Convert VANA to WVANA addresses for pool interactions
        IWVANA WVANA = swapHelper.WVANA();
        address tokenIn = params.tokenIn == VANA ? address(WVANA) : params.tokenIn;
        address tokenOut = params.tokenOut == VANA ? address(WVANA) : params.tokenOut;

        // Get current pool state for swap
        IUniswapV3Pool pool = swapHelper.getPool(tokenIn, tokenOut, params.fee);
        (uint160 currentSqrtPriceX96, , , , , , ) = pool.slot0();
        uint128 currentLiquidity = pool.liquidity();

        // Determine swap direction based on token addresses (Uniswap convention: token0 < token1)
        bool zeroForOne = tokenIn < tokenOut;

        uint256 amountSwapIn;
        uint256 amountSwapOut;

        // Track WVANA balance before swap to detect return format (WVANA vs native VANA)
        uint256 wvanaBalanceBefore = params.tokenOut == VANA ? IERC20(address(WVANA)).balanceOf(address(this)) : 0;

        // GREEDY STRATEGY: Quote swapping the ENTIRE amount to maximize tokenOut
        // The quote will respect singleBatchImpactThreshold and return the max swappable amount
        ISwapHelper.Quote memory quote = swapHelper.quoteSlippageExactInputSingle(
            ISwapHelper.QuoteSlippageExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: params.fee,
                amountIn: params.amountIn,  // Quote the FULL amount (greedy)
                sqrtPriceX96: currentSqrtPriceX96,
                liquidity: currentLiquidity,
                maximumSlippagePercentage: params.singleBatchImpactThreshold
            })
        );

        // The quote returns the maximum amount we can swap within price impact limits
        amountSwapIn = quote.amountToPay;  // This will be ≤ params.amountIn

        // Execute swap if we have a valid amount
        if (amountSwapIn > 0) {
            // Approve swapHelper if tokenIn is ERC20
            if (params.tokenIn != VANA) {
                IERC20(params.tokenIn).forceApprove(address(swapHelper), amountSwapIn);
            }

            // Execute swap with slippage protection using perSwapSlippageCap
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

        // Calculate leftover tokenIn (what wasn't swapped)
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

        // Try to add liquidity with leftover tokenIn (if any)
        if (amountLpIn > 0) {
            // Determine token0 and token1 based on swap direction
            address token0 = zeroForOne ? tokenIn : tokenOut;
            address token1 = zeroForOne ? tokenOut : tokenIn;

            // We only add the leftover tokenIn to LP (greedy strategy prioritizes burn over LP)
            // Uniswap V3 can handle one-sided liquidity when price is outside range
            uint256 amount0Desired = zeroForOne ? amountLpIn : 0;
            uint256 amount1Desired = zeroForOne ? 0 : amountLpIn;

            // Check balances
            uint256 token0Balance = IERC20(token0).balanceOf(address(this));
            uint256 token1Balance = IERC20(token1).balanceOf(address(this));

            // Verify we have sufficient balance for what we're trying to add
            require(
                token0Balance >= amount0Desired,
                BuyAndBurnSwap__InsufficientAmount(token0, amount0Desired, token0Balance)
            );
            require(
                token1Balance >= amount1Desired,
                BuyAndBurnSwap__InsufficientAmount(token1, amount1Desired, token1Balance)
            );

            // Approve position manager to spend tokens
            if (amount0Desired > 0) {
                IERC20(token0).forceApprove(address(positionManager), amount0Desired);
            }
            if (amount1Desired > 0) {
                IERC20(token1).forceApprove(address(positionManager), amount1Desired);
            }

            // Try to add liquidity with leftover tokenIn
            // This may fail if amount is too small or position requires both tokens
            // In that case, we'll just treat the leftover as spare (aligned with greedy strategy)
            try positionManager.increaseLiquidity(
                INonfungiblePositionManager.IncreaseLiquidityParams({
                    tokenId: params.lpTokenId,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired,
                    amount0Min: 0, // No minimum to allow price movement
                    amount1Min: 0, // No minimum to allow price movement
                    deadline: block.timestamp
                })
            ) returns (uint128 liquidity, uint256 amount0, uint256 amount1) {
                // Successfully added liquidity
                liquidityDelta = liquidity;

                // Calculate spare tokenIn (what wasn't used for LP)
                spareIn = zeroForOne ? amount0Desired - amount0 : amount1Desired - amount1;
            } catch {
                // Failed to add liquidity (amount too small, position constraints, etc.)
                // Treat all leftover tokenIn as spare - this aligns with greedy strategy
                // where LP is optional and burn is the priority
                spareIn = amountLpIn;
                liquidityDelta = 0;
            }
        } else {
            // No leftover tokenIn, so nothing to add to LP
            spareIn = 0;
            liquidityDelta = 0;
        }

        // ALL tokenOut goes to burn (not used for LP in greedy strategy)
        spareOut = amountSwapOut;

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

        // Transfer all tokenOut to burn address (greedy strategy: maximize burn)
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
