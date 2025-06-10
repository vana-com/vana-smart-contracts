// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./interfaces/DLPRewardDeployerStorageV1.sol";

contract DLPRewardDeployerImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
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

    error EpochNotFinalized();
    error NothingToDistribute(uint256 dlpId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address ownerAddress,
        address dlpRegistryAddress,
        address vanaEpochAddress,
        address dlpRewardSwapAddress,
        uint256 newNumberOfTranches,
        uint256 newRewardPercentage,
        uint256 newMaximumSlippagePercentage
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        dlpRegistry = IDLPRegistry(dlpRegistryAddress);
        vanaEpoch = IVanaEpoch(vanaEpochAddress);
        dlpRewardSwap = IDLPRewardSwap(dlpRewardSwapAddress);

        numberOfTranches = newNumberOfTranches;
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

    function updateMaximumSlippagePercentage(uint256 newMaximumSlippagePercentage) external override onlyRole(MAINTAINER_ROLE) {
        maximumSlippagePercentage = newMaximumSlippagePercentage;
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function epochDlpRewards(uint256 epochId, uint256 dlpId) external view returns (EpochDlpRewardInfo memory) {
        EpochDlpReward storage epochDlpReward = _epochRewards[epochId].epochDlpRewards[dlpId];

        return EpochDlpRewardInfo({
            totalDistributedAmount: epochDlpReward.totalDistributedAmount,
            tranchesCount: epochDlpReward.tranchesCount
        });
    }

    function epochDlpDistributedRewards(uint256 epochId, uint256 dlpId) external view returns (DistributedReward[]  memory) {
        EpochDlpReward storage epochDlpReward = _epochRewards[epochId].epochDlpRewards[dlpId];

        DistributedReward[] memory distributedRewards = new DistributedReward[](epochDlpReward.tranchesCount);

        for (uint256 i = 0; i < epochDlpReward.tranchesCount; i++) {
            distributedRewards[i] = epochDlpReward.distributedRewards[i + 1];  //tranches are 1-indexed
        }

        return distributedRewards;
    }


    function distributeRewards(uint256 epochId, uint256[] calldata dlpIds) external override onlyRole(REWARD_DEPLOYER_ROLE) whenNotPaused {
        IVanaEpoch.EpochInfo memory epoch = vanaEpoch.epochs(epochId);

        if (!epoch.isFinalized) {
            revert EpochNotFinalized();
        }

        for (uint256 i = 0; i < dlpIds.length; i++) {
            IDLPRegistry.DlpInfo memory dlp = dlpRegistry.dlps(dlpIds[i]);
            IVanaEpoch.EpochDlpInfo memory epochDlp = vanaEpoch.epochDlps(epochId, dlpIds[i]);

            EpochDlpReward storage epochDlpReward = _epochRewards[epochId].epochDlpRewards[dlpIds[i]];

            if (epochDlpReward.totalDistributedAmount >= epochDlp.rewardAmount) {
                revert NothingToDistribute(dlpIds[i]);
            }

            uint256 trancheAmount = (epochDlp.rewardAmount - epochDlpReward.totalDistributedAmount)  /
                (numberOfTranches - epochDlpReward.tranchesCount);

            ++epochDlpReward.tranchesCount;


            treasury.transfer(address(this), address(0), trancheAmount);

            (
                uint256 tokenRewardAmount,
                uint256 spareToken,
                uint256 spareVana,
                uint256 usedVanaAmount
            ) = dlpRewardSwap.splitRewardSwap{value: trancheAmount}(
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
                dlpIds[i],
                epochDlpReward.tranchesCount,
            trancheAmount,
                tokenRewardAmount,
                spareToken,
                spareVana,
                usedVanaAmount
            );
        }
    }

    receive() external payable {}
}
