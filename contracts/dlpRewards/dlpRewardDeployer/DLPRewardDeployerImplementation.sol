// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/DLPRewardDeployerStorageV1.sol";

contract DLPRewardDeployerImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    DLPRewardDeployerStorageV1
{
    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant REWARD_DEPLOYER_ROLE = keccak256("REWARD_DEPLOYER_ROLE");

    event EpochDlpRewardDistributed(
        uint256 indexed epochId,
        uint256 indexed dlpId,
        uint256 indexed trancheId,
        uint256 trancheAmount,
        uint256 tokenRewardAmount,
        uint256 spareToken,
        uint256 spareVana,
        uint256 usedVanaAmount
    );

    event EpochDlpPenaltyDistributed(
        uint256 indexed epochId,
        uint256 indexed dlpId,
        uint256 distributedAmount,
        uint256 totalPenaltyAmount
    );
    event EpochRewardsInitialized(uint256 indexed epochId, uint256 numberOfTranches, uint256 remediationWindow);

    error EpochNotFinalized();
    error NothingToDistribute(uint256 dlpId);
    error NothingToWithdraw();
    error EpochRewardsNotInitialized();
    error TrancheIntervalNotStarted(uint256 dlpId, uint256 trancheCount, uint256 trancheMinBlock);
    error NumberOfBlocksBetweenTranchesNotPassed(uint256 dlpId, uint256 trancheCount, uint256 nextTrancheMinBlock);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    receive() external payable {}

    function initialize(
        address ownerAddress,
        address dlpRegistryAddress,
        address vanaEpochAddress,
        address dlpRewardSwapAddress,
        uint256 newNumberOfBlocksBetweenTranches,
        uint256 newRewardPercentage,
        uint256 newMaximumSlippagePercentage
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        dlpRegistry = IDLPRegistry(dlpRegistryAddress);
        vanaEpoch = IVanaEpoch(vanaEpochAddress);
        dlpRewardSwap = IDLPRewardSwap(dlpRewardSwapAddress);

        numberOfBlocksBetweenTranches = newNumberOfBlocksBetweenTranches;
        rewardPercentage = newRewardPercentage;
        maximumSlippagePercentage = newMaximumSlippagePercentage;

        _setRoleAdmin(REWARD_DEPLOYER_ROLE, MAINTAINER_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
        _grantRole(REWARD_DEPLOYER_ROLE, ownerAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    function updateDlpRegistry(address dlpRegistryAddress) external override onlyRole(MAINTAINER_ROLE) {
        dlpRegistry = IDLPRegistry(dlpRegistryAddress);
    }

    function updateVanaEpoch(address vanaEpochAddress) external override onlyRole(MAINTAINER_ROLE) {
        vanaEpoch = IVanaEpoch(vanaEpochAddress);
    }

    function updateTreasury(address treasuryAddress) external override onlyRole(MAINTAINER_ROLE) {
        treasury = ITreasury(treasuryAddress);
    }

    function updateDlpRewardSwap(address dlpRewardSwapAddress) external override onlyRole(MAINTAINER_ROLE) {
        dlpRewardSwap = IDLPRewardSwap(dlpRewardSwapAddress);
    }

    function updateRewardPercentage(uint256 newRewardPercentage) external override onlyRole(MAINTAINER_ROLE) {
        rewardPercentage = newRewardPercentage;
    }

    function updateNumberOfBlocksBetweenTranches(
        uint256 newNumberOfBlocksBetweenTranches
    ) external override onlyRole(MAINTAINER_ROLE) {
        numberOfBlocksBetweenTranches = newNumberOfBlocksBetweenTranches;
    }

    function updateMaximumSlippagePercentage(
        uint256 newMaximumSlippagePercentage
    ) external override onlyRole(MAINTAINER_ROLE) {
        maximumSlippagePercentage = newMaximumSlippagePercentage;
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function epochRewards(uint256 epochId) external view returns (EpochRewardInfo memory) {
        EpochReward storage epochReward = _epochRewards[epochId];

        return
            EpochRewardInfo({
                distributionInterval: epochReward.distributionInterval,
                numberOfTranches: epochReward.numberOfTranches,
                remediationWindow: epochReward.remediationWindow
            });
    }

    function epochDlpRewards(uint256 epochId, uint256 dlpId) external view returns (EpochDlpRewardInfo memory) {
        EpochDlpReward storage epochDlpReward = _epochRewards[epochId].epochDlpRewards[dlpId];

        return
            EpochDlpRewardInfo({
                totalDistributedAmount: epochDlpReward.totalDistributedAmount,
                distributedPenaltyAmount: epochDlpReward.distributedPenaltyAmount,
                tranchesCount: epochDlpReward.tranchesCount
            });
    }

    function epochDlpDistributedRewards(
        uint256 epochId,
        uint256 dlpId
    ) external view returns (DistributedReward[] memory) {
        EpochDlpReward storage epochDlpReward = _epochRewards[epochId].epochDlpRewards[dlpId];

        DistributedReward[] memory distributedRewards = new DistributedReward[](epochDlpReward.tranchesCount);

        for (uint256 i = 0; i < epochDlpReward.tranchesCount; i++) {
            distributedRewards[i] = epochDlpReward.distributedRewards[i + 1]; //tranches are 1-indexed
        }

        return distributedRewards;
    }

    function initializeEpochRewards(
        uint256 epochId,
        uint256 distributionInterval,
        uint256 numberOfTranches,
        uint256 remediationWindow
    ) external override onlyRole(MAINTAINER_ROLE) whenNotPaused {
        _epochRewards[epochId].distributionInterval = distributionInterval;
        _epochRewards[epochId].numberOfTranches = numberOfTranches;
        _epochRewards[epochId].remediationWindow = remediationWindow;

        emit EpochRewardsInitialized(epochId, numberOfTranches, remediationWindow);
    }

    function distributeRewards(
        uint256 epochId,
        uint256[] calldata dlpIds
    ) external override nonReentrant onlyRole(REWARD_DEPLOYER_ROLE) whenNotPaused {
        IVanaEpoch.EpochInfo memory epoch = vanaEpoch.epochs(epochId);

        if (!epoch.isFinalized) {
            revert EpochNotFinalized();
        }

        EpochReward storage epochReward = _epochRewards[epochId];

        if (epochReward.numberOfTranches == 0 || epochReward.remediationWindow == 0) {
            revert EpochRewardsNotInitialized();
        }

        for (uint256 i = 0; i < dlpIds.length; i++) {
            _checkTrancheStartBlock(epochId, dlpIds[i], epoch, epochReward);
            _distributeDlpNextTranche(epochId, dlpIds[i], epochReward);
        }
    }

    function withdrawEpochDlpPenaltyAmount(
        uint256 epochId,
        uint256 dlpId,
        address recipientAddress
    ) external override nonReentrant onlyRole(MAINTAINER_ROLE) whenNotPaused {
        IVanaEpoch.EpochDlpInfo memory epochDlp = vanaEpoch.epochDlps(epochId, dlpId);

        EpochDlpReward storage epochDlpReward = _epochRewards[epochId].epochDlpRewards[dlpId];
        uint256 distributedPenaltyAmount = epochDlpReward.distributedPenaltyAmount;

        if (epochDlp.penaltyAmount <= distributedPenaltyAmount) {
            revert NothingToWithdraw();
        }

        epochDlpReward.distributedPenaltyAmount = epochDlp.penaltyAmount;

        uint256 toWithdrawAmount = epochDlp.penaltyAmount - distributedPenaltyAmount;

        treasury.transfer(recipientAddress, address(0), toWithdrawAmount);

        emit EpochDlpPenaltyDistributed(epochId, dlpId, toWithdrawAmount, epochDlp.penaltyAmount);
    }

    function _checkTrancheStartBlock(
        uint256 epochId,
        uint256 dlpId,
        IVanaEpoch.EpochInfo memory epoch,
        EpochReward storage epochReward
    ) internal view {
        EpochDlpReward storage epochDlpReward = epochReward.epochDlpRewards[dlpId];

        uint256 currentTrancheNumber = epochDlpReward.tranchesCount;
        uint256 trancheMinBlock = epoch.endBlock +
            epochReward.remediationWindow +
            epochReward.distributionInterval *
            currentTrancheNumber;

        if (trancheMinBlock > block.number) {
            revert TrancheIntervalNotStarted(dlpId, currentTrancheNumber, trancheMinBlock);
        }

        uint256 nextTrancheMinBlock = epochDlpReward.distributedRewards[currentTrancheNumber].blockNumber +
            numberOfBlocksBetweenTranches;
        if (nextTrancheMinBlock > block.number) {
            revert NumberOfBlocksBetweenTranchesNotPassed(dlpId, currentTrancheNumber, nextTrancheMinBlock);
        }
    }

    function _distributeDlpNextTranche(uint256 epochId, uint256 dlpId, EpochReward storage epochReward) internal {
        IDLPRegistry.DlpInfo memory dlp = dlpRegistry.dlps(dlpId);

        IVanaEpoch.EpochDlpInfo memory epochDlp = vanaEpoch.epochDlps(epochId, dlpId);

        uint256 totalRewardToDistribute = epochDlp.penaltyAmount < epochDlp.rewardAmount
            ? epochDlp.rewardAmount - epochDlp.penaltyAmount
            : 0;

        EpochDlpReward storage epochDlpReward = epochReward.epochDlpRewards[dlpId];

        if (epochDlpReward.totalDistributedAmount >= totalRewardToDistribute) {
            revert NothingToDistribute(dlpId);
        }

        uint256 trancheAmount = (totalRewardToDistribute - epochDlpReward.totalDistributedAmount) /
            (epochReward.numberOfTranches - epochDlpReward.tranchesCount);

        ++epochDlpReward.tranchesCount;

        treasury.transfer(address(this), address(0), trancheAmount);

        (uint256 tokenRewardAmount, uint256 spareToken, uint256 spareVana, uint256 usedVanaAmount) = dlpRewardSwap
            .splitRewardSwap{value: trancheAmount}(
            IDLPRewardSwap.SplitRewardSwapParams({
                lpTokenId: dlp.lpTokenId,
                rewardPercentage: rewardPercentage,
                maximumSlippagePercentage: maximumSlippagePercentage,
                rewardRecipient: dlp.treasuryAddress,
                spareRecipient: address(treasury)
            })
        );

        epochDlpReward.totalDistributedAmount += trancheAmount;
        epochDlpReward.distributedRewards[epochDlpReward.tranchesCount] = DistributedReward({
            amount: trancheAmount,
            blockNumber: block.number,
            tokenRewardAmount: tokenRewardAmount,
            spareToken: spareToken,
            spareVana: spareVana,
            usedVanaAmount: usedVanaAmount
        });

        emit EpochDlpRewardDistributed(
            epochId,
            dlpId,
            epochDlpReward.tranchesCount,
            trancheAmount,
            tokenRewardAmount,
            spareToken,
            spareVana,
            usedVanaAmount
        );
    }
}
