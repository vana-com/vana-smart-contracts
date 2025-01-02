// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./interfaces/DLPRootMetricsStorageV1.sol";

contract DLPRootMetricsImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ERC2771ContextUpgradeable,
    DLPRootMetricsStorageV1
{
    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    event EpochPerformanceRatingsSaved(uint256 indexed epochId, uint256 totalPerformanceRating, bool isFinalized);
    event DlpEpochPerformanceRatingSaved(uint256 indexed epochId, uint256 indexed dlpId, uint256 performanceRating);
    event RatingPercentagesUpdated(RatingType ratingType, uint256 percentage);

    error EpochAlreadyFinalized();
    error EpochNotEndedYet();
    error InvalidPerformanceRating();
    error InvalidEpoch();
    error AllEligibleDlpsMustHavePerformanceRatings();
    error InvalidRatingPercentages();
    error EpochRewardsAlreadyDistributed();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    function initialize(
        address trustedForwarderAddress,
        address ownerAddress,
        address dlpRootAddress,
        uint256 stakeRatingPercentage,
        uint256 performanceRatingPercentage
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _trustedForwarder = trustedForwarderAddress;
        dlpRoot = IDLPRoot(dlpRootAddress);

        _updateRatingPercentages(stakeRatingPercentage, performanceRatingPercentage);

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(MANAGER_ROLE, MAINTAINER_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
        _grantRole(MANAGER_ROLE, ownerAddress);
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

    function trustedForwarder() public view virtual override returns (address) {
        return _trustedForwarder;
    }

    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    function epochs(uint256 epochId) external view override returns (EpochInfo memory) {
        Epoch storage epoch = _epochs[epochId];
        return EpochInfo({totalPerformanceRating: epoch.totalPerformanceRating, finalized: epoch.finalized});
    }

    function epochDlps(uint256 epochId, uint256 dlpId) external view override returns (EpochDlpInfo memory) {
        return EpochDlpInfo({performanceRating: _epochs[epochId].dlps[dlpId].performanceRating});
    }

    /**
     * @notice Gets top DLP IDs by rating (performanceRating + stakeRating)
     * @dev Uses insertion sort to maintain ordered list
     */
    function topDlps(
        uint256 epochId,
        uint256 numberOfDlps,
        uint256[] memory dlpIds,
        uint256[] memory customRatingPercentages
    ) public view override returns (DlpRating[] memory) {
        //sum of stakeAmount for eligible eligible dlps
        uint256 totalStakeAmount;
        for (uint256 i = 0; i < dlpIds.length; ) {
            totalStakeAmount += dlpRoot.dlpEpochStakeAmount(dlpIds[i], epochId);
            unchecked {
                ++i;
            }
        }

        uint256 eligibleDlpsCount = dlpIds.length;

        numberOfDlps = numberOfDlps < eligibleDlpsCount ? numberOfDlps : eligibleDlpsCount;

        DlpRating[] memory topDlpList = new DlpRating[](numberOfDlps);

        if (numberOfDlps == 0) {
            return topDlpList;
        }

        for (uint256 i = 0; i < eligibleDlpsCount; ) {
            uint256 currentDlpId = dlpIds[i];
            uint256 currentStakeRating = totalStakeAmount > 0
                ? (1e18 * dlpRoot.dlpEpochStakeAmount(currentDlpId, epochId)) / totalStakeAmount
                : 0;
            uint256 currentPerformanceRating = _epochs[epochId].totalPerformanceRating > 0
                ? (1e18 * _epochs[epochId].dlps[currentDlpId].performanceRating) /
                    _epochs[epochId].totalPerformanceRating
                : 0;
            uint256 currentRating = customRatingPercentages[uint256(RatingType.Stake)] *
                currentStakeRating +
                customRatingPercentages[uint256(RatingType.Performance)] *
                currentPerformanceRating;

            uint256 position = numberOfDlps;
            for (uint256 j = 0; j < numberOfDlps; ) {
                if (
                    currentRating > topDlpList[j].rating ||
                    (currentRating == topDlpList[j].rating && currentDlpId < topDlpList[j].dlpId)
                ) {
                    position = j;
                    break;
                }

                unchecked {
                    ++j;
                }
            }

            if (position < numberOfDlps) {
                for (uint256 j = numberOfDlps - 1; j > position; ) {
                    topDlpList[j].dlpId = topDlpList[j - 1].dlpId;
                    topDlpList[j].rating = topDlpList[j - 1].rating;

                    unchecked {
                        --j;
                    }
                }

                topDlpList[position] = DlpRating({dlpId: currentDlpId, rating: currentRating});
            }

            unchecked {
                ++i;
            }
        }

        return topDlpList;
    }

    function topDlpIds(
        uint256 epochId,
        uint256 numberOfDlps,
        uint256[] memory dlpIds,
        uint256[] memory customRatingPercentages
    ) public view override returns (uint256[] memory) {
        DlpRating[] memory dlpRating = topDlps(epochId, numberOfDlps, dlpIds, customRatingPercentages);
        uint256 topDlpsCount = dlpRating.length;

        uint256[] memory topDlpIdsList = new uint256[](topDlpsCount);
        for (uint256 i = 0; i < topDlpsCount; ) {
            topDlpIdsList[i] = dlpRating[i].dlpId;

            unchecked {
                ++i;
            }
        }

        return topDlpIdsList;
    }

    /**
     * @notice Estimates reward percentages for given DLPs
     * @dev Calculates based on ratings and current epoch parameters
     */
    function estimatedDlpRewardPercentages(
        uint256[] memory dlpIds,
        uint256[] memory customRatingPercentages
    ) external view override returns (IDLPRoot.DlpRewardApy[] memory) {
        uint256 epochId = dlpRoot.epochsCount();

        IDLPRootMetrics.DlpRating[] memory topDlps = topDlps(
            epochId,
            dlpRoot.epochDlpsLimit(),
            dlpRoot.eligibleDlpsListValues(),
            customRatingPercentages
        );
        uint256 totalTopDlpsRatingAmount;

        uint256 topDlpsCount = topDlps.length;

        // Calculate total stake amount for top DLPs
        for (uint256 i = 0; i < topDlpsCount; ) {
            totalTopDlpsRatingAmount += topDlps[i].rating;

            unchecked {
                ++i;
            }
        }

        uint256 minTopDlpStake = 0;
        if (topDlpsCount > 0) {
            minTopDlpStake = topDlps[topDlpsCount - 1].rating;
        }

        IDLPRoot.DlpRewardApy[] memory result = new IDLPRoot.DlpRewardApy[](dlpIds.length);

        for (uint256 i = 0; i < dlpIds.length; ) {
            uint256 dlpId = dlpIds[i];

            uint256 dlpStakeRating = totalTopDlpsRatingAmount > 0
                ? (1e18 * dlpRoot.dlpEpochStakeAmount(dlpId, epochId)) / totalTopDlpsRatingAmount
                : 0;
            uint256 dlpPerformanceRating = _epochs[epochId].totalPerformanceRating > 0
                ? (1e18 * _epochs[epochId].dlps[dlpId].performanceRating) / _epochs[epochId].totalPerformanceRating
                : 0;
            uint256 dlpRating = 80 * dlpStakeRating + 20 * dlpPerformanceRating;

            uint256 stakersPercentage = dlpRoot.dlps(dlpId).stakersPercentageEpoch;

            uint256 dlpReward = (dlpRating * dlpRoot.epochRewardAmount()) / totalTopDlpsRatingAmount;
            uint256 epy = (stakersPercentage * dlpReward) / dlpRating;

            uint256 apy = (epy * 365 * dlpRoot.daySize()) / dlpRoot.epochSize();

            result[i] = IDLPRoot.DlpRewardApy({dlpId: dlpId, EPY: epy, APY: apy});

            unchecked {
                ++i;
            }
        }
        return result;
    }

    /**
     * @notice Returns stake score multiplier based on duration
     */
    function getMultiplier(uint256 index) external pure override returns (uint256) {
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

    function updateDlpRoot(address dlpRootAddress) external override onlyRole(MAINTAINER_ROLE) {
        dlpRoot = IDLPRoot(dlpRootAddress);
    }

    function updateTrustedForwarder(address trustedForwarderAddress) external onlyRole(MAINTAINER_ROLE) {
        _trustedForwarder = trustedForwarderAddress;
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    /**
     * @notice Saves or updates epoch performanceRatings for DLPs
     * @param epochId                The epoch ID to save performanceRatings for
     * @param shouldFinalize         If true, the epoch will be finalized and no more performanceRatings can be saved
     * @param dlpPerformanceRatings   Array of DLP performanceRatings to save
     */
    function saveEpochPerformanceRatings(
        uint256 epochId,
        bool shouldFinalize,
        DlpPerformanceRating[] memory dlpPerformanceRatings
    ) external override onlyRole(MANAGER_ROLE) whenNotPaused {
        Epoch storage epoch = _epochs[epochId];

        if (epoch.finalized) {
            revert EpochAlreadyFinalized();
        }

        // If trying to lock performanceRatings, verify epoch has ended
        if (shouldFinalize) {
            IDLPRoot.EpochInfo memory rootEpoch = dlpRoot.epochs(epochId);
            if (rootEpoch.endBlock >= block.number) {
                revert EpochNotEndedYet();
            }
        }

        uint256 dlpPerformanceRatingsLength = dlpPerformanceRatings.length;

        uint256[] memory eligibleDlpIds = dlpRoot.eligibleDlpsListValues();

        //check if all eligible dlp id present in dlpPerformanceRatings
        // Create a mapping of DLP IDs being updated
        bool[] memory dlpPerformanceRatingsMap = new bool[](dlpRoot.dlpsCount() + 1);

        for (uint256 i = 0; i < dlpPerformanceRatingsLength; ) {
            dlpPerformanceRatingsMap[dlpPerformanceRatings[i].dlpId] = true;
            unchecked {
                ++i;
            }
        }
        uint256 dlpIdsLength = eligibleDlpIds.length;
        for (uint256 i = 0; i < dlpIdsLength; ) {
            if (!dlpPerformanceRatingsMap[eligibleDlpIds[i]]) {
                revert AllEligibleDlpsMustHavePerformanceRatings();
            }
            unchecked {
                ++i;
            }
        }

        uint256 totalPerformanceRating;
        for (uint256 i = 0; i < dlpPerformanceRatingsLength; ) {
            DlpPerformanceRating memory dlpPerformanceRating = dlpPerformanceRatings[i];

            epoch.dlps[dlpPerformanceRating.dlpId].performanceRating = dlpPerformanceRating.performanceRating;
            totalPerformanceRating += dlpPerformanceRating.performanceRating;

            emit DlpEpochPerformanceRatingSaved(
                epochId,
                dlpPerformanceRating.dlpId,
                dlpPerformanceRating.performanceRating
            );

            unchecked {
                ++i;
            }
        }

        epoch.totalPerformanceRating = totalPerformanceRating;

        emit EpochPerformanceRatingsSaved(epochId, totalPerformanceRating, shouldFinalize);

        if (shouldFinalize) {
            epoch.finalized = true;
            _calculateEpochRewards(epochId);
        }
    }

    function updateRatingPercentages(
        uint256 stakeRatingPercentage,
        uint256 performanceRatingPercentage
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _updateRatingPercentages(stakeRatingPercentage, performanceRatingPercentage);
    }

    function _updateRatingPercentages(uint256 stakeRatingPercentage, uint256 performanceRatingPercentage) internal {
        if (stakeRatingPercentage + performanceRatingPercentage != 100e18) {
            revert InvalidRatingPercentages();
        }

        ratingPercentages[RatingType.Stake] = stakeRatingPercentage;
        ratingPercentages[RatingType.Performance] = performanceRatingPercentage;

        emit RatingPercentagesUpdated(RatingType.Performance, performanceRatingPercentage);
        emit RatingPercentagesUpdated(RatingType.Stake, stakeRatingPercentage);
    }

    function _calculateEpochRewards(uint256 epochId) internal {
        dlpRoot.createEpochs();

        if (epochId != dlpRoot.epochsCount() - 1) {
            revert InvalidEpoch();
        }

        IDLPRoot.EpochInfo memory epoch = dlpRoot.epochs(epochId);

        if (epoch.isFinalised == true) {
            revert EpochRewardsAlreadyDistributed();
        }

        uint256[] memory percentages = new uint256[](2);
        percentages[0] = ratingPercentages[RatingType.Stake];
        percentages[1] = ratingPercentages[RatingType.Performance];

        IDLPRootMetrics.DlpRating[] memory topDlps = topDlps(
            epochId,
            dlpRoot.epochDlpsLimit(),
            dlpRoot.eligibleDlpsListValues(),
            percentages
        );

        uint256 index;
        uint256 topDlpsTotalRatingAmount;
        uint256 dlpId;

        uint256 topDlpsCount = topDlps.length;

        // Calculate total rating amount
        for (index = 0; index < topDlpsCount; ) {
            topDlpsTotalRatingAmount += topDlps[index].rating;
            unchecked {
                ++index;
            }
        }

        IDLPRoot.EpochDlpReward[] memory epochDlpRewards = new IDLPRoot.EpochDlpReward[](topDlpsCount);
        uint256 totalDlpReward;
        uint256 stakersRewardAmount;

        // Distribute rewards
        for (index = 0; index < topDlpsCount; ) {
            dlpId = topDlps[index].dlpId;

            totalDlpReward = (topDlps[index].rating * epoch.rewardAmount) / topDlpsTotalRatingAmount;

            stakersRewardAmount = (totalDlpReward * dlpRoot.dlpEpochs(dlpId, epochId).stakersPercentage) / 100e18;

            epochDlpRewards[index] = IDLPRoot.EpochDlpReward({
                dlpId: dlpId,
                rewardAmount: totalDlpReward - stakersRewardAmount,
                stakersRewardAmount: stakersRewardAmount
            });

            unchecked {
                ++index;
            }
        }

        dlpRoot.distributeEpochRewards(epochId, epochDlpRewards);
    }
}
