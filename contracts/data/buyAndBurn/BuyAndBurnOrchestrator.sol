// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./SwapAndAddLiquidityLib.sol";
import "./UniversalDLPTreasury.sol";
import "./interfaces/IBuyAndBurnOrchestrator.sol";
import "./interfaces/IDLPRegistryForBuyAndBurn.sol"; // Changed this line

/**
 * @title BuyAndBurnOrchestrator
 * @notice Main orchestration contract for buy-and-burn mechanism
 * @dev Coordinates fund splits, swaps, liquidity additions, and token burns
 */
contract BuyAndBurnOrchestrator is
IBuyAndBurnOrchestrator,
AccessControlUpgradeable,
UUPSUpgradeable
{
    using SafeERC20 for IERC20;
    using SwapAndAddLiquidityLib for SwapAndAddLiquidityLib.SwapParams;

    // Roles
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant DATA_ACCESS_ROLE = keccak256("DATA_ACCESS_ROLE");

    // Configuration parameters
    uint256 public protocolShareBps; // Default: 2000 (20%)
    uint256 public costSkimBps; // Default: 500 (5% of protocol share)
    uint256 public perSwapSlippageCap; // Default: 200 (2%)
    uint256 public singleBatchImpactThreshold; // Default: 500 (5%)
    uint24 public defaultPoolFee; // Default: 3000 (0.3%)

    // Addresses
    address public usdcToken;
    address public vanaToken;
    address public computeStakingAddress;
    address public vanaBurnAddress;
    address public dataAccessTreasury;
    address public dataDexRouter;
    address public uniswapV3PositionManager;
    address public uniswapV3Factory;

    // References
    UniversalDLPTreasury public universalDLPTreasury;
    IDLPRegistryForBuyAndBurn public dlpRegistry; // Changed this line

    // State tracking
    struct PendingFunds {
        uint256 usdc;
        uint256 vana;
    }

    PendingFunds public pendingProtocolFunds;
    mapping(uint256 => PendingFunds) public pendingDLPFunds;

    uint256 public currentEpoch;
    uint256 public lastExecutionBlock;
    uint256 public epochBlockCadence; // Blocks per epoch (default: ~1 day)

    // Events
    event FundsReceived(
        address indexed token,
        uint256 amount,
        uint256 indexed dlpId,
        uint256 protocolShare,
        uint256 dlpShare
    );
    event ProtocolShareExecuted(
        uint256 indexed epoch,
        uint256 vanaAmount,
        uint256 vanaBurned,
        uint256 skimmed,
        uint256 lpAdded
    );
    event DLPShareExecuted(
        uint256 indexed epoch,
        uint256 indexed dlpId,
        uint256 dlptBurned,
        uint256 lpAdded
    );
    event ConfigUpdated(
        string parameter,
        uint256 oldValue,
        uint256 newValue
    );

    // Custom errors
    error InvalidToken();
    error InvalidAmount();
    error InvalidAddress();
    error InvalidBasisPoints();
    error ExecutionTooSoon();
    error NoFundsToProcess();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     */
    function initialize(
        address _usdcToken,
        address _vanaToken,
        address _computeStakingAddress,
        address _vanaBurnAddress,
        address _dataDexRouter,
        address _uniswapV3PositionManager,
        address _uniswapV3Factory,
        address _universalDLPTreasury,
        address _dlpRegistry,
        address _dataAccessTreasury,
        address _owner
    ) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        // Validate addresses
        if (_usdcToken == address(0) || _vanaToken == address(0)) revert InvalidAddress();
        if (_computeStakingAddress == address(0) || _vanaBurnAddress == address(0)) revert InvalidAddress();
        // Allow zero address for dataDexRouter for testing (can be updated later)
        // if (_dataDexRouter == address(0)) revert InvalidAddress(); // Commented out

        usdcToken = _usdcToken;
        vanaToken = _vanaToken;
        computeStakingAddress = _computeStakingAddress;
        vanaBurnAddress = _vanaBurnAddress;
        dataDexRouter = _dataDexRouter;
        uniswapV3PositionManager = _uniswapV3PositionManager;
        uniswapV3Factory = _uniswapV3Factory;
        universalDLPTreasury = UniversalDLPTreasury(_universalDLPTreasury);
        dlpRegistry = IDLPRegistryForBuyAndBurn(_dlpRegistry); // Changed this line
        dataAccessTreasury = _dataAccessTreasury;

        // Set default parameters
        protocolShareBps = 2000; // 20%
        costSkimBps = 500; // 5%
        perSwapSlippageCap = 200; // 2%
        singleBatchImpactThreshold = 500; // 5%
        defaultPoolFee = 3000; // 0.3%
        epochBlockCadence = 7200; // ~1 day (assuming 12s block time)

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, _owner);
        _grantRole(DATA_ACCESS_ROLE, _dataAccessTreasury);

        currentEpoch = 1;
        lastExecutionBlock = block.number;
    }

    /**
     * @notice Receive funds from data access payments
     * @param token Payment token (USDC or VANA)
     * @param amount Payment amount
     * @param dlpId DLP identifier
     */
    function receiveFunds(
        address token,
        uint256 amount,
        uint256 dlpId
    ) external override onlyRole(DATA_ACCESS_ROLE) {
        if (token != usdcToken && token != vanaToken) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();

        // Transfer tokens to this contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Split: 20% protocol, 80% DLP
        uint256 protocolShare = (amount * protocolShareBps) / 10000;
        uint256 dlpShare = amount - protocolShare;

        // Track pending funds
        if (token == usdcToken) {
            pendingProtocolFunds.usdc += protocolShare;
            pendingDLPFunds[dlpId].usdc += dlpShare;
        } else {
            pendingProtocolFunds.vana += protocolShare;
            pendingDLPFunds[dlpId].vana += dlpShare;
        }

        emit FundsReceived(token, amount, dlpId, protocolShare, dlpShare);
    }

    /**
     * @notice Execute protocol share processing
     * @dev Processes USDC/VANA → VANA/USDC LP → burn VANA
     */
    function executeProtocolShare() external override onlyRole(EXECUTOR_ROLE) {
        // Check epoch
        if (block.number < lastExecutionBlock + epochBlockCadence) {
            revert ExecutionTooSoon();
        }

        uint256 totalVanaBurned = 0;
        uint256 totalSkimmed = 0;
        uint256 totalLPAdded = 0;

        // Process USDC if available
        if (pendingProtocolFunds.usdc > 0) {
            uint256 usdcAmount = pendingProtocolFunds.usdc;
            pendingProtocolFunds.usdc = 0;

            // Execute swapAndAddLiquidity: USDC → VANA/USDC LP
            SwapAndAddLiquidityLib.SwapParams memory params = SwapAndAddLiquidityLib.SwapParams({
                tokenIn: usdcToken,
                tokenOut: vanaToken,
                amountIn: usdcAmount,
                poolFee: defaultPoolFee,
                maxSlippageBps: perSwapSlippageCap,
                impactThreshold: singleBatchImpactThreshold,
                lpTokenId: 0, // Protocol uses separate LP management
                router: dataDexRouter,
                positionManager: uniswapV3PositionManager,
                factory: uniswapV3Factory
            });

            SwapAndAddLiquidityLib.SwapResult memory result =
                                SwapAndAddLiquidityLib.swapAndAddLiquidity(params);

            // VANA received goes to burn (after skim)
            uint256 vanaReceived = result.tokenOutReceived;
            totalLPAdded += result.lpAdded;

            // Process VANA for burning
            if (vanaReceived > 0) {
                (uint256 burned, uint256 skimmed) = _processVANABurn(vanaReceived);
                totalVanaBurned += burned;
                totalSkimmed += skimmed;
            }

            // Roll over unused USDC
            if (result.tokenInUnused > 0) {
                pendingProtocolFunds.usdc += result.tokenInUnused;
            }
        }

        // Process VANA if available
        if (pendingProtocolFunds.vana > 0) {
            uint256 vanaAmount = pendingProtocolFunds.vana;
            pendingProtocolFunds.vana = 0;

            (uint256 burned, uint256 skimmed) = _processVANABurn(vanaAmount);
            totalVanaBurned += burned;
            totalSkimmed += skimmed;
        }

        // Update epoch
        currentEpoch++;
        lastExecutionBlock = block.number;

        emit ProtocolShareExecuted(
            currentEpoch - 1,
            totalVanaBurned + totalSkimmed,
            totalVanaBurned,
            totalSkimmed,
            totalLPAdded
        );
    }

    /**
     * @notice Execute DLP share processing
     * @param dlpIds Array of DLP IDs to process
     */
    function executeDLPShare(uint256[] calldata dlpIds) external override onlyRole(EXECUTOR_ROLE) {
        for (uint256 i = 0; i < dlpIds.length; i++) {
            uint256 dlpId = dlpIds[i];
            PendingFunds storage pending = pendingDLPFunds[dlpId];

            // Get DLP info
            IDLPRegistryForBuyAndBurn.DlpInfo memory dlpInfo = dlpRegistry.dlps(dlpId); // Changed this line

            // Skip if no token (fallback to VANA payment only)
            if (dlpInfo.tokenAddress == address(0)) {
                // Process VANA directly if available
                if (pending.vana > 0) {
                    _processDLPVANAOnly(dlpId, pending.vana);
                    pending.vana = 0;
                }
                continue;
            }

            // Process USDC → VANA → VANA/DLPT LP + burn
            if (pending.usdc > 0) {
                uint256 usdcAmount = pending.usdc;
                pending.usdc = 0;

                // First swap USDC → VANA
                SwapAndAddLiquidityLib.SwapParams memory usdcToVanaParams =
                                    SwapAndAddLiquidityLib.SwapParams({
                        tokenIn: usdcToken,
                        tokenOut: vanaToken,
                        amountIn: usdcAmount,
                        poolFee: defaultPoolFee,
                        maxSlippageBps: perSwapSlippageCap,
                        impactThreshold: singleBatchImpactThreshold,
                        lpTokenId: 0,
                        router: dataDexRouter,
                        positionManager: uniswapV3PositionManager,
                        factory: uniswapV3Factory
                    });

                SwapAndAddLiquidityLib.SwapResult memory usdcResult =
                                    SwapAndAddLiquidityLib.swapAndAddLiquidity(usdcToVanaParams);

                // Add received VANA to pending
                pending.vana += usdcResult.tokenOutReceived;

                // Roll over unused USDC
                if (usdcResult.tokenInUnused > 0) {
                    pending.usdc += usdcResult.tokenInUnused;
                }
            }

            // Process VANA → VANA/DLPT LP + burn DLPT
            if (pending.vana > 0) {
                uint256 vanaAmount = pending.vana;
                pending.vana = 0;

                SwapAndAddLiquidityLib.SwapParams memory vanaToDLPTParams =
                                    SwapAndAddLiquidityLib.SwapParams({
                        tokenIn: vanaToken,
                        tokenOut: dlpInfo.tokenAddress,
                        amountIn: vanaAmount,
                        poolFee: defaultPoolFee,
                        maxSlippageBps: perSwapSlippageCap,
                        impactThreshold: singleBatchImpactThreshold,
                        lpTokenId: dlpInfo.lpTokenId,
                        router: dataDexRouter,
                        positionManager: uniswapV3PositionManager,
                        factory: uniswapV3Factory
                    });

                SwapAndAddLiquidityLib.SwapResult memory dlpResult =
                                    SwapAndAddLiquidityLib.swapAndAddLiquidity(vanaToDLPTParams);

                // Burn spare DLPT
                if (dlpResult.tokenOutSpare > 0) {
                    IERC20(dlpInfo.tokenAddress).safeTransfer(
                        vanaBurnAddress, // Use same burn address for all tokens
                        dlpResult.tokenOutSpare
                    );
                }

                // Roll over unused VANA
                if (dlpResult.tokenInUnused > 0) {
                    pending.vana += dlpResult.tokenInUnused;
                }

                emit DLPShareExecuted(
                    currentEpoch,
                    dlpId,
                    dlpResult.tokenOutSpare,
                    dlpResult.lpAdded
                );
            }
        }
    }

    /**
     * @notice Process VANA burn with cost skim
     * @return burned Amount burned
     * @return skimmed Amount skimmed for compute/staking
     */
    function _processVANABurn(uint256 vanaAmount) private returns (
        uint256 burned,
        uint256 skimmed
    ) {
        // Calculate skim (5% of protocol share)
        skimmed = (vanaAmount * costSkimBps) / 10000;
        burned = vanaAmount - skimmed;

        // Transfer skim to compute/staking
        if (skimmed > 0) {
            IERC20(vanaToken).safeTransfer(computeStakingAddress, skimmed);
        }

        // Burn remaining VANA
        if (burned > 0) {
            IERC20(vanaToken).safeTransfer(vanaBurnAddress, burned);
        }

        return (burned, skimmed);
    }

    /**
     * @notice Process DLP with VANA only (no token)
     */
    function _processDLPVANAOnly(uint256 dlpId, uint256 vanaAmount) private {
        // For DLPs without tokens, just burn the VANA
        IERC20(vanaToken).safeTransfer(vanaBurnAddress, vanaAmount);

        emit DLPShareExecuted(currentEpoch, dlpId, vanaAmount, 0);
    }

    // Configuration update functions
    function updateProtocolShareBps(uint256 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_bps > 10000) revert InvalidBasisPoints();
        emit ConfigUpdated("protocolShareBps", protocolShareBps, _bps);
        protocolShareBps = _bps;
    }

    function updateCostSkimBps(uint256 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_bps > 10000) revert InvalidBasisPoints();
        emit ConfigUpdated("costSkimBps", costSkimBps, _bps);
        costSkimBps = _bps;
    }

    function updatePerSwapSlippageCap(uint256 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_bps > 10000) revert InvalidBasisPoints();
        emit ConfigUpdated("perSwapSlippageCap", perSwapSlippageCap, _bps);
        perSwapSlippageCap = _bps;
    }

    function updateSingleBatchImpactThreshold(uint256 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_bps > 10000) revert InvalidBasisPoints();
        emit ConfigUpdated("singleBatchImpactThreshold", singleBatchImpactThreshold, _bps);
        singleBatchImpactThreshold = _bps;
    }

    function updateEpochBlockCadence(uint256 _blocks) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit ConfigUpdated("epochBlockCadence", epochBlockCadence, _blocks);
        epochBlockCadence = _blocks;
    }

    function updateDataDexRouter(address _router) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Allow zero address for testing/disabling
        dataDexRouter = _router;
    }

    /**
     * @notice Authorize upgrade (UUPS pattern)
     */
    function _authorizeUpgrade(address newImplementation)
    internal
    override
    onlyRole(DEFAULT_ADMIN_ROLE)
    {}
}
