// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/DLPRootEpochStorageV1.sol";

contract DLPRootEpochImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    DLPRootEpochStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant DLP_ROOT_METRICS_ROLE = keccak256("DLP_ROOT_METRICS_ROLE");
    bytes32 public constant DLP_ROOT_ROLE = keccak256("DLP_ROOT_ROLE");

    event EpochCreated(uint256 epochId, uint256 startBlock, uint256 endBlock, uint256 rewardAmount);
    event EpochOverridden(uint256 epochId, uint256 startBlock, uint256 endBlock, uint256 rewardAmount);
    event EpochDlpsLimitUpdated(uint256 newEpochDlpsLimit);
    event EpochSizeUpdated(uint256 newEpochSize);
    event EpochRewardAmountUpdated(uint256 newEpochRewardAmount);
    event EpochDlpScoreSaved(uint256 indexed epochId, uint256 indexed dlpId, uint256 totalStakesScore);
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
    error DlpAddressCannotBeChanged();
    error TransferFailed();
    error EpochNotEnded();
    error EpochDlpScoreAlreadySaved();
    error EpochRewardsAlreadyDistributed();
    error LastEpochMustBeFinalised();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address ownerAddress, address dlpRootAddress) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        dlpRoot = IDLPRoot(dlpRootAddress);

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure virtual override returns (uint256) {
        return 1;
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
            : dlp.stakersPercentageCheckpoints.upperLookup(uint48(epoch.startBlock));

        return
            DlpEpochInfo({
                stakeAmount: _dlpComputedStakeAmountByBlock(dlpId, uint48(epoch.endBlock)),
                isTopDlp: epoch.dlpIds.contains(dlpId),
                rewardAmount: epochDlp.rewardAmount,
                stakersPercentage: stakersPercentageEpoch,
                totalStakesScore: epochDlp.totalStakesScore,
                rewardClaimed: epochDlp.rewardClaimed,
                stakersRewardAmount: epochDlp.stakersRewardAmount
            });
    }

    function dlpEpochStakeAmount(uint256 dlpId, uint256 epochId) external view override returns (uint256) {
        return _dlpComputedStakeAmountByBlock(dlpId, uint48(_epochs[epochId].endBlock));
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function updateEpochDlpsLimit(uint256 newEpochDlpsLimit) external override onlyRole(MAINTAINER_ROLE) {
        epochDlpsLimit = newEpochDlpsLimit;
        emit EpochDlpsLimitUpdated(newEpochDlpsLimit);
    }

    function updateEpochSize(uint256 newEpochSize) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        epochSize = newEpochSize;
        emit EpochSizeUpdated(newEpochSize);
    }

    function updateEpochRewardAmount(uint256 newEpochRewardAmount) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        epochRewardAmount = newEpochRewardAmount;
        emit EpochRewardAmountUpdated(newEpochRewardAmount);
    }

    function updateDlpRoot(address newDlpRootAddress) external override onlyRole(MAINTAINER_ROLE) {
        dlpRoot = IDLPRoot(newDlpRootAddress);
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

            //            bool success = dlpRootRewardsTreasury.transferVana(
            //                dlp.treasuryAddress,
            //                epochDlpRewards[index].rewardAmount
            //            );

            bool success = dlpRoot.dlpRootRewardsTreasury().transferVana(
                dlpRoot.dlpRootMetrics().foundationWalletAddress(),
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
     * @notice Creates and finalises epochs up to target block
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
}
