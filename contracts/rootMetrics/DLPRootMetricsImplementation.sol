// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./interfaces/ERC2771ContextUpgradeableMock.sol";
import "./interfaces/DLPRootMetricsStorageV1.sol";

contract DLPRootMetricsImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ERC2771ContextUpgradeableMock,
    DLPRootMetricsStorageV1
{
    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant DLP_ROOT_ROLE = keccak256("DLP_ROOT_ROLE");

    event EpochFinalised(uint256 indexed epochId);
    event EpochPerformanceRatingsSaved(uint256 indexed epochId, uint256 totalPerformanceRating, bool isFinalized);
    event DlpEpochPerformanceRatingSaved(uint256 indexed epochId, uint256 indexed dlpId, uint256 performanceRating);
    event RatingPercentagesUpdated(RatingType ratingType, uint256 percentage);

    error EpochAlreadyFinalised();
    error EpochNotEndedYet();
    error InvalidPerformanceRating();
    error InvalidEpoch();
    error AllEligibleDlpsMustHavePerformanceRatings();
    error InvalidRatingPercentages();
    error EpochRewardsAlreadyDistributed();
    error DlpMustBeEligibleAndVerified(uint256 dlpId);
    error InvalidFoundationWalletAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address ownerAddress,
        address dlpRootAddress,
        uint256 stakeRatingPercentage,
        uint256 performanceRatingPercentage
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        dlpRoot = IDLPRoot(dlpRootAddress);

        _updateRatingPercentages(stakeRatingPercentage, performanceRatingPercentage);

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(MANAGER_ROLE, MAINTAINER_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
        _grantRole(MANAGER_ROLE, ownerAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    function foundationWalletAddress() external view override returns (address payable) {
        if (_foundationWalletAddress == address(0)) {
            revert InvalidFoundationWalletAddress();
        }
        return _foundationWalletAddress;
    }

    function epochs(uint256 epochId) external view override returns (EpochInfo memory) {
        Epoch storage epoch = _epochs[epochId];
        return
            EpochInfo({
                totalPerformanceRating: epoch.totalPerformanceRating,
                finalized: dlpRoot.dlpRootEpoch().epochs(epochId).isFinalised
            });
    }

    function epochDlps(uint256 epochId, uint256 dlpId) external view override returns (EpochDlpInfo memory) {
        return
            EpochDlpInfo({
                performanceRating: _epochs[epochId].dlps[dlpId].performanceRating,
                stakeAmountAdjustment: _epochs[epochId].dlps[dlpId].stakeAmountAdjustment
            });
    }

    /**
     * @notice Gets top DLP IDs by rating (performanceRating + stakeRating)
     * @dev Uses insertion sort to maintain ordered list
     */
    function topDlpsCustomized(
        uint256 epochId,
        uint256 numberOfDlps,
        uint256[] memory dlpIds,
        uint256[] memory customRatingPercentages
    ) public view override returns (DlpRating[] memory) {
        //sum of stakeAmount for all dlps in the list
        uint256 totalStakeAmount;
        uint256 totalPerformanceRating;

        for (uint256 i = 0; i < dlpIds.length; ) {
            totalStakeAmount += _dlpEpochStakeAmount(dlpIds[i], epochId);
            totalPerformanceRating += _epochs[epochId].dlps[dlpIds[i]].performanceRating;
            unchecked {
                ++i;
            }
        }

        uint256 dlpIdsCount = dlpIds.length;

        numberOfDlps = numberOfDlps < dlpIdsCount ? numberOfDlps : dlpIdsCount;

        DlpRating[] memory topDlpList = new DlpRating[](numberOfDlps);

        if (numberOfDlps == 0) {
            return topDlpList;
        }

        for (uint256 i = 0; i < dlpIdsCount; ) {
            uint256 currentDlpId = dlpIds[i];

            uint256 currentRating = calculateDlpRating(
                currentDlpId,
                epochId,
                totalStakeAmount,
                totalPerformanceRating,
                customRatingPercentages
            );

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

    function topDlps(uint256 numberOfDlps) public view override returns (DlpRating[] memory) {
        return
            topDlpsCustomized(
                dlpRoot.dlpRootEpoch().epochsCount(),
                numberOfDlps,
                dlpRoot.dlpRootCore().eligibleDlpsListValues(),
                new uint256[](0)
            );
    }

    function topDlpIds(uint256 numberOfDlps) public view override returns (uint256[] memory) {
        DlpRating[] memory dlpRating = topDlps(numberOfDlps);

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
    function estimatedDlpRewardPercentagesCustomized(
        uint256[] memory dlpIds,
        uint256[] memory customRatingPercentages
    ) public view override returns (DlpRewardApy[] memory) {
        TopDlpTotalRatings memory topDlpTotalRatings = _calculateTopDlpTotalRatings(
            dlpRoot.dlpRootEpoch().epochsCount(),
            customRatingPercentages
        );

        DlpRewardApy[] memory result = new DlpRewardApy[](dlpIds.length);
        uint256 i;

        for (i = 0; i < dlpIds.length; ) {
            result[i] = _calculateDlpRewardApy(dlpIds[i], topDlpTotalRatings, customRatingPercentages);

            unchecked {
                ++i;
            }
        }
        return result;
    }

    function estimatedDlpRewardPercentages(
        uint256[] memory dlpIds
    ) public view override returns (DlpRewardApy[] memory) {
        return estimatedDlpRewardPercentagesCustomized(dlpIds, new uint256[](0));
    }

    /**
     * @notice Returns stake score multiplier based number of days staked
     */
    function getMultiplier(uint256 daysStaked) external pure override returns (uint256) {
        if (daysStaked > 82) {
            return 30000;
        }

        uint16[83] memory multiplier = [
            476,
            952,
            1428,
            1904,
            2380,
            2857,
            3333,
            3809,
            4285,
            4761,
            5238,
            5714,
            6190,
            6666,
            7142,
            7619,
            8095,
            8571,
            9047,
            9523,
            10000,
            10200,
            10500,
            10700,
            11000,
            11200,
            11400,
            11700,
            11900,
            12100,
            12400,
            12600,
            12900,
            13100,
            13300,
            13600,
            13800,
            14000,
            14300,
            14500,
            14800,
            15000,
            15600,
            16200,
            16800,
            17400,
            18000,
            18600,
            19200,
            19800,
            20400,
            21000,
            21500,
            22100,
            22700,
            23300,
            23900,
            24500,
            25100,
            25700,
            26300,
            26900,
            27500,
            27600,
            27700,
            27900,
            28000,
            28100,
            28200,
            28300,
            28500,
            28600,
            28700,
            28800,
            28900,
            29000,
            29200,
            29300,
            29400,
            29500,
            29600,
            29800,
            29900
        ];
        return uint256(multiplier[daysStaked]);
    }

    function updateDlpRoot(address dlpRootAddress) external override onlyRole(MAINTAINER_ROLE) {
        dlpRoot = IDLPRoot(dlpRootAddress);
    }

    function updateFoundationWalletAddress(
        address payable foundationWalletAddress
    ) external override onlyRole(MAINTAINER_ROLE) {
        _foundationWalletAddress = foundationWalletAddress;
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function updateEpochDlpStakeAmountAdjustment(
        uint256 epochId,
        uint256 dlpId,
        uint256 adjustment,
        bool isAddition
    ) external override onlyRole(DLP_ROOT_ROLE) {
        if (isAddition) {
            _epochs[epochId].dlps[dlpId].stakeAmountAdjustment += adjustment;
        } else {
            //stakeAmountAdjustment is always > adjustment
            _epochs[epochId].dlps[dlpId].stakeAmountAdjustment -= adjustment;
        }
    }

    /**
     * @notice Saves or updates epoch performanceRatings for DLPs
     * @param epochId                 The epoch ID to save performanceRatings for
     * @param dlpPerformanceRatings   Array of DLP performanceRatings to save
     */
    function saveEpochPerformanceRatings(
        uint256 epochId,
        DlpPerformanceRating[] memory dlpPerformanceRatings
    ) external override onlyRole(MANAGER_ROLE) whenNotPaused {
        Epoch storage epoch = _epochs[epochId];

        if (dlpRoot.dlpRootEpoch().epochs(epochId).isFinalised) {
            revert EpochAlreadyFinalised();
        }

        uint256 dlpPerformanceRatingsLength = dlpPerformanceRatings.length;

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

        emit EpochPerformanceRatingsSaved(epochId, totalPerformanceRating, false);
    }

    /**
     * @notice Saves or updates epoch performanceRatings for DLPs
     * @param epochId                The epoch ID to save performanceRatings for
     */
    function finalizeEpoch(uint256 epochId) external override onlyRole(MANAGER_ROLE) whenNotPaused {
        if (dlpRoot.dlpRootEpoch().epochs(epochId).isFinalised) {
            revert EpochAlreadyFinalised();
        }

        IDLPRootEpoch.EpochInfo memory rootEpoch = dlpRoot.dlpRootEpoch().epochs(epochId);

        if (rootEpoch.endBlock >= block.number) {
            revert EpochNotEndedYet();
        }

        emit EpochFinalised(epochId);

        _calculateEpochRewards(epochId, dlpRoot.dlpRootCore().eligibleDlpsListValues());
    }

    function updateRatingPercentages(
        uint256 stakeRatingPercentage,
        uint256 performanceRatingPercentage
    ) external override onlyRole(MAINTAINER_ROLE) {
        _updateRatingPercentages(stakeRatingPercentage, performanceRatingPercentage);
    }

    function calculateDlpRating(
        uint256 dlpId,
        uint256 epochId,
        uint256 totalDlpsStakeAmount,
        uint256 totalDlpsPerformanceRating,
        uint256[] memory customRatingPercentages
    ) public view returns (uint256) {
        return
            _calculateDlpRating(
                _dlpEpochStakeAmount(dlpId, epochId),
                _epochs[epochId].dlps[dlpId].performanceRating,
                totalDlpsStakeAmount,
                totalDlpsPerformanceRating,
                customRatingPercentages
            );
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

    function _calculateEpochRewards(uint256 epochId, uint256[] memory dlpIds) internal {
        IDLPRootEpoch.EpochInfo memory epoch = dlpRoot.dlpRootEpoch().epochs(epochId);

        if (epoch.isFinalised == true) {
            revert EpochRewardsAlreadyDistributed();
        }

        IDLPRootMetrics.DlpRating[] memory topDlps = topDlpsCustomized(
            epochId,
            dlpRoot.dlpRootEpoch().epochDlpsLimit(),
            dlpIds,
            new uint256[](0)
        );

        uint256 totalTopDlpsRating;
        uint256 i;

        // Calculate total stake amount for top DLPs
        for (uint256 i = 0; i < topDlps.length; ) {
            totalTopDlpsRating += topDlps[i].rating;

            unchecked {
                ++i;
            }
        }

        uint256 dlpId;

        uint256 topDlpsCount = topDlps.length;

        IDLPRootEpoch.EpochDlpReward[] memory epochDlpRewards = new IDLPRootEpoch.EpochDlpReward[](topDlpsCount);
        uint256 totalDlpReward;
        uint256 stakersRewardAmount;

        // Calculate rewards
        for (i = 0; i < topDlpsCount; ) {
            dlpId = topDlps[i].dlpId;

            totalDlpReward = totalTopDlpsRating > 0 ? (topDlps[i].rating * epoch.rewardAmount) / totalTopDlpsRating : 0;

            stakersRewardAmount =
                (totalDlpReward * dlpRoot.dlpRootEpoch().epochDlps(epochId, dlpId).stakersPercentage) /
                100e18;

            epochDlpRewards[i] = IDLPRootEpoch.EpochDlpReward({
                dlpId: dlpId,
                ownerRewardAmount: totalDlpReward - stakersRewardAmount,
                stakersRewardAmount: stakersRewardAmount
            });

            unchecked {
                ++i;
            }
        }

        dlpRoot.dlpRootEpoch().distributeEpochRewards(epochId, epochDlpRewards);
    }

    function _dlpEpochStakeAmount(uint256 dlpId, uint256 epochId) internal view returns (uint256) {
        return
            dlpRoot.dlpRootEpoch().epochDlpStakeAmount(epochId, dlpId) -
            _epochs[epochId].dlps[dlpId].stakeAmountAdjustment;
    }

    function _calculateDlpRating(
        uint256 dlpStakeAmount,
        uint256 dlpPerformanceRating,
        uint256 totalDlpsStakeAmount,
        uint256 totalDlpsPerformanceRating,
        uint256[] memory customRatingPercentages
    ) internal view returns (uint256) {
        uint256 normalizedDlpStakeRating = totalDlpsStakeAmount > 0
            ? (1e18 * dlpStakeAmount) / totalDlpsStakeAmount
            : 0;
        uint256 normalizedDlpPerformanceRating = totalDlpsPerformanceRating > 0
            ? (1e18 * dlpPerformanceRating) / totalDlpsPerformanceRating
            : 0;

        uint256 stakeRatingPercentage;
        uint256 performanceRatingPercentage;

        if (customRatingPercentages.length == 2) {
            stakeRatingPercentage = customRatingPercentages[uint256(RatingType.Stake)];
            performanceRatingPercentage = customRatingPercentages[uint256(RatingType.Performance)];
        } else if (customRatingPercentages.length == 0) {
            stakeRatingPercentage = ratingPercentages[RatingType.Stake];
            performanceRatingPercentage = ratingPercentages[RatingType.Performance];
        } else {
            revert InvalidRatingPercentages();
        }

        return
            (stakeRatingPercentage *
                normalizedDlpStakeRating +
                performanceRatingPercentage *
                normalizedDlpPerformanceRating) / 1e20;
    }

    struct TopDlpTotalRatings {
        uint256 totalStakeAmount;
        uint256 totalStakeAmountAdjusted;
        uint256 totalRating;
        uint256 totalRatingAdjusted;
        uint256 totalPerformanceRating;
    }
    function _calculateTopDlpTotalRatings(
        uint256 epochId,
        uint256[] memory customRatingPercentages
    ) internal view returns (TopDlpTotalRatings memory) {
        IDLPRootMetrics.DlpRating[] memory topDlpsList = topDlpsCustomized(
            epochId,
            dlpRoot.dlpRootEpoch().epochDlpsLimit(),
            dlpRoot.dlpRootCore().eligibleDlpsListValues(),
            customRatingPercentages
        );

        uint256 i;
        TopDlpTotalRatings memory totalTopDlpsStakeAmount;

        uint256[] memory dlpStakeAmountsAdjusted = new uint256[](topDlpsList.length);
        uint256[] memory dlpStakeAmounts = new uint256[](topDlpsList.length);
        uint256[] memory dlpPerformanceRatings = new uint256[](topDlpsList.length);

        // Calculate total amount and ratings for top DLPs
        for (i = 0; i < topDlpsList.length; ) {
            dlpStakeAmounts[i] = dlpRoot.dlpRootCore().dlpEpochStakeAmount(topDlpsList[i].dlpId, epochId);
            dlpStakeAmountsAdjusted[i] =
                dlpStakeAmounts[i] -
                _epochs[epochId].dlps[topDlpsList[i].dlpId].stakeAmountAdjustment;
            dlpPerformanceRatings[i] = _epochs[epochId].dlps[topDlpsList[i].dlpId].performanceRating;

            totalTopDlpsStakeAmount.totalStakeAmountAdjusted += dlpStakeAmountsAdjusted[i];
            totalTopDlpsStakeAmount.totalStakeAmount += dlpStakeAmounts[i];
            totalTopDlpsStakeAmount.totalPerformanceRating += dlpPerformanceRatings[i];

            unchecked {
                ++i;
            }
        }

        // Calculate total amount and ratings for top DLPs
        for (i = 0; i < topDlpsList.length; ) {
            totalTopDlpsStakeAmount.totalRatingAdjusted += _calculateDlpRating(
                dlpStakeAmountsAdjusted[i],
                dlpPerformanceRatings[i],
                totalTopDlpsStakeAmount.totalStakeAmountAdjusted,
                totalTopDlpsStakeAmount.totalPerformanceRating,
                customRatingPercentages
            );
            totalTopDlpsStakeAmount.totalRating += _calculateDlpRating(
                dlpStakeAmounts[i],
                dlpPerformanceRatings[i],
                totalTopDlpsStakeAmount.totalStakeAmount,
                totalTopDlpsStakeAmount.totalPerformanceRating,
                customRatingPercentages
            );

            unchecked {
                ++i;
            }
        }

        return totalTopDlpsStakeAmount;
    }

    function _calculateDlpRewardApy(
        uint256 dlpId,
        TopDlpTotalRatings memory topDlpTotalRatings,
        uint256[] memory customRatingPercentages
    ) private view returns (DlpRewardApy memory) {
        uint256 epochRewardAmount = dlpRoot.dlpRootEpoch().epochRewardAmount();
        uint256 epochCount = dlpRoot.dlpRootEpoch().epochsCount();
        uint256 dlpStakeAmount = dlpRoot.dlpRootCore().dlpEpochStakeAmount(dlpId, epochCount);
        uint256 dlpStakeAmountAdjusted = dlpStakeAmount - _epochs[epochCount].dlps[dlpId].stakeAmountAdjustment;

        uint256 dlpRewardAdjusted = (_calculateDlpRating(
            dlpStakeAmountAdjusted,
            _epochs[epochCount].dlps[dlpId].performanceRating,
            topDlpTotalRatings.totalStakeAmountAdjusted,
            topDlpTotalRatings.totalPerformanceRating,
            customRatingPercentages
        ) * epochRewardAmount) / topDlpTotalRatings.totalRatingAdjusted;

        uint256 dlpReward = (_calculateDlpRating(
            dlpStakeAmount,
            _epochs[epochCount].dlps[dlpId].performanceRating,
            topDlpTotalRatings.totalStakeAmount,
            topDlpTotalRatings.totalPerformanceRating,
            customRatingPercentages
        ) * epochRewardAmount) / topDlpTotalRatings.totalRating;

        uint256 dlpStakersPercentageEpoch = dlpRoot.dlpRootEpoch().epochDlps(epochCount, dlpId).stakersPercentage;

        return
            DlpRewardApy({
                dlpId: dlpId,
                EPY: (dlpStakersPercentageEpoch * dlpRewardAdjusted) / dlpStakeAmountAdjusted,
                APY: (((dlpStakersPercentageEpoch * dlpReward) / dlpStakeAmount) *
                    365 *
                    dlpRoot.dlpRootEpoch().daySize()) / dlpRoot.dlpRootEpoch().epochSize()
            });
    }
}
