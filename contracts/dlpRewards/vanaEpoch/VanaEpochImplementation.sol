// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/VanaEpochStorageV1.sol";

import "hardhat/console.sol";

contract VanaEpochImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    VanaEpochStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant DLP_PERFORMANCE_ROLE = keccak256("DLP_PERFORMANCE_ROLE");

    event EpochCreated(uint256 epochId, uint256 startBlock, uint256 endBlock, uint256 rewardAmount);
    event EpochUpdated(uint256 epochId, uint256 startBlock, uint256 endBlock, uint256 rewardAmount);
    event EpochSizeUpdated(uint256 newEpochSize);
    event EpochDayUpdated(uint256 newDaySize);
    event EpochRewardAmountUpdated(uint256 newEpochRewardAmount);
    event EpochDlpRewardAdded(uint256 epochId, uint256 dlpId, uint256 rewardAmount);
    event EpochFinalized(uint256 epochId);

    error EpochNotEnded();
    error EpochAlreadyFinalized();
    error InvalidEpoch();
    error EpochRewardExceeded();
    error EpochRewardNotDistributed();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    struct InitializeParams {
        address ownerAddress;
        address dlpRegistryAddress;
        uint256 daySize;
        uint256 epochSize;
        uint256 epochRewardAmount;
    }

    function initialize(
        InitializeParams memory params
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        dlpRegistry = IDLPRegistry     (params.dlpRegistryAddress);
        daySize = params.daySize;
        epochSize = params.epochSize;
        epochRewardAmount = params.epochRewardAmount;

        _grantRole(DEFAULT_ADMIN_ROLE, params.ownerAddress);
        _grantRole(MAINTAINER_ROLE, params.ownerAddress);
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
                isFinalized: _epochs[epochId].isFinalized
            });
    }

    function epochDlpIds(uint256 epochId) external view override returns (uint256[] memory) {
        return _epochs[epochId].dlpIds.values();
    }

    function epochDlps(uint256 epochId, uint256 dlpId) external view override returns (EpochDlpInfo memory) {
        Epoch storage epoch = _epochs[epochId];
        EpochDlp memory epochDlp = epoch.dlps[dlpId];

        return
            EpochDlpInfo({
                isTopDlp: epoch.dlpIds.contains(dlpId),
                rewardAmount: epochDlp.rewardAmount
            });
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function updateEpochSize(uint256 newEpochSizeInDays) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        epochSize = newEpochSizeInDays;
        emit EpochSizeUpdated(newEpochSizeInDays);
    }

    function updateEpochRewardAmount(uint256 newEpochRewardAmount) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        epochRewardAmount = newEpochRewardAmount;
        emit EpochRewardAmountUpdated(newEpochRewardAmount);
    }

    function updateDlpRegistry(address dlpRegistryAddress) external override onlyRole(MAINTAINER_ROLE) {
        dlpRegistry = IDLPRegistry(dlpRegistryAddress);
    }

    function updateDlpPerformance(address dlpPerformanceAddress) external override onlyRole(MAINTAINER_ROLE) {
        _revokeRole(DLP_PERFORMANCE_ROLE, address(dlpPerformance));
        dlpPerformance = IDLPPerformance(dlpPerformanceAddress);
        _grantRole(DLP_PERFORMANCE_ROLE, address(dlpPerformance));
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

    function saveEpochDlpRewards(
        uint256 epochId,
        Rewards[] calldata dlpRewards,
        bool finalScores
    ) external override nonReentrant whenNotPaused onlyRole(DLP_PERFORMANCE_ROLE) {
        if (epochId > epochsCount) {
            revert InvalidEpoch();
        } else if (epochId == epochsCount && finalScores) {
            revert EpochNotEnded();
        }

        Epoch storage epoch = _epochs[epochId];

        if (epoch.isFinalized) {
            revert EpochAlreadyFinalized();
        }

        for (uint256 i = 0; i < dlpRewards.length; i++) {
            uint256 dlpId = dlpRewards[i].dlpId;
            uint256 rewardAmount = dlpRewards[i].rewardAmount;

            if (rewardAmount > 0) {
                epoch.dlpIds.add(dlpId);
            } else {
                epoch.dlpIds.remove(dlpId);
            }

            epoch.dlps[dlpId].rewardAmount = rewardAmount;

            emit EpochDlpRewardAdded(epochId, dlpId, rewardAmount);
        }

        uint256 totalRewardAmount;
        for (uint256 i = 0; i < epoch.dlpIds.length(); i++) {
            totalRewardAmount += epoch.dlps[epoch.dlpIds.at(i)].rewardAmount;

            if (totalRewardAmount > epoch.rewardAmount) {
                revert EpochRewardExceeded();
            }
        }

        if (finalScores) {
            if (totalRewardAmount < epoch.rewardAmount - 1e9) { //1e9 represents calculation error tolerance
                revert EpochRewardNotDistributed();
            }
            epoch.isFinalized = true;

            emit EpochFinalized(epochId);
        }
    }

    function forceFinalizedEpoch(uint256 epochId) external override nonReentrant whenNotPaused onlyRole(MAINTAINER_ROLE) {
        _createEpochsUntilBlockNumber(block.number);

        if (epochId >= epochsCount) {
            revert EpochNotEnded();
        }

        Epoch storage epoch = _epochs[epochId];

        epoch.isFinalized = true;

        emit EpochFinalized(epochId);
    }

    function updateEpochsCount(uint256 newEpochsCount) external onlyRole(MAINTAINER_ROLE) {
        epochsCount = newEpochsCount;
    }


    function updateEpoch(
        uint256 epochId,
        uint256 startBlock,
        uint256 endBlock,
        uint256 rewardAmount,
        Rewards[] calldata dlpRewards,
        bool isFinalized
    ) external override onlyRole(MAINTAINER_ROLE) {
        Epoch storage epoch = _epochs[epochId];

        bool epochExists = epoch.startBlock != 0 || epoch.endBlock != 0 || epoch.rewardAmount != 0;

        epoch.startBlock = startBlock;
        epoch.endBlock = endBlock;
        epoch.rewardAmount = rewardAmount;
        epoch.isFinalized = isFinalized;

        for (uint256 i = 0; i < dlpRewards.length; i++) {
            uint256 dlpId = dlpRewards[i].dlpId;

            epoch.dlpIds.add(dlpId);
            epoch.dlps[dlpId].rewardAmount = dlpRewards[i].rewardAmount;
        }

        if (epochExists) {
            emit EpochUpdated(epochId, startBlock, endBlock, rewardAmount);
        } else {
            if (epochsCount < epochId) {
                epochsCount = epochId;
            }

            emit EpochCreated(epochId, startBlock, endBlock, rewardAmount);
        }
    }

    /**
     * @notice Creates epochs up to target block
     */
    function _createEpochsUntilBlockNumber(uint256 blockNumber) internal {
        Epoch storage lastEpoch = _epochs[epochsCount];

        if (lastEpoch.endBlock > block.number) {
            return;
        }

        while (lastEpoch.endBlock < blockNumber) {
            Epoch storage newEpoch = _epochs[++epochsCount];
            newEpoch.startBlock = lastEpoch.endBlock + 1;
            newEpoch.endBlock = newEpoch.startBlock + epochSize * daySize - 1;
            newEpoch.rewardAmount = epochRewardAmount;

            emit EpochCreated(epochsCount, newEpoch.startBlock, newEpoch.endBlock, newEpoch.rewardAmount);
            lastEpoch = newEpoch;
        }
    }

    function updateDaySize(uint256 newDaySize) external override onlyRole(MAINTAINER_ROLE) {
        daySize = newDaySize;

        emit EpochDayUpdated(newDaySize);
    }
}