// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/DLPRootStorageV1.sol";

contract DLPRootImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC2771ContextUpgradeable,
    DLPRootStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;
    using Checkpoints for Checkpoints.Trace208;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant DLP_ROOT_METRICS_ROLE = keccak256("DLP_ROOT_METRICS_ROLE");

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
    event EpochCreated(uint256 epochId, uint256 startBlock, uint256 endBlock, uint256 rewardAmount);
    event EpochOverridden(uint256 epochId, uint256 startBlock, uint256 endBlock, uint256 rewardAmount);
    event EligibleDlpsLimitUpdated(uint256 newEligibleDlpsLimit);
    event MinDlpStakersPercentageUpdated(uint256 newMinDlpStakersPercentage);
    event MaxDlpStakersPercentageUpdated(uint256 newMaxDlpStakersPercentage);
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
    event DlpBecameSubEligible(uint256 indexed dlpId);
    event DlpBecomeIneligible(uint256 indexed dlpId);
    event EpochDlpScoreSaved(uint256 indexed epochId, uint256 indexed dlpId, uint256 totalStakesScore);
    event StakeRewardClaimed(uint256 indexed stakeId, uint256 indexed epochId, uint256 amount, bool isFinal);
    event DlpRewardClaimed(
        uint256 indexed dlpId,
        uint256 indexed epochId,
        uint256 rewardAmount,
        uint256 stakersRewardAmount
    );

    // Custom errors
    error InvalidParam();
    error InvalidStakeAmount();
    error StakeAlreadyWithdrawn();
    error StakeNotClosed();
    error StakeAlreadyClosed();
    error StakeWithdrawalTooEarly();
    error InvalidDlpId();
    error InvalidDlpStatus();
    error InvalidAddress();
    error InvalidName();
    error NotDlpOwner();
    error NotStakeOwner();
    error NothingToClaim();
    error InvalidStakersPercentage();
    error DLpAddressCannotBeChanged();
    error TransferFailed();
    error EpochNotEnded();
    error EpochDlpScoreAlreadySaved();
    error EpochRewardsAlreadyDistributed();
    error SafeCastOverflowedUintDowncast(uint8 bits, uint256 value);

    modifier onlyDlpOwner(uint256 dlpId) {
        if (_dlps[dlpId].ownerAddress != msg.sender) {
            revert NotDlpOwner();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    struct InitParams {
        address trustedForwarder;
        address payable ownerAddress;
        uint256 eligibleDlpsLimit;
        uint256 epochDlpsLimit;
        uint256 minStakeAmount;
        uint256 minDlpStakersPercentage;
        uint256 maxDlpStakersPercentage;
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

        if (
            params.minDlpStakersPercentage < 1e16 ||
            params.maxDlpStakersPercentage > 100e18 ||
            params.minDlpStakersPercentage > params.maxDlpStakersPercentage ||
            params.epochDlpsLimit > params.eligibleDlpsLimit ||
            params.minStakeAmount > params.minDlpRegistrationStake ||
            params.minDlpRegistrationStake > params.dlpSubEligibilityThreshold ||
            params.dlpSubEligibilityThreshold > params.dlpEligibilityThreshold
        ) {
            revert InvalidParam();
        }

        _trustedForwarder = params.trustedForwarder;
        eligibleDlpsLimit = params.eligibleDlpsLimit;
        epochDlpsLimit = params.epochDlpsLimit;
        minStakeAmount = params.minStakeAmount;
        minDlpStakersPercentage = params.minDlpStakersPercentage;
        maxDlpStakersPercentage = params.maxDlpStakersPercentage;
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
        epoch0.startBlock = params.startBlock - 2 < block.number ? params.startBlock - 2 : block.number;
        epoch0.endBlock = params.startBlock - 1;
        epoch0.isFinalised = true;

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(MANAGER_ROLE, MAINTAINER_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, params.ownerAddress);
        _grantRole(MAINTAINER_ROLE, params.ownerAddress);
        _grantRole(MANAGER_ROLE, params.ownerAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function _msgSender()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender)
    {
        return ERC2771ContextUpgradeable._msgSender();
    }

    function _msgData() internal view override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return ERC2771ContextUpgradeable._msgData();
    }

    function _contextSuffixLength()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (uint256)
    {
        return ERC2771ContextUpgradeable._contextSuffixLength();
    }

    function _checkRole(bytes32 role) internal view override {
        _checkRole(role, msg.sender);
    }

    /**
     * @dev Returns the address of the trusted forwarder.
     */
    function trustedForwarder() public view virtual override returns (address) {
        return _trustedForwarder;
    }

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
        Epoch storage epoch = _epochs[epochsCount];

        uint stakersPercentageEpoch = dlp.registrationBlockNumber > epoch.startBlock
            ? dlp.stakersPercentageCheckpoints.at(0)._value
            : dlp.stakersPercentageCheckpoints.upperLookup(toUint48(epoch.startBlock));

        uint256[] memory epochIds = new uint256[](dlp.epochIdsCount);
        for (uint256 i = 1; i <= dlp.epochIdsCount; ) {
            epochIds[i - 1] = dlp.epochIds[i];
            unchecked {
                ++i;
            }
        }

        return
            DlpInfo({
                id: dlp.id,
                dlpAddress: dlp.dlpAddress,
                ownerAddress: dlp.ownerAddress,
                treasuryAddress: dlp.treasuryAddress,
                stakersPercentage: dlp.stakersPercentageCheckpoints.latest(),
                stakersPercentageEpoch: stakersPercentageEpoch,
                name: dlp.name,
                iconUrl: dlp.iconUrl,
                website: dlp.website,
                metadata: dlp.metadata,
                status: dlp.status,
                registrationBlockNumber: dlp.registrationBlockNumber,
                stakeAmount: _dlpComputedStakeAmount(dlpId),
                epochIds: epochIds
            });
    }

    function dlpsByAddress(address dlpAddress) external view override returns (DlpInfo memory) {
        return dlps(dlpIds[dlpAddress]);
    }

    function dlpsByName(string calldata dlpName) external view override returns (DlpInfo memory) {
        return dlps(dlpNameToId[dlpName]);
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

    function stakeClaimedAmounts(uint256 stakeId, uint256 epochId) external view override returns (uint256) {
        return _stakes[stakeId].claimedAmounts[epochId];
    }

    function epochs(uint256 epochId) external view override returns (EpochInfo memory) {
        return
            EpochInfo({
                startBlock: _epochs[epochId].startBlock,
                endBlock: _epochs[epochId].endBlock,
                rewardAmount: _epochs[epochId].rewardAmount,
                isFinalised: _epochs[epochId].isFinalised,
                dlpIds: _epochs[epochId].dlpIds.values()
            });
    }

    function dlpEpochs(uint256 dlpId, uint256 epochId) external view override returns (DlpEpochInfo memory) {
        Epoch storage epoch = _epochs[epochId];
        EpochDlp memory epochDlp = epoch.dlps[dlpId];

        Dlp storage dlp = _dlps[dlpId];

        uint256 stakersPercentageEpoch = dlp.registrationBlockNumber > epoch.startBlock
            ? dlp.stakersPercentageCheckpoints.at(0)._value
            : dlp.stakersPercentageCheckpoints.upperLookup(toUint48(epoch.startBlock));

        return
            DlpEpochInfo({
                stakeAmount: _dlpComputedStakeAmountByBlock(dlpId, toUint48(epoch.endBlock)),
                isTopDlp: epoch.dlpIds.contains(dlpId),
                rewardAmount: epochDlp.rewardAmount,
                stakersPercentage: stakersPercentageEpoch,
                totalStakesScore: epochDlp.totalStakesScore,
                rewardClaimed: epochDlp.rewardClaimed,
                stakersRewardAmount: epochDlp.stakersRewardAmount
            });
    }

    function stakersListCount() external view returns (uint256) {
        return _stakersList.length();
    }
    function stakersListAt(uint256 index) external view returns (address) {
        return _stakersList.at(index);
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

    function stakerStakesListCount(address stakerAddress) external view returns (uint256) {
        return _stakers[stakerAddress].stakeIds.length();
    }

    function stakerStakesListAt(address stakerAddress, uint256 index) external view returns (uint256) {
        return _stakers[stakerAddress].stakeIds.at(index);
    }
    function stakerStakesListValues(address stakerAddress) external view returns (uint256[] memory) {
        return _stakers[stakerAddress].stakeIds.values();
    }

    function stakerTotalStakeAmount(address stakerAddress) external view returns (uint256) {
        return _stakers[stakerAddress].totalStakeAmount;
    }

    function stakerDlpStakeAmount(address stakerAddress, uint256 dlpId) external view returns (uint256) {
        return _stakers[stakerAddress].dlpStakeAmounts[dlpId];
    }

    /**
     * @notice Calculates claimable rewards for a stake
     * @dev Takes into account stake duration, score, and reward distribution
     * @dev This method is not marked as view because is using a method that modifies state
     * to call it as a view, please using static call
     */
    function calculateStakeClaimableAmount(uint256 stakeId) external override returns (uint256) {
        if (epochsCount == 0) {
            return 0;
        }
        return _calculateStakeRewardUntilEpoch(stakeId, epochsCount - 1, false);
    }

    /**
     * @notice Estimates reward percentages for given DLPs
     * @dev Calculates based on ratings and current epoch parameters
     */
    function estimatedDlpRewardPercentages(
        uint256[] memory dlpIds
    ) external view override returns (DlpRewardApy[] memory) {
        uint256[] memory percentages = new uint256[](2);
        percentages[0] = dlpRootMetrics.ratingPercentages(IDLPRootMetrics.RatingType.Stake);
        percentages[1] = dlpRootMetrics.ratingPercentages(IDLPRootMetrics.RatingType.Performance);

        return dlpRootMetrics.estimatedDlpRewardPercentages(dlpIds, percentages);
    }

    function dlpEpochStakeAmount(uint256 dlpId, uint256 epochId) external view override returns (uint256) {
        return _dlpComputedStakeAmountByBlock(dlpId, toUint48(_epochs[epochId].endBlock));
    }

    /**
     * @notice Gets top DLP IDs by rating (performanceRating + stakeRating)
     * @dev Uses insertion sort to maintain ordered list
     */
    function topDlpIds(uint256 numberOfDlps) external view override returns (uint256[] memory) {
        uint256[] memory percentages = new uint256[](2);
        percentages[0] = dlpRootMetrics.ratingPercentages(IDLPRootMetrics.RatingType.Stake);
        percentages[1] = dlpRootMetrics.ratingPercentages(IDLPRootMetrics.RatingType.Performance);

        return dlpRootMetrics.topDlpIds(epochsCount, numberOfDlps, _eligibleDlpsList.values(), percentages);
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function updateEligibleDlpsLimit(uint256 newEligibleDlpsLimit) external override onlyRole(MAINTAINER_ROLE) {
        if (epochDlpsLimit > newEligibleDlpsLimit) {
            revert InvalidParam();
        }

        eligibleDlpsLimit = newEligibleDlpsLimit;
        emit EligibleDlpsLimitUpdated(newEligibleDlpsLimit);
    }

    function updateMinStakeAmount(uint256 newMinStakeAmount) external override onlyRole(MAINTAINER_ROLE) {
        if (newMinStakeAmount > minDlpRegistrationStake) {
            revert InvalidParam();
        }

        minStakeAmount = newMinStakeAmount;
        emit MinStakeAmountUpdated(newMinStakeAmount);
    }

    function updateMinDlpStakersPercentage(
        uint256 newMinDlpStakersPercentage
    ) external override onlyRole(MAINTAINER_ROLE) {
        if (newMinDlpStakersPercentage < 1e16 || newMinDlpStakersPercentage > maxDlpStakersPercentage) {
            revert InvalidParam();
        }

        minDlpStakersPercentage = newMinDlpStakersPercentage;
        emit MinDlpStakersPercentageUpdated(newMinDlpStakersPercentage);
    }

    function updateMaxDlpStakersPercentage(
        uint256 newMaxDlpStakersPercentage
    ) external override onlyRole(MAINTAINER_ROLE) {
        if (newMaxDlpStakersPercentage > 100e18 || newMaxDlpStakersPercentage < minDlpStakersPercentage) {
            revert InvalidParam();
        }

        maxDlpStakersPercentage = newMaxDlpStakersPercentage;
        emit MaxDlpStakersPercentageUpdated(newMaxDlpStakersPercentage);
    }

    function updateMinDlpRegistrationStake(
        uint256 newMinDlpRegistrationStake
    ) external override onlyRole(MAINTAINER_ROLE) {
        if (minStakeAmount > newMinDlpRegistrationStake || newMinDlpRegistrationStake > dlpSubEligibilityThreshold) {
            revert InvalidParam();
        }
        minDlpRegistrationStake = newMinDlpRegistrationStake;
        emit MinDlpRegistrationStakeUpdated(newMinDlpRegistrationStake);
    }

    /**
     * @notice Updates eligibility threshold and adjusts DLP statuses
     */
    function updateDlpEligibilityThreshold(
        uint256 newDlpEligibilityThreshold
    ) external override onlyRole(MAINTAINER_ROLE) {
        if (dlpSubEligibilityThreshold > newDlpEligibilityThreshold) {
            revert InvalidParam();
        }

        dlpEligibilityThreshold = newDlpEligibilityThreshold;

        emit DlpEligibilityThresholdUpdated(newDlpEligibilityThreshold);
    }

    /**
     * @notice Updates sub-eligibility threshold and adjusts DLP statuses
     */
    function updateDlpSubEligibilityThreshold(
        uint256 newDlpSubEligibilityThreshold
    ) external override onlyRole(MAINTAINER_ROLE) {
        if (
            minDlpRegistrationStake > newDlpSubEligibilityThreshold ||
            newDlpSubEligibilityThreshold > dlpEligibilityThreshold
        ) {
            revert InvalidParam();
        }

        dlpSubEligibilityThreshold = newDlpSubEligibilityThreshold;

        emit DlpSubEligibilityThresholdUpdated(newDlpSubEligibilityThreshold);
    }

    function updateEpochDlpsLimit(uint256 newEpochDlpsLimit) external override onlyRole(MAINTAINER_ROLE) {
        if (newEpochDlpsLimit > eligibleDlpsLimit) {
            revert InvalidParam();
        }

        epochDlpsLimit = newEpochDlpsLimit;
        emit EpochDlpsLimitUpdated(newEpochDlpsLimit);
    }

    function updateStakeWithdrawalDelay(uint256 newStakeWithdrawalDelay) external override onlyRole(MAINTAINER_ROLE) {
        _checkpointPush(_stakeWithdrawalDelayCheckpoints, newStakeWithdrawalDelay);
        emit StakeWithdrawalDelayUpdated(newStakeWithdrawalDelay);
    }

    function updateRewardClaimDelay(uint256 newRewardClaimDelay) external override onlyRole(MAINTAINER_ROLE) {
        _checkpointPush(_rewardClaimDelayCheckpoints, newRewardClaimDelay);
        emit RewardClaimDelayUpdated(newRewardClaimDelay);
    }

    function updateEpochSize(uint256 newEpochSize) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        epochSize = newEpochSize;
        emit EpochSizeUpdated(newEpochSize);
    }

    function updateEpochRewardAmount(uint256 newEpochRewardAmount) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        epochRewardAmount = newEpochRewardAmount;
        emit EpochRewardAmountUpdated(newEpochRewardAmount);
    }

    function updateTrustedForwarder(address trustedForwarderAddress) external onlyRole(MAINTAINER_ROLE) {
        _trustedForwarder = trustedForwarderAddress;
    }

    function updateDlpRootMetrics(address newDlpRootMetricsAddress) external override onlyRole(MAINTAINER_ROLE) {
        dlpRootMetrics = IDLPRootMetrics(newDlpRootMetricsAddress);
    }

    function updateDlpRootRewardsTreasury(
        address newDlpRootRewardsTreasuryAddress
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        dlpRootRewardsTreasury = IDLPRootTreasury(newDlpRootRewardsTreasuryAddress);
    }

    function updateDlpRootStakesTreasury(
        address newDlpRootStakesTreasuryAddress
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        dlpRootStakesTreasury = IDLPRootTreasury(newDlpRootStakesTreasuryAddress);
    }

    function overrideEpoch(
        uint256 epochId,
        uint256 startBlock,
        uint256 endBlock,
        uint256 rewardAmount
    ) external override onlyRole(MAINTAINER_ROLE) {
        Epoch storage epoch = _epochs[epochId];
        epoch.startBlock = startBlock;
        epoch.endBlock = endBlock;
        epoch.rewardAmount = rewardAmount;

        emit EpochOverridden(epochId, startBlock, endBlock, rewardAmount);
    }

    function distributeEpochRewards(
        uint256 epochId,
        EpochDlpReward[] memory epochDlpRewards
    ) external override onlyRole(DLP_ROOT_METRICS_ROLE) {
        Epoch storage epoch = _epochs[epochId];

        epoch.isFinalised = true;

        uint256 index;
        uint256 dlpId;
        EpochDlp storage epochDlp;
        Dlp storage dlp;

        uint256 epochDlpsCount = epochDlpRewards.length;

        // Distribute rewards
        for (index = 0; index < epochDlpsCount; ) {
            dlpId = epochDlpRewards[index].dlpId;

            epoch.dlpIds.add(dlpId);
            dlp = _dlps[dlpId];
            dlp.epochIds[++dlp.epochIdsCount] = epochId;

            epochDlp = epoch.dlps[dlpId];
            epochDlp.rewardAmount = epochDlpRewards[index].rewardAmount;
            epochDlp.stakersRewardAmount = epochDlpRewards[index].stakersRewardAmount;

            bool success = dlpRootRewardsTreasury.transferVana(
                dlp.treasuryAddress,
                epochDlpRewards[index].rewardAmount
            );

            if (success) {
                epochDlp.rewardClaimed = true;

                emit DlpRewardClaimed(
                    dlpId,
                    epochId,
                    epochDlpRewards[index].rewardAmount,
                    epochDlpRewards[index].stakersRewardAmount
                );
            } else {
                //just skip this DLP; it will be fixed manually
            }

            unchecked {
                ++index;
            }
        }
    }

    /**
     * @notice Updates stake scores for DLPs in past epochs
     */
    function saveEpochDlpsTotalStakesScore(
        EpochDlpsTotalStakesScore[] memory stakeScore
    ) external override onlyRole(MANAGER_ROLE) {
        for (uint256 i = 0; i < stakeScore.length; ) {
            Epoch storage epoch = _epochs[stakeScore[i].epochId];
            EpochDlp storage epochDlp = epoch.dlps[stakeScore[i].dlpId];

            if (_dlps[stakeScore[i].dlpId].dlpAddress == address(0)) {
                revert InvalidDlpId();
            }

            if (epoch.endBlock > block.number || epoch.startBlock == 0) {
                revert EpochNotEnded();
            }

            if (epochDlp.totalStakesScore != 0) {
                revert EpochDlpScoreAlreadySaved();
            }

            epochDlp.totalStakesScore = stakeScore[i].totalStakesScore;

            emit EpochDlpScoreSaved(stakeScore[i].epochId, stakeScore[i].dlpId, stakeScore[i].totalStakesScore);

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Overrides stake scores for DLPs in past epochs
     */
    function overrideEpochDlpsTotalStakesScore(
        EpochDlpsTotalStakesScore memory stakeScore
    ) external override onlyRole(MAINTAINER_ROLE) {
        Epoch storage epoch = _epochs[stakeScore.epochId];
        if (_dlps[stakeScore.dlpId].dlpAddress == address(0)) {
            revert InvalidDlpId();
        }

        if (epoch.endBlock > block.number || epoch.startBlock == 0) {
            revert EpochNotEnded();
        }

        epoch.dlps[stakeScore.dlpId].totalStakesScore = stakeScore.totalStakesScore;

        emit EpochDlpScoreSaved(stakeScore.epochId, stakeScore.dlpId, stakeScore.totalStakesScore);
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

        if (
            dlpUpdateInfo.stakersPercentage < minDlpStakersPercentage ||
            dlpUpdateInfo.stakersPercentage > maxDlpStakersPercentage
        ) {
            revert InvalidStakersPercentage();
        }

        Dlp storage dlp = _dlps[dlpId];

        //this validation will be removed in the future
        if (dlp.dlpAddress != dlpUpdateInfo.dlpAddress) {
            revert DLpAddressCannotBeChanged();
        }

        dlp.ownerAddress = dlpUpdateInfo.ownerAddress;
        dlp.treasuryAddress = dlpUpdateInfo.treasuryAddress;
        if (dlp.stakersPercentageCheckpoints.latest() != dlpUpdateInfo.stakersPercentage) {
            _checkpointPush(dlp.stakersPercentageCheckpoints, dlpUpdateInfo.stakersPercentage);
        }
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
     * @notice Creates a new stake for a DLP
     */
    function createStake(uint256 dlpId) external payable override nonReentrant whenNotPaused {
        _createEpochsUntilBlockNumber(block.number);
        _createStake(_msgSender(), dlpId, msg.value);
    }

    /**
     * @notice Closes multiple stakes
     */
    function closeStakes(uint256[] memory stakeIds) external override nonReentrant whenNotPaused {
        _createEpochsUntilBlockNumber(block.number);
        for (uint256 i = 0; i < stakeIds.length; ) {
            _closeStake(_msgSender(), stakeIds[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Withdraws multiple closed stakes
     */
    function withdrawStakes(uint256[] memory stakeIds) external override nonReentrant whenNotPaused {
        _createEpochsUntilBlockNumber(block.number);
        for (uint256 i = 0; i < stakeIds.length; ) {
            _withdrawStake(_msgSender(), stakeIds[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Claims rewards for multiple stakes
     */
    function claimStakesReward(uint256[] memory stakeIds) external nonReentrant whenNotPaused {
        _createEpochsUntilBlockNumber(block.number);

        if (epochsCount == 0) {
            revert NothingToClaim();
        }

        for (uint256 i = 0; i < stakeIds.length; ) {
            _claimStakeRewardUntilEpoch(stakeIds[i], epochsCount - 1);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Claims rewards for a stake up to specified epoch
     */
    function claimStakeRewardUntilEpoch(uint256 stakeId, uint256 lastEpochToClaim) external nonReentrant whenNotPaused {
        _createEpochsUntilBlockNumber(block.number);
        if (epochsCount == 0) {
            revert InvalidParam();
        }
        uint256 maxEpoch = lastEpochToClaim < epochsCount - 1 ? lastEpochToClaim : epochsCount - 1;
        _claimStakeRewardUntilEpoch(stakeId, maxEpoch);
    }

    /**
     * @notice Calculates stake score based on amount and duration
     */
    function calculateStakeScore(
        uint256 stakeAmount,
        uint256 stakeStartBlock,
        uint256 blockNumber
    ) public view returns (uint256) {
        uint256 daysStaked = (blockNumber - stakeStartBlock) / daySize;
        return (stakeAmount * dlpRootMetrics.getMultiplier(daysStaked)) / 100;
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
        staker.dlpStakeAmounts[dlpId] += amount;
        staker.stakeIds.add(stakesCount);
        staker.totalStakeAmount += amount;

        _stakersList.add(stakerAddress);
        _checkpointAdd(dlp.stakeAmountCheckpoints, amount);

        (bool success, ) = payable(address(dlpRootStakesTreasury)).call{value: msg.value}("");

        if (!success) {
            revert TransferFailed();
        }

        emit StakeCreated(stakesCount, stakerAddress, dlpId, amount);

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

        Staker storage staker = _stakers[stakerAddress];
        staker.dlpStakeAmounts[stake.dlpId] -= stake.amount;
        staker.totalStakeAmount -= stake.amount;

        Dlp storage dlp = _dlps[stake.dlpId];
        _checkpointAdd(dlp.unstakeAmountCheckpoints, stake.amount);
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

        bool success = dlpRootStakesTreasury.transferVana(payable(stake.stakerAddress), stake.amount);
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

        if (dlpNameToId[registrationInfo.name] != 0 || bytes(registrationInfo.name).length == 0) {
            revert InvalidName();
        }

        if (
            registrationInfo.stakersPercentage < minDlpStakersPercentage ||
            registrationInfo.stakersPercentage > maxDlpStakersPercentage
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

        dlpNameToId[registrationInfo.name] = dlpId;

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

        _createStake(registrationInfo.ownerAddress, dlpId, msg.value);
    }

    /**
     * @notice Claims reward for a stake up to specified epoch
     * @dev Calculates and distributes rewards based on stake score
     */
    function _claimStakeRewardUntilEpoch(uint256 stakeId, uint256 lastEpochToClaim) internal {
        uint256 totalRewardAmount = _calculateStakeRewardUntilEpoch(stakeId, lastEpochToClaim, true);

        if (totalRewardAmount == 0) {
            revert NothingToClaim();
        }

        Stake storage stake = _stakes[stakeId];

        bool success = dlpRootRewardsTreasury.transferVana(payable(stake.stakerAddress), totalRewardAmount);
        if (!success) {
            revert TransferFailed();
        }
    }

    /**
     * @notice Calculates reward for a stake up to specified epoch
     */
    function _calculateStakeRewardUntilEpoch(
        uint256 stakeId,
        uint256 lastEpochToClaim,
        bool isClaim
    ) internal returns (uint256) {
        Stake storage stake = _stakes[stakeId];
        Dlp storage dlp = _dlps[stake.dlpId];

        uint256 totalRewardAmount;
        uint256 epochToClaimIndex = stake.lastClaimedIndexEpochId + 1;
        uint256 epochToClaim = dlp.epochIds[epochToClaimIndex];

        while (epochToClaim > 0 && epochToClaim <= lastEpochToClaim) {
            totalRewardAmount += _calculateStakeRewardByEpoch(stakeId, epochToClaim, isClaim);

            epochToClaim = dlp.epochIds[++epochToClaimIndex];
        }

        return totalRewardAmount;
    }

    /**
     * @notice Calculates reward for a stake up to specified epoch
     */
    function _calculateStakeRewardByEpoch(uint256 stakeId, uint256 epochId, bool isClaim) internal returns (uint256) {
        Stake storage stake = _stakes[stakeId];
        uint256 epochToClaimIndex = stake.lastClaimedIndexEpochId + 1;
        uint256 rewardClaimDelayTmp = rewardClaimDelay();

        Epoch storage epoch = _epochs[epochId];
        EpochDlp storage epochDlp = epoch.dlps[stake.dlpId];

        if (epochId == 0 || epochDlp.totalStakesScore == 0 || (stake.endBlock > 0 && epoch.endBlock > stake.endBlock)) {
            return 0;
        }

        uint256 stakeScore = calculateStakeScore(stake.amount, stake.startBlock, epoch.endBlock);

        uint256 rewardAmount = (epochDlp.stakersRewardAmount * stakeScore) / epochDlp.totalStakesScore;

        uint256 numberOfBlocks = block.number - epoch.endBlock;

        bool fullRewardAmount = true;

        if (rewardClaimDelayTmp > 0 && numberOfBlocks < rewardClaimDelayTmp) {
            rewardAmount = (rewardAmount * numberOfBlocks) / rewardClaimDelayTmp;
            fullRewardAmount = false;
        }

        if (stake.claimedAmounts[epochId] >= rewardAmount) {
            return 0;
        }

        uint256 claimableAmount = rewardAmount - stake.claimedAmounts[epochId];
        if (isClaim) {
            stake.claimedAmounts[epochId] = rewardAmount;
            emit StakeRewardClaimed(stakeId, epochId, rewardAmount, fullRewardAmount);

            if (fullRewardAmount) {
                stake.lastClaimedIndexEpochId = epochToClaimIndex;
            }
        }

        return claimableAmount;
    }

    /**
     * @notice Helper function to add value to checkpoint
     */
    function _checkpointAdd(Checkpoints.Trace208 storage store, uint256 delta) private returns (uint208, uint208) {
        return store.push(toUint48(block.number), store.latest() + toUint208(delta));
    }

    /**
     * @notice Helper function to set checkpoint value
     */
    function _checkpointPush(Checkpoints.Trace208 storage store, uint256 delta) private returns (uint208, uint208) {
        return store.push(toUint48(block.number), toUint208(delta));
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
            Epoch storage newEpoch = _epochs[++epochsCount];
            newEpoch.startBlock = lastEpoch.endBlock + 1;
            newEpoch.endBlock = newEpoch.startBlock + epochSize - 1;
            newEpoch.rewardAmount = epochRewardAmount;

            emit EpochCreated(epochsCount, newEpoch.startBlock, newEpoch.endBlock, newEpoch.rewardAmount);
            lastEpoch = newEpoch;
        }
    }

    function toUint48(uint256 value) internal pure returns (uint48) {
        if (value > type(uint48).max) {
            revert SafeCastOverflowedUintDowncast(48, value);
        }
        return uint48(value);
    }

    function toUint208(uint256 value) internal pure returns (uint208) {
        if (value > type(uint208).max) {
            revert SafeCastOverflowedUintDowncast(208, value);
        }
        return uint208(value);
    }

    // this method will be deleted; it will be used only for migration
    function transferVanaToStakesTreasury(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(dlpRootStakesTreasury) != address(0)) {
            (bool success, ) = payable(address(dlpRootStakesTreasury)).call{value: amount}("");

            if (!success) {
                revert TransferFailed();
            }
        }
    }

    // this method will be deleted; it will be used only for migration
    function transferVanaToRewardsTreasury(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(dlpRootRewardsTreasury) != address(0)) {
            (bool success, ) = payable(address(dlpRootRewardsTreasury)).call{value: amount}("");

            if (!success) {
                revert TransferFailed();
            }
        }
    }
}
