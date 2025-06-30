// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./interfaces/DLPPerformanceStorageV1.sol";

import "hardhat/console.sol";

contract DLPPerformanceImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    DLPPerformanceStorageV1
{
    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    event EpochDlpPerformancesSaved(
        uint256 indexed epochId,
        uint256 indexed dlpId,
        uint256 tradingVolume,
        uint256 uniqueContributors,
        uint256 dataAccessFees,
        uint256 tradingVolumeScore,
        uint256 uniqueContributorsScore,
        uint256 dataAccessFeesScore
    );

    event EpochDlpPerformancesOverridden(
        uint256 indexed epochId,
        uint256 indexed dlpId,
        uint256 tradingVolume,
        uint256 uniqueContributors,
        uint256 dataAccessFees,
        uint256 tradingVolumeScore,
        uint256 uniqueContributorsScore,
        uint256 dataAccessFeesScore
    );

    event MetricWeightsUpdated(uint256 tradingVolume, uint256 uniqueContributors, uint256 dataAccessFees);

    event EpochDlpPenaltyUpdated(
        uint256 indexed epochId,
        uint256 indexed dlpId,
        uint256 tradingVolumeScorePenalty,
        uint256 uniqueContributorsScorePenalty,
        uint256 dataAccessFeesScorePenalty
    );

    error EpochNotEnded();
    error EpochAlreadyFinalized();
    error EpochNotFinalized();
    error InvalidMetricWeights();
    error InvalidEpochDlpPerformancesCount();
    error DlpNotEligible(uint256 dlpId);
    error InvalidTradingVolumeScore();
    error InvalidUniqueContributorsScore();
    error InvalidDataAccessFeesScore();
    error InvalidPenaltyScores();
    error PenaltyAmountLessThanPenaltyDistributed(
        uint256 epochId,
        uint256 dlpId,
        uint256 penaltyAmount,
        uint256 distributedPenaltyAmount
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address ownerAddress, address dlpRegistryAddress) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        dlpRegistry = IDLPRegistry(dlpRegistryAddress);

        _setRoleAdmin(MANAGER_ROLE, MAINTAINER_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
        _grantRole(MANAGER_ROLE, ownerAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    function metricWeights() public view override returns (MetricWeights memory) {
        return _metricWeights;
    }

    function epochMetricWeights(uint256 epochId) external view returns (MetricWeights memory) {
        return _epochPerformances[epochId].metricWeights;
    }

    function epochDlpPerformances(
        uint256 epochId,
        uint256 dlpId
    ) external view override returns (EpochDlpPerformanceInfo memory) {
        IVanaEpoch.EpochInfo memory epoch = vanaEpoch.epochs(epochId);
        IVanaEpoch.EpochDlpInfo memory epochDlpInfo = vanaEpoch.epochDlps(epochId, dlpId);

        bool isEligible = epoch.isFinalized ? epochDlpInfo.isTopDlp : dlpRegistry.isEligibleDlp(dlpId);

        if (!isEligible) {
            return
                EpochDlpPerformanceInfo({
                    totalScore: 0,
                    tradingVolume: 0,
                    uniqueContributors: 0,
                    dataAccessFees: 0,
                    tradingVolumeScore: 0,
                    uniqueContributorsScore: 0,
                    dataAccessFeesScore: 0,
                    tradingVolumeScorePenalty: 0,
                    uniqueContributorsScorePenalty: 0,
                    dataAccessFeesScorePenalty: 0
                });
        }

        EpochDlpPerformance storage epochDlpPerformance = _epochPerformances[epochId].epochDlpPerformances[dlpId];

        return
            EpochDlpPerformanceInfo({
                totalScore: (epochDlpPerformance.tradingVolumeScore *
                    _metricWeights.tradingVolume +
                    epochDlpPerformance.uniqueContributorsScore *
                    _metricWeights.uniqueContributors +
                    epochDlpPerformance.dataAccessFeesScore *
                    _metricWeights.dataAccessFees) / 1e18,
                tradingVolume: epochDlpPerformance.tradingVolume,
                uniqueContributors: epochDlpPerformance.uniqueContributors,
                dataAccessFees: epochDlpPerformance.dataAccessFees,
                tradingVolumeScore: epochDlpPerformance.tradingVolumeScore,
                uniqueContributorsScore: epochDlpPerformance.uniqueContributorsScore,
                dataAccessFeesScore: epochDlpPerformance.dataAccessFeesScore,
                tradingVolumeScorePenalty: epochDlpPerformance.tradingVolumeScorePenalty,
                uniqueContributorsScorePenalty: epochDlpPerformance.uniqueContributorsScorePenalty,
                dataAccessFeesScorePenalty: epochDlpPerformance.dataAccessFeesScorePenalty
            });
    }

    function updateDlpRegistry(address dlpRegistryAddress) external override onlyRole(MAINTAINER_ROLE) {
        dlpRegistry = IDLPRegistry(dlpRegistryAddress);
    }

    function updateVanaEpoch(address vanaEpochAddress) external override onlyRole(MAINTAINER_ROLE) {
        vanaEpoch = IVanaEpoch(vanaEpochAddress);
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function updateMetricWeights(MetricWeights calldata newMetricWeights) external override onlyRole(MAINTAINER_ROLE) {
        if (
            newMetricWeights.tradingVolume + newMetricWeights.uniqueContributors + newMetricWeights.dataAccessFees !=
            1e18
        ) {
            revert InvalidMetricWeights();
        }
        _metricWeights = newMetricWeights;

        emit MetricWeightsUpdated(
            newMetricWeights.tradingVolume,
            newMetricWeights.uniqueContributors,
            newMetricWeights.dataAccessFees
        );
    }

    function saveEpochPerformances(
        uint256 epochId,
        EpochDlpPerformanceInput[] calldata newEpochDlpPerformances
    ) external override onlyRole(MANAGER_ROLE) whenNotPaused {
        vanaEpoch.createEpochs();

        IVanaEpoch.EpochInfo memory epoch = vanaEpoch.epochs(epochId);

        if (epoch.isFinalized) {
            revert EpochAlreadyFinalized();
        }

        uint256 newEpochDlpPerformancesCount = newEpochDlpPerformances.length;

        if (newEpochDlpPerformancesCount != dlpRegistry.eligibleDlpsListCount()) {
            revert InvalidEpochDlpPerformancesCount();
        }

        uint256 tradingVolumeTotalScore;
        uint256 uniqueContributorsTotalScore;
        uint256 dataAccessFeesTotalScore;

        for (uint256 i = 0; i < newEpochDlpPerformancesCount; ) {
            if (dlpRegistry.isEligibleDlp(newEpochDlpPerformances[i].dlpId) == false) {
                revert DlpNotEligible(newEpochDlpPerformances[i].dlpId);
            }

            EpochDlpPerformanceInput calldata newEpochDlpPerformance = newEpochDlpPerformances[i];

            EpochDlpPerformance storage epochDlpPerformance = _epochPerformances[epochId].epochDlpPerformances[
                newEpochDlpPerformance.dlpId
            ];

            epochDlpPerformance.dataAccessFees = newEpochDlpPerformance.dataAccessFees;
            epochDlpPerformance.tradingVolume = newEpochDlpPerformance.tradingVolume;
            epochDlpPerformance.uniqueContributors = newEpochDlpPerformance.uniqueContributors;
            epochDlpPerformance.tradingVolumeScore = newEpochDlpPerformance.tradingVolumeScore;
            epochDlpPerformance.uniqueContributorsScore = newEpochDlpPerformance.uniqueContributorsScore;
            epochDlpPerformance.dataAccessFeesScore = newEpochDlpPerformance.dataAccessFeesScore;

            tradingVolumeTotalScore += newEpochDlpPerformance.tradingVolumeScore;
            uniqueContributorsTotalScore += newEpochDlpPerformance.uniqueContributorsScore;
            dataAccessFeesTotalScore += newEpochDlpPerformance.dataAccessFeesScore;

            emit EpochDlpPerformancesSaved(
                epochId,
                newEpochDlpPerformance.dlpId,
                newEpochDlpPerformance.tradingVolume,
                newEpochDlpPerformance.uniqueContributors,
                newEpochDlpPerformance.dataAccessFees,
                newEpochDlpPerformance.tradingVolumeScore,
                newEpochDlpPerformance.uniqueContributorsScore,
                newEpochDlpPerformance.dataAccessFeesScore
            );

            unchecked {
                ++i;
            }
        }

        //commented just on moksha
        //        if (tradingVolumeTotalScore > 1e18 || tradingVolumeTotalScore < 1e18 - 1e9) {
        //            revert InvalidTradingVolumeScore();
        //        }
        //
        //        if (uniqueContributorsTotalScore > 1e18 || uniqueContributorsTotalScore < 1e18 - 1e9) {
        //            revert InvalidUniqueContributorsScore();
        //        }
        //
        //        if (dataAccessFeesTotalScore > 1e18 || dataAccessFeesTotalScore < 1e18 - 1e9) {
        //            revert InvalidDataAccessFeesScore();
        //        }
    }

    function confirmEpochFinalScores(uint256 epochId) external override onlyRole(MAINTAINER_ROLE) {
        vanaEpoch.createEpochs();

        IVanaEpoch.EpochInfo memory epoch = vanaEpoch.epochs(epochId);

        if (epoch.isFinalized) {
            revert EpochAlreadyFinalized();
        }

        if (epoch.endBlock > block.number) {
            revert EpochNotEnded();
        }

        _epochPerformances[epochId].metricWeights = _metricWeights;

        uint256[] memory eligibleDlps = dlpRegistry.eligibleDlpsListValues();
        uint256 eligibleDlpsCount = eligibleDlps.length;

        IVanaEpoch.Rewards[] memory dlpRewards = new IVanaEpoch.Rewards[](eligibleDlpsCount);
        for (uint256 i = 0; i < eligibleDlpsCount; ) {
            (uint256 rewardAmount, uint256 penaltyAmount) = calculateEpochDlpRewards(epochId, eligibleDlps[i]);

            dlpRewards[i] = IVanaEpoch.Rewards({
                dlpId: eligibleDlps[i],
                rewardAmount: rewardAmount,
                penaltyAmount: penaltyAmount
            });

            unchecked {
                ++i;
            }
        }

        vanaEpoch.saveEpochDlpRewards(epochId, dlpRewards);
    }

    function overrideEpochPerformances(
        uint256 epochId,
        EpochDlpPerformanceInput[] calldata newEpochDlpPerformances
    ) external override onlyRole(MAINTAINER_ROLE) whenNotPaused {
        IVanaEpoch.EpochInfo memory epoch = vanaEpoch.epochs(epochId);

        if (!epoch.isFinalized) {
            revert EpochNotFinalized();
        }

        uint256 newEpochDlpPerformancesCount = newEpochDlpPerformances.length;

        for (uint256 i = 0; i < newEpochDlpPerformancesCount; ) {
            EpochDlpPerformanceInput calldata newEpochDlpPerformance = newEpochDlpPerformances[i];

            EpochDlpPerformance storage epochDlpPerformance = _epochPerformances[epochId].epochDlpPerformances[
                newEpochDlpPerformance.dlpId
            ];

            epochDlpPerformance.dataAccessFees = newEpochDlpPerformance.dataAccessFees;
            epochDlpPerformance.tradingVolume = newEpochDlpPerformance.tradingVolume;
            epochDlpPerformance.uniqueContributors = newEpochDlpPerformance.uniqueContributors;
            epochDlpPerformance.tradingVolumeScore = newEpochDlpPerformance.tradingVolumeScore;
            epochDlpPerformance.uniqueContributorsScore = newEpochDlpPerformance.uniqueContributorsScore;
            epochDlpPerformance.dataAccessFeesScore = newEpochDlpPerformance.dataAccessFeesScore;

            emit EpochDlpPerformancesOverridden(
                epochId,
                newEpochDlpPerformance.dlpId,
                newEpochDlpPerformance.tradingVolume,
                newEpochDlpPerformance.uniqueContributors,
                newEpochDlpPerformance.dataAccessFees,
                newEpochDlpPerformance.tradingVolumeScore,
                newEpochDlpPerformance.uniqueContributorsScore,
                newEpochDlpPerformance.dataAccessFeesScore
            );

            overrideEpochDlpReward(epochId, newEpochDlpPerformance.dlpId);

            unchecked {
                ++i;
            }
        }
    }

    function overrideEpochDlpPenalty(
        uint256 epochId,
        uint256 dlpId,
        uint256 tradingVolumeScorePenalty,
        uint256 uniqueContributorsScorePenalty,
        uint256 dataAccessFeesScorePenalty
    ) external onlyRole(MAINTAINER_ROLE) {
        if (
            tradingVolumeScorePenalty > 1e18 ||
            uniqueContributorsScorePenalty > 1e18 ||
            dataAccessFeesScorePenalty > 1e18
        ) {
            revert InvalidPenaltyScores();
        }

        EpochDlpPerformance storage epochDlpPerformance = _epochPerformances[epochId].epochDlpPerformances[dlpId];

        epochDlpPerformance.tradingVolumeScorePenalty = tradingVolumeScorePenalty;
        epochDlpPerformance.uniqueContributorsScorePenalty = uniqueContributorsScorePenalty;
        epochDlpPerformance.dataAccessFeesScorePenalty = dataAccessFeesScorePenalty;

        emit EpochDlpPenaltyUpdated(
            epochId,
            dlpId,
            tradingVolumeScorePenalty,
            uniqueContributorsScorePenalty,
            dataAccessFeesScorePenalty
        );

        overrideEpochDlpReward(epochId, dlpId);
    }

    function overrideEpochDlpReward(uint256 epochId, uint256 dlpId) public override onlyRole(MAINTAINER_ROLE) {
        IVanaEpoch.EpochInfo memory epoch = vanaEpoch.epochs(epochId);

        if (!epoch.isFinalized) {
            return;
        }

        (uint256 rewardAmount, uint256 penaltyAmount) = calculateEpochDlpRewards(epochId, dlpId);

        uint256 distributedPenaltyAmount = vanaEpoch.epochDlps(epochId, dlpId).distributedPenaltyAmount;
        if (penaltyAmount < distributedPenaltyAmount) {
            revert PenaltyAmountLessThanPenaltyDistributed(epochId, dlpId, penaltyAmount, distributedPenaltyAmount);
        }

        vanaEpoch.overrideEpochDlpReward(epochId, dlpId, rewardAmount, penaltyAmount);
    }

    function calculateEpochDlpRewards(
        uint256 epochId,
        uint256 dlpId
    ) public view override returns (uint256 rewardAmount, uint256 penaltyAmount) {
        EpochDlpPerformance storage epochDlpPerformance = _epochPerformances[epochId].epochDlpPerformances[dlpId];

        MetricWeights memory weights = _metricWeights;

        uint256 epochRewardAmount = vanaEpoch.epochs(epochId).rewardAmount;
        uint256 dataAccessFeesRewardAmount = (epochRewardAmount * weights.dataAccessFees) / 1e18;
        uint256 tradingVolumeRewardAmount = (epochRewardAmount * weights.tradingVolume) / 1e18;
        uint256 uniqueContributorsRewardAmount = (epochRewardAmount * weights.uniqueContributors) / 1e18;

        rewardAmount =
            (epochDlpPerformance.dataAccessFeesScore *
                dataAccessFeesRewardAmount +
                epochDlpPerformance.tradingVolumeScore *
                tradingVolumeRewardAmount +
                epochDlpPerformance.uniqueContributorsScore *
                uniqueContributorsRewardAmount) /
            1e18;

        penaltyAmount =
            (epochDlpPerformance.dataAccessFeesScore *
                epochDlpPerformance.dataAccessFeesScorePenalty *
                dataAccessFeesRewardAmount +
                epochDlpPerformance.tradingVolumeScore *
                epochDlpPerformance.tradingVolumeScorePenalty *
                tradingVolumeRewardAmount +
                epochDlpPerformance.uniqueContributorsScore *
                epochDlpPerformance.uniqueContributorsScorePenalty *
                uniqueContributorsRewardAmount) /
            1e36;
    }
}
