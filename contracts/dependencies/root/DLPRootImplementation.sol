// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/DLPRootStorageV1.sol";

contract DLPRootImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    MulticallUpgradeable,
    DLPRootStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;
    using Checkpoints for Checkpoints.Trace208;
    using SafeERC20 for IERC20;

    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    // Key events for DLP lifecycle and operations
    event DlpRegistered(
        uint256 indexed dlpId,
        address indexed dlpAddress,
        address ownerAddress,
        address treasuryAddress,
        uint256 stakersPercentage,
        string name,
        string iconUrl,
        string website,
        string metadata
    );

    event DlpUpdated(
        uint256 indexed dlpId,
        address indexed dlpAddress,
        address ownerAddress,
        address treasuryAddress,
        uint256 stakersPercentage,
        string name,
        string iconUrl,
        string website,
        string metadata
    );

    event DlpDeregistered(uint256 indexed dlpId);
    event EpochCreated(uint256 epochId);
    event EligibleDlpsLimitUpdated(uint256 newEligibleDlpsLimit);
    event MinDlpStakersPercentageUpdated(uint256 newMinDlpStakersPercentage);
    event MinStakeAmountUpdated(uint256 newMinStakeAmount);
    event DlpEligibilityThresholdUpdated(uint256 newDlpEligibilityThreshold);
    event DlpSubEligibilityThresholdUpdated(uint256 newDlpSubEligibilityThreshold);
    event EpochDlpsLimitUpdated(uint256 newEpochDlpsLimit);
    event StakeWithdrawalDelayUpdated(uint256 newStakeWithdrawalDelay);
    event RewardClaimDelayUpdated(uint256 newRewardClaimDelay);
    event EpochSizeUpdated(uint256 newEpochSize);
    event EpochRewardAmountUpdated(uint256 newEpochRewardAmount);
    event MinDlpRegistrationStakeUpdated(uint256 newMinDlpRegistrationStake);
    event StakeCreated(uint256 stakeId, address indexed staker, uint256 indexed dlpId, uint256 amount);
    event StakeClosed(uint256 indexed stakeId);
    event StakeWithdrawn(uint256 indexed stakeId);
    event DlpBecameEligible(uint256 indexed dlpId);
    event DlpStakersPercentageUpdated(uint256 dlpId, uint256 stakersPercentage);

    // Custom errors
    error InvalidStakeAmount();
    error StakeAlreadyWithdrawn();
    error StakeNotClosed();
    error StakeAlreadyClosed();
    error StakeWithdrawalTooEarly();
    error InvalidDlpStatus();
    error InvalidAddress();
    error NotDlpOwner();
    error NotStakeOwner();
    error NothingToClaim();
    error InvalidStakersPercentage();
    error TransferFailed();
    error EpochNotEnded();

    modifier onlyDlpOwner(uint256 dlpId) {
        if (_dlps[dlpId].ownerAddress != msg.sender) {
            revert NotDlpOwner();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    struct InitParams {
        address payable ownerAddress;
        uint256 eligibleDlpsLimit;
        uint256 epochDlpsLimit;
        uint256 minStakeAmount;
        uint256 minDlpStakersPercentage;
        uint256 minDlpRegistrationStake;
        uint256 dlpEligibilityThreshold;
        uint256 dlpSubEligibilityThreshold;
        uint256 stakeWithdrawalDelay;
        uint256 rewardClaimDelay;
        uint256 startBlock;
        uint256 epochSize;
        uint256 daySize;
        uint256 epochRewardAmount;
    }

    function initialize(InitParams memory params) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __Multicall_init();

        eligibleDlpsLimit = params.eligibleDlpsLimit;
        epochDlpsLimit = params.epochDlpsLimit;
        minStakeAmount = params.minStakeAmount;
        minDlpStakersPercentage = params.minDlpStakersPercentage;
        minDlpRegistrationStake = params.minDlpRegistrationStake;
        dlpEligibilityThreshold = params.dlpEligibilityThreshold;
        dlpSubEligibilityThreshold = params.dlpSubEligibilityThreshold;
        _checkpointPush(_stakeWithdrawalDelayCheckpoints, params.stakeWithdrawalDelay);
        _checkpointPush(_rewardClaimDelayCheckpoints, params.rewardClaimDelay);
        epochSize = params.epochSize;
        daySize = params.daySize;
        epochRewardAmount = params.epochRewardAmount;

        // Initialize first epoch
        Epoch storage epoch0 = _epochs[0];
        epoch0.startBlock = Math.min(params.startBlock - 2, block.number);
        epoch0.endBlock = params.startBlock - 1;
        epoch0.isFinalised = true;

        _setRoleAdmin(ADMIN_ROLE, OWNER_ROLE);
        _setRoleAdmin(MANAGER_ROLE, ADMIN_ROLE);
        _grantRole(OWNER_ROLE, params.ownerAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(OWNER_ROLE) {}

    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    function stakeWithdrawalDelay() public view returns (uint256) {
        return _stakeWithdrawalDelayCheckpoints.latest();
    }

    function rewardClaimDelay() public view returns (uint256) {
        return _rewardClaimDelayCheckpoints.latest();
    }

    /**
     * @notice Gets DLP information including current stake and status
     */
    function dlps(uint256 dlpId) public view override returns (DlpInfo memory) {
        Dlp storage dlp = _dlps[dlpId];

        return
            DlpInfo({
                id: dlp.id,
                dlpAddress: dlp.dlpAddress,
                ownerAddress: dlp.ownerAddress,
                treasuryAddress: dlp.treasuryAddress,
                stakersPercentage: dlp.stakersPercentageCheckpoints.latest(),
                stakersPercentageEpoch: dlp.stakersPercentageCheckpoints.upperLookup(
                    SafeCast.toUint48(_epochs[epochsCount].startBlock)
                ),
                name: dlp.name,
                iconUrl: dlp.iconUrl,
                website: dlp.website,
                metadata: dlp.metadata,
                status: dlp.status,
                registrationBlockNumber: dlp.registrationBlockNumber,
                stakeAmount: _dlpComputedStakeAmount(dlpId)
            });
    }

    function dlpsByAddress(address dlpAddress) external view override returns (DlpInfo memory) {
        return dlps(dlpIds[dlpAddress]);
    }

    function eligibleDlpsListValues() external view override returns (uint256[] memory) {
        return _eligibleDlpsList.values();
    }

    function eligibleDlpsListCount() external view override returns (uint256) {
        return _eligibleDlpsList.length();
    }

    function eligibleDlpsListAt(uint256 index) external view override returns (uint256) {
        return _eligibleDlpsList.at(index);
    }

    function stakes(uint256 stakeId) external view override returns (StakeInfo memory) {
        Stake storage stake = _stakes[stakeId];

        return
            StakeInfo({
                id: stakeId,
                stakerAddress: stake.stakerAddress,
                dlpId: stake.dlpId,
                amount: stake.amount,
                startBlock: stake.startBlock,
                withdrawn: stake.withdrawn,
                endBlock: stake.endBlock,
                lastClaimedEpochId: _dlps[stake.dlpId].epochIds[stake.lastClaimedIndexEpochId]
            });
    }

    function epochs(uint256 epochId) external view override returns (EpochInfo memory) {
        return
            EpochInfo({
                startBlock: _epochs[epochId].startBlock,
                endBlock: _epochs[epochId].endBlock,
                reward: _epochs[epochId].rewardAmount,
                isFinalised: _epochs[epochId].isFinalised,
                dlpIds: _epochs[epochId].dlpIds.values()
            });
    }

    function dlpEpochs(uint256 dlpId, uint256 epochId) external view override returns (DlpEpochInfo memory) {
        Epoch storage epoch = _epochs[epochId];
        EpochDlp memory epochDlp = epoch.dlps[dlpId];
        return
            DlpEpochInfo({
                stakeAmount: _dlpComputedStakeAmountByBlock(dlpId, SafeCast.toUint48(epoch.startBlock)),
                isTopDlp: epoch.dlpIds.contains(dlpId),
                rewardAmount: epochDlp.rewardAmount,
                stakersPercentage: _dlps[dlpId].stakersPercentageCheckpoints.upperLookup(
                    SafeCast.toUint48(epoch.startBlock)
                ),
                totalStakesScore: epochDlp.totalStakesScore
            });
    }

    function stakerDlpsListCount(address staker) external view override returns (uint256) {
        return _stakers[staker].dlpIds.length();
    }

    function stakerDlpsListAt(address staker, uint256 index) external view override returns (uint256) {
        return _stakers[staker].dlpIds.at(index);
    }

    function stakerDlpsListValues(address staker) external view override returns (uint256[] memory) {
        return _stakers[staker].dlpIds.values();
    }

    /**
     * @notice Calculates claimable rewards for a stake
     * @dev Takes into account stake duration, score, and reward distribution
     */
    function calculateStakeClaimableAmount(uint256 stakeId) external view override returns (uint256) {
        Stake storage stake = _stakes[stakeId];
        Dlp storage dlp = _dlps[stake.dlpId];

        uint256 totalRewardAmount;
        uint256 epochToClaimIndex = stake.lastClaimedIndexEpochId;
        uint256 epochToClaim = dlp.epochIds[epochToClaimIndex + 1];
        uint256 rewardClaimDelay = rewardClaimDelay();

        while (epochToClaim <= epochsCount) {
            Epoch storage epoch = _epochs[epochToClaim];
            EpochDlp storage epochDlp = epoch.dlps[stake.dlpId];

            if (epochToClaim == 0 || epochDlp.totalStakesScore == 0 || epoch.endBlock > stake.endBlock) {
                break;
            }

            uint256 rewardAmount = (((_calculateStakeScore(stake.amount, stake.startBlock, epoch.endBlock) *
                epochDlp.rewardAmount) / epochDlp.totalStakesScore) * epochDlp.stakersPercentage) /
                epochDlp.totalStakesScore;

            if (epoch.endBlock + rewardClaimDelay < block.number) {
                rewardAmount = (rewardAmount * (block.number - epoch.endBlock)) / rewardClaimDelay;
            }

            if (stake.claimedAmounts[epochToClaim] < rewardAmount) {
                continue;
            }

            totalRewardAmount += rewardAmount - stake.claimedAmounts[epochToClaim];

            epochToClaim = dlp.epochIds[++epochToClaimIndex];
        }

        return totalRewardAmount;
    }

    /**
     * @notice Estimates reward percentages for given DLPs
     * @dev Calculates based on stake amounts and current epoch parameters
     */
    function estimatedDlpRewardPercentages(
        uint256[] memory dlpIds
    ) external view override returns (DlpRewardApy[] memory) {
        uint256[] memory topDlps = topDlpIds(16);
        uint256 totalStakeAmount;

        // Calculate total stake amount for top DLPs
        for (uint256 i = 0; i < topDlps.length; i++) {
            totalStakeAmount += _dlpComputedStakeAmount(topDlps[i]);
        }

        uint256 minTopDlpStake = 0;
        if (topDlps.length > 0) {
            minTopDlpStake = _dlpComputedStakeAmount(topDlps[topDlps.length - 1]);
        }

        DlpRewardApy[] memory result = new DlpRewardApy[](dlpIds.length);

        for (uint256 i = 0; i < dlpIds.length; i++) {
            uint256 dlpId = dlpIds[i];
            bool isInTop = false;
            uint256 dlpStake = _dlpComputedStakeAmount(dlpId);

            if (dlpStake < minTopDlpStake) {
                totalStakeAmount -= minTopDlpStake + dlpStake;
            }

            uint256 stakersPercentage = _dlps[dlpId].stakersPercentageCheckpoints.latest();

            // Check if DLP is in top 16
            for (uint256 j = 0; j < topDlps.length; j++) {
                if (topDlps[j] == dlpId) {
                    isInTop = true;
                    break;
                }
            }

            uint256 rewardAmount = (dlpStake * epochRewardAmount) / totalStakeAmount;
            uint256 stakeReward = (((100e18 * rewardAmount) / dlpStake) * stakersPercentage) / 1e20;

            result[i] = DlpRewardApy({dlpId: dlpId, rewardAPYs: stakeReward});
        }

        return result;
    }

    /**
     * @notice Gets top DLP IDs by stake amount
     * @dev Uses insertion sort to maintain ordered list
     */
    function topDlpIds(uint256 numberOfDlps) public view override returns (uint256[] memory) {
        uint256[] memory eligibleDlpIds = _eligibleDlpsList.values();
        uint256 eligibleDlpsCount = eligibleDlpIds.length;

        numberOfDlps = Math.min(numberOfDlps, eligibleDlpsCount);
        uint256[] memory topDlpIds = new uint256[](numberOfDlps);

        if (numberOfDlps == 0) {
            return topDlpIds;
        }

        uint256[] memory topStakes = new uint256[](numberOfDlps);

        for (uint256 i = 0; i < eligibleDlpsCount; i++) {
            uint256 currentDlpId = eligibleDlpIds[i];
            uint256 currentStake = _dlpComputedStakeAmount(currentDlpId);

            uint256 position = numberOfDlps;
            for (uint256 j = 0; j < numberOfDlps; j++) {
                if (currentStake > topStakes[j] || (currentStake == topStakes[j] && currentDlpId < topDlpIds[j])) {
                    position = j;
                    break;
                }
            }

            if (position < numberOfDlps) {
                for (uint256 j = numberOfDlps - 1; j > position; j--) {
                    topDlpIds[j] = topDlpIds[j - 1];
                    topStakes[j] = topStakes[j - 1];
                }
                topDlpIds[position] = currentDlpId;
                topStakes[position] = currentStake;
            }
        }

        return topDlpIds;
    }

    function pause() external override onlyRole(OWNER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(OWNER_ROLE) {
        _unpause();
    }

    function updateEligibleDlpsLimit(uint256 newEligibleDlpsLimit) external override onlyRole(OWNER_ROLE) {
        eligibleDlpsLimit = newEligibleDlpsLimit;
        emit EligibleDlpsLimitUpdated(newEligibleDlpsLimit);
    }

    function updateMinStakeAmount(uint256 newMinStakeAmount) external override onlyRole(OWNER_ROLE) {
        minStakeAmount = newMinStakeAmount;
        emit MinStakeAmountUpdated(newMinStakeAmount);
    }

    function updateMinDlpStakersPercentage(uint256 newMinDlpStakersPercentage) external override onlyRole(OWNER_ROLE) {
        minDlpStakersPercentage = newMinDlpStakersPercentage;
        emit MinDlpStakersPercentageUpdated(newMinDlpStakersPercentage);
    }

    function updateMinDlpRegistrationStake(uint256 newMinDlpRegistrationStake) external override onlyRole(OWNER_ROLE) {
        minDlpRegistrationStake = newMinDlpRegistrationStake;
        emit MinDlpRegistrationStakeUpdated(newMinDlpRegistrationStake);
    }

    /**
     * @notice Updates eligibility threshold and adjusts DLP statuses
     */
    function updateDlpEligibilityThreshold(uint256 newDlpEligibilityThreshold) external override onlyRole(OWNER_ROLE) {
        dlpEligibilityThreshold = newDlpEligibilityThreshold;

        for (uint256 index = 0; index < _eligibleDlpsList.length(); index++) {
            uint256 dlpId = _eligibleDlpsList.at(index);
            Dlp storage dlp = _dlps[dlpId];
            if (dlp.stakersPercentageCheckpoints.latest() < newDlpEligibilityThreshold) {
                dlp.status = DlpStatus.SubEligible;
            }
        }

        emit DlpEligibilityThresholdUpdated(newDlpEligibilityThreshold);
    }

    /**
     * @notice Updates sub-eligibility threshold and adjusts DLP statuses
     */
    function updateDlpSubEligibilityThreshold(
        uint256 newDlpSubEligibilityThreshold
    ) external override onlyRole(OWNER_ROLE) {
        dlpSubEligibilityThreshold = newDlpSubEligibilityThreshold;

        for (uint256 index = 0; index < _eligibleDlpsList.length(); index++) {
            uint256 dlpId = _eligibleDlpsList.at(index);
            Dlp storage dlp = _dlps[dlpId];
            if (dlp.stakersPercentageCheckpoints.latest() < newDlpSubEligibilityThreshold) {
                dlp.status = DlpStatus.Registered;
                _eligibleDlpsList.remove(dlpId);
            }
        }

        emit DlpSubEligibilityThresholdUpdated(newDlpSubEligibilityThreshold);
    }

    function updateEpochDlpsLimit(uint256 newEpochDlpsLimit) external override onlyRole(OWNER_ROLE) {
        epochDlpsLimit = newEpochDlpsLimit;
        emit EpochDlpsLimitUpdated(newEpochDlpsLimit);
    }

    function updateStakeWithdrawalDelay(uint256 newStakeWithdrawalDelay) external override onlyRole(OWNER_ROLE) {
        _checkpointPush(_stakeWithdrawalDelayCheckpoints, newStakeWithdrawalDelay);
        emit StakeWithdrawalDelayUpdated(newStakeWithdrawalDelay);
    }

    function updateRewardClaimDelay(uint256 newRewardClaimDelay) external override onlyRole(OWNER_ROLE) {
        _checkpointPush(_rewardClaimDelayCheckpoints, newRewardClaimDelay);
        emit RewardClaimDelayUpdated(newRewardClaimDelay);
    }

    function updateEpochSize(uint256 newEpochSize) external override onlyRole(OWNER_ROLE) {
        epochSize = newEpochSize;
        emit EpochSizeUpdated(newEpochSize);
    }

    function updateEpochRewardAmount(uint256 newEpochRewardAmount) external override onlyRole(OWNER_ROLE) {
        epochRewardAmount = newEpochRewardAmount;
        emit EpochRewardAmountUpdated(newEpochRewardAmount);
    }

    /**
     * @notice Updates stake scores for DLPs in past epochs
     */
    function saveEpochDlpsTotalStakesScore(
        EpochDlpsTotalStakesScore[] memory stakeScore
    ) external override onlyRole(OWNER_ROLE) {
        for (uint256 i = 0; i < stakeScore.length; i++) {
            if (_epochs[stakeScore[i].epochId].endBlock > block.number) {
                revert EpochNotEnded();
            }

            if (_epochs[stakeScore[i].epochId].dlps[stakeScore[i].dlpId].totalStakesScore != 0) {
                continue;
            }

            _epochs[stakeScore[i].epochId].dlps[stakeScore[i].dlpId].totalStakesScore = stakeScore[i].totalStakesScore;
        }
    }

    function overrideEpochDlpsTotalStakesScore(
        EpochDlpsTotalStakesScore memory stakeScore
    ) external override onlyRole(OWNER_ROLE) {
        if (_epochs[stakeScore.epochId].endBlock > block.number) {
            revert EpochNotEnded();
        }

        _epochs[stakeScore.epochId].dlps[stakeScore.dlpId].totalStakesScore = stakeScore.totalStakesScore;
    }

    /**
     * @notice Registers a new DLP with initial stake
     */
    function registerDlp(
        DlpRegistration calldata registrationInfo
    ) external payable override whenNotPaused nonReentrant {
        _createEpochsUntilBlockNumber(block.number);
        _registerDlp(registrationInfo);
    }

    /**
     * @notice Updates DLP information
     * @dev Only DLP owner can update
     */
    function updateDlp(
        uint256 dlpId,
        DlpRegistration calldata dlpUpdateInfo
    ) external override whenNotPaused nonReentrant onlyDlpOwner(dlpId) {
        _createEpochsUntilBlockNumber(block.number);

        if (dlpUpdateInfo.ownerAddress == address(0) || dlpUpdateInfo.treasuryAddress == address(0)) {
            revert InvalidAddress();
        }

        if (dlpUpdateInfo.stakersPercentage < minDlpStakersPercentage || dlpUpdateInfo.stakersPercentage > 100e18) {
            revert InvalidStakersPercentage();
        }

        Dlp storage dlp = _dlps[dlpId];

        dlp.ownerAddress = dlpUpdateInfo.ownerAddress;
        dlp.treasuryAddress = dlpUpdateInfo.treasuryAddress;
        _checkpointPush(dlp.stakersPercentageCheckpoints, dlpUpdateInfo.stakersPercentage);
        dlp.name = dlpUpdateInfo.name;
        dlp.iconUrl = dlpUpdateInfo.iconUrl;
        dlp.website = dlpUpdateInfo.website;
        dlp.metadata = dlpUpdateInfo.metadata;

        dlpIds[dlpUpdateInfo.dlpAddress] = dlpId;

        emit DlpUpdated(
            dlpId,
            dlpUpdateInfo.dlpAddress,
            dlpUpdateInfo.ownerAddress,
            dlpUpdateInfo.treasuryAddress,
            dlpUpdateInfo.stakersPercentage,
            dlpUpdateInfo.name,
            dlpUpdateInfo.iconUrl,
            dlpUpdateInfo.website,
            dlpUpdateInfo.metadata
        );
    }

    /**
     * @notice Deregisters a DLP
     * @dev Only owner can deregister, must be in valid status
     */
    function deregisterDlp(uint256 dlpId) external override whenNotPaused nonReentrant onlyDlpOwner(dlpId) {
        _createEpochsUntilBlockNumber(block.number);

        Dlp storage dlp = _dlps[dlpId];

        if (
            dlp.status != DlpStatus.Registered &&
            dlp.status != DlpStatus.Eligible &&
            dlp.status != DlpStatus.SubEligible
        ) {
            revert InvalidDlpStatus();
        }

        dlp.status = DlpStatus.Deregistered;
        _eligibleDlpsList.remove(dlpId);

        emit DlpDeregistered(dlpId);
    }

    /**
     * @notice Creates epochs up to current block
     */
    function createEpochs() external override nonReentrant whenNotPaused {
        _createEpochsUntilBlockNumber(block.number);
    }

    /**
     * @notice Creates epochs up to specified block
     */
    function createEpochsUntilBlockNumber(uint256 blockNumber) external override nonReentrant whenNotPaused {
        _createEpochsUntilBlockNumber(blockNumber < block.number ? blockNumber : block.number);
    }

    /**
     * @notice Claims rewards for a stake up to specified epoch
     */
    function claimStakeRewardUntilEpoch(uint256 stakeId, uint256 lastEpochToClaim) external nonReentrant whenNotPaused {
        _createEpochsUntilBlockNumber(block.number);
        _claimStakeRewardUntilEpoch(stakeId, lastEpochToClaim);
    }

    /**
     * @notice Creates a new stake for a DLP
     */
    function createStake(uint256 dlpId) external payable override nonReentrant whenNotPaused {
        _createEpochsUntilBlockNumber(block.number);
        _createStake(msg.sender, dlpId, msg.value);
    }

    /**
     * @notice Closes multiple stakes
     */
    function closeStakes(uint256[] memory stakeIds) external override nonReentrant whenNotPaused {
        _createEpochsUntilBlockNumber(block.number);
        for (uint256 i = 0; i < stakeIds.length; i++) {
            _closeStake(msg.sender, stakeIds[i]);
        }
    }

    /**
     * @notice Withdraws multiple closed stakes
     */
    function withdrawStakes(uint256[] memory stakeIds) external override nonReentrant whenNotPaused {
        _createEpochsUntilBlockNumber(block.number);
        for (uint256 i = 0; i < stakeIds.length; i++) {
            _withdrawStake(msg.sender, stakeIds[i]);
        }
    }

    /**
     * @notice Claims rewards for multiple stakes
     */
    function claimStakesReward(uint256[] memory stakeIds) external nonReentrant whenNotPaused {
        _createEpochsUntilBlockNumber(block.number);
        for (uint256 i = 0; i < stakeIds.length; i++) {
            _claimStakeRewardUntilEpoch(stakeIds[i], epochsCount);
        }
    }

    /**
     * @notice Creates a new stake for a DLP
     * @dev Validates stake amount and DLP status before creating
     */
    function _createStake(address stakerAddress, uint256 dlpId, uint256 amount) internal {
        if (stakerAddress == address(0)) {
            revert InvalidAddress();
        }

        if (amount < minStakeAmount) {
            revert InvalidStakeAmount();
        }

        Dlp storage dlp = _dlps[dlpId];

        if (
            dlp.status != DlpStatus.Registered &&
            dlp.status != DlpStatus.Eligible &&
            dlp.status != DlpStatus.SubEligible
        ) {
            revert InvalidDlpStatus();
        }

        Stake storage stake = _stakes[++stakesCount];
        stake.amount = amount;
        stake.startBlock = block.number;
        stake.stakerAddress = stakerAddress;
        stake.dlpId = dlpId;
        stake.lastClaimedIndexEpochId = dlp.epochIdsCount;

        Staker storage staker = _stakers[stakerAddress];
        staker.dlpIds.add(dlpId);
        _stakersList.add(stakerAddress);
        _checkpointAdd(dlp.stakeAmountCheckpoints, amount);

        // Check if DLP becomes eligible
        if (
            dlp.status != DlpStatus.Eligible &&
            _dlpComputedStakeAmount(dlpId) >= dlpEligibilityThreshold &&
            _eligibleDlpsList.length() < eligibleDlpsLimit
        ) {
            _eligibleDlpsList.add(dlpId);
            dlp.status = DlpStatus.Eligible;
            emit DlpBecameEligible(dlpId);
        }

        emit StakeCreated(stakesCount, stakerAddress, dlpId, amount);
    }

    /**
     * @notice Closes a stake and updates DLP status if needed
     */
    function _closeStake(address stakerAddress, uint256 stakeId) internal {
        Stake storage stake = _stakes[stakeId];

        if (stake.stakerAddress != stakerAddress) {
            revert NotStakeOwner();
        }

        if (stake.endBlock != 0) {
            revert StakeAlreadyClosed();
        }

        Dlp storage dlp = _dlps[stake.dlpId];
        _checkpointPush(dlp.unstakeAmountCheckpoints, stake.amount);
        stake.endBlock = block.number;

        uint256 dlpStake = _dlpComputedStakeAmount(stake.dlpId);

        // Update DLP status based on remaining stake
        if (
            dlpStake < dlpSubEligibilityThreshold &&
            (dlp.status == DlpStatus.SubEligible || dlp.status == DlpStatus.Eligible)
        ) {
            dlp.status = DlpStatus.Registered;
            _eligibleDlpsList.remove(stake.dlpId);
        } else if (dlpStake < dlpEligibilityThreshold && dlp.status == DlpStatus.Eligible) {
            dlp.status = DlpStatus.SubEligible;
        }

        emit StakeClosed(stakeId);
    }

    /**
     * @notice Withdraws a closed stake after delay period
     */
    function _withdrawStake(address stakerAddress, uint256 stakeId) internal {
        Stake storage stake = _stakes[stakeId];

        if (stake.stakerAddress != stakerAddress) {
            revert NotStakeOwner();
        }

        if (stake.withdrawn) {
            revert StakeAlreadyWithdrawn();
        }

        if (stake.endBlock == 0) {
            revert StakeNotClosed();
        }

        if (stake.endBlock + stakeWithdrawalDelay() > block.number) {
            revert StakeWithdrawalTooEarly();
        }

        stake.withdrawn = true;

        (bool success, ) = stakerAddress.call{value: stake.amount}("");
        if (!success) {
            revert TransferFailed();
        }

        emit StakeWithdrawn(stakeId);
    }

    /**
     * @notice Internal function to register a new DLP
     */
    function _registerDlp(DlpRegistration calldata registrationInfo) internal {
        if (registrationInfo.ownerAddress == address(0) || registrationInfo.treasuryAddress == address(0)) {
            revert InvalidAddress();
        }

        if (dlpIds[registrationInfo.dlpAddress] != 0) {
            revert InvalidDlpStatus();
        }

        if (
            registrationInfo.stakersPercentage < minDlpStakersPercentage || registrationInfo.stakersPercentage > 100e18
        ) {
            revert InvalidStakersPercentage();
        }

        if (msg.value < minDlpRegistrationStake) {
            revert InvalidStakeAmount();
        }

        uint256 dlpId = ++dlpsCount;
        Dlp storage dlp = _dlps[dlpId];

        dlp.id = dlpId;
        dlp.dlpAddress = registrationInfo.dlpAddress;
        dlp.ownerAddress = registrationInfo.ownerAddress;
        dlp.treasuryAddress = registrationInfo.treasuryAddress;
        _checkpointPush(dlp.stakersPercentageCheckpoints, registrationInfo.stakersPercentage);
        dlp.name = registrationInfo.name;
        dlp.iconUrl = registrationInfo.iconUrl;
        dlp.website = registrationInfo.website;
        dlp.metadata = registrationInfo.metadata;
        dlp.status = DlpStatus.Registered;
        dlp.registrationBlockNumber = block.number;

        dlpIds[registrationInfo.dlpAddress] = dlpId;

        _createStake(registrationInfo.ownerAddress, dlpId, msg.value);

        emit DlpRegistered(
            dlpId,
            registrationInfo.dlpAddress,
            registrationInfo.ownerAddress,
            registrationInfo.treasuryAddress,
            registrationInfo.stakersPercentage,
            registrationInfo.name,
            registrationInfo.iconUrl,
            registrationInfo.website,
            registrationInfo.metadata
        );
    }

    /**
     * @notice Claims reward for a stake up to specified epoch
     * @dev Calculates and distributes rewards based on stake score
     */
    function _claimStakeRewardUntilEpoch(uint256 stakeId, uint256 lastEpochToClaim) internal {
        Stake storage stake = _stakes[stakeId];
        Dlp storage dlp = _dlps[stake.dlpId];

        uint256 totalRewardAmount;
        uint256 epochToClaimIndex = stake.lastClaimedIndexEpochId;
        uint256 epochToClaim = dlp.epochIds[epochToClaimIndex + 1];
        uint256 rewardClaimDelay = rewardClaimDelay();

        while (epochToClaim <= lastEpochToClaim) {
            Epoch storage epoch = _epochs[epochToClaim];
            EpochDlp storage epochDlp = epoch.dlps[stake.dlpId];

            if (epochToClaim == 0 || epochDlp.totalStakesScore == 0 || epoch.endBlock > stake.endBlock) {
                break;
            }

            uint256 rewardAmount = (((_calculateStakeScore(stake.amount, stake.startBlock, epoch.endBlock) *
                epochDlp.rewardAmount) / epochDlp.totalStakesScore) * epochDlp.stakersPercentage) / 1e20;

            if (epoch.endBlock + rewardClaimDelay >= block.number) {
                stake.lastClaimedIndexEpochId++;
            } else {
                rewardAmount = (rewardAmount * (block.number - epoch.endBlock)) / rewardClaimDelay;
            }

            if (stake.claimedAmounts[epochToClaim] < rewardAmount) {
                continue;
            }

            totalRewardAmount += rewardAmount - stake.claimedAmounts[epochToClaim];
            stake.claimedAmounts[epochToClaim] = rewardAmount;

            epochToClaim = dlp.epochIds[++epochToClaimIndex];
        }

        if (totalRewardAmount == 0) {
            revert NothingToClaim();
        }

        (bool success, ) = payable(stake.stakerAddress).call{value: totalRewardAmount}("");
        if (!success) {
            revert TransferFailed();
        }
    }

    /**
     * @notice Returns stake score multiplier based on duration
     */
    function getMultiplier(uint256 index) public pure returns (uint256) {
        if (index >= 64) {
            return 300;
        }

        uint16[64] memory multiplier = [
            100,
            102,
            105,
            107,
            110,
            112,
            114,
            117,
            119,
            121,
            124,
            126,
            129,
            131,
            133,
            136,
            138,
            140,
            143,
            145,
            148,
            150,
            156,
            162,
            168,
            174,
            180,
            186,
            192,
            198,
            204,
            210,
            215,
            221,
            227,
            233,
            239,
            245,
            251,
            257,
            263,
            269,
            275,
            276,
            277,
            279,
            280,
            281,
            282,
            283,
            285,
            286,
            287,
            288,
            289,
            290,
            292,
            293,
            294,
            295,
            296,
            298,
            299,
            300
        ];
        return uint256(multiplier[index]);
    }

    /**
     * @notice Calculates stake score based on amount and duration
     */
    function _calculateStakeScore(
        uint256 stakeAmount,
        uint256 stakeStartBlock,
        uint256 blockNumber
    ) public view returns (uint256) {
        uint256 daysStaked = (blockNumber - stakeStartBlock) / daySize;
        return (stakeAmount * getMultiplier(daysStaked)) / 100;
    }

    /**
     * @notice Helper function to add value to checkpoint
     */
    function _checkpointAdd(Checkpoints.Trace208 storage store, uint256 delta) private returns (uint208, uint208) {
        return store.push(SafeCast.toUint48(block.number), store.latest() + SafeCast.toUint208(delta));
    }

    /**
     * @notice Helper function to set checkpoint value
     */
    function _checkpointPush(Checkpoints.Trace208 storage store, uint256 delta) private returns (uint208, uint208) {
        return store.push(SafeCast.toUint48(block.number), SafeCast.toUint208(delta));
    }

    /**
     * @notice Get DLP stake amount at specific block
     */
    function _dlpComputedStakeAmountByBlock(uint256 dlpId, uint48 checkBlock) internal view returns (uint256) {
        return
            _dlps[dlpId].stakeAmountCheckpoints.upperLookup(checkBlock) -
            _dlps[dlpId].unstakeAmountCheckpoints.upperLookup(checkBlock);
    }

    /**
     * @notice Get current DLP stake amount
     */
    function _dlpComputedStakeAmount(uint256 dlpId) internal view returns (uint256) {
        return _dlps[dlpId].stakeAmountCheckpoints.latest() - _dlps[dlpId].unstakeAmountCheckpoints.latest();
    }

    /**
     * @notice Creates and finalizes epochs up to target block
     */
    function _createEpochsUntilBlockNumber(uint256 blockNumber) internal {
        Epoch storage lastEpoch = _epochs[epochsCount];

        if (lastEpoch.endBlock > block.number) {
            return;
        }

        while (lastEpoch.endBlock < blockNumber) {
            _finalizeEpoch(epochsCount);
            epochsCount++;

            Epoch storage newEpoch = _epochs[epochsCount];
            newEpoch.startBlock = lastEpoch.endBlock + 1;
            newEpoch.endBlock = newEpoch.startBlock + epochSize - 1;
            newEpoch.rewardAmount = epochRewardAmount;

            emit EpochCreated(epochsCount);
            lastEpoch = newEpoch;
        }
    }

    /**
     * @notice Finalizes epoch by distributing rewards to top DLPs
     */
    function _finalizeEpoch(uint256 epochId) internal {
        Epoch storage epoch = _epochs[epochId];
        uint256[] memory topDlps = topDlpIds(epochDlpsLimit);

        uint256 index;
        uint256 topDlpsTotalStakeAmount;
        uint256 dlpId;
        EpochDlp storage epochDlp;
        Dlp storage dlp;

        // Calculate total stake amount
        for (index = 0; index < topDlps.length; index++) {
            topDlpsTotalStakeAmount += _dlpComputedStakeAmount(topDlps[index]);
        }

        // Distribute rewards
        for (index = 0; index < topDlps.length; index++) {
            dlpId = topDlps[index];
            epoch.dlpIds.add(dlpId);
            dlp = _dlps[dlpId];

            dlp.epochIds[++dlp.epochIdsCount] = epochId;

            epochDlp = epoch.dlps[dlpId];
            epochDlp.stakersPercentage = dlp.stakersPercentageCheckpoints.upperLookup(
                SafeCast.toUint48(epoch.startBlock)
            );
            epochDlp.rewardAmount = (_dlpComputedStakeAmount(dlpId) * epoch.rewardAmount) / topDlpsTotalStakeAmount;

            // Send treasury portion of rewards
            if (epochDlp.stakersPercentage < 100e18) {
                (bool success, ) = dlp.treasuryAddress.call{
                    value: (epochDlp.rewardAmount * (100e18 - epochDlp.stakersPercentage)) / 100e18
                }("");
                if (!success) {
                    revert TransferFailed();
                }
            }
        }
    }
}
