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
    bytes32 public constant DLP_ROOT_CORE_ROLE = keccak256("DLP_ROOT_CORE_ROLE");

    uint256 public constant NEW_MULTIPLIER_EPOCH = 3;

    event MinStakeAmountUpdated(uint256 newMinStakeAmount);
    event StakeWithdrawalDelayUpdated(uint256 newStakeWithdrawalDelay);
    event RewardClaimDelayUpdated(uint256 newRewardClaimDelay);
    event StakeCreated(uint256 stakeId, address indexed staker, uint256 indexed dlpId, uint256 amount);
    event StakeClosed(uint256 indexed stakeId);
    event StakeWithdrawn(uint256 indexed stakeId);
    event StakeMigrated(uint256 oldDtakeId, uint256 newStakeId, uint256 indexed newDlpId, uint256 newAmount);
    event StakeRewardClaimed(uint256 indexed stakeId, uint256 indexed epochId, uint256 amount, bool isFinal);

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
    error NotStakeOwner();
    error NothingToClaim();
    error InvalidStakersPercentage();
    error TransferFailed();
    error EpochNotEnded();
    error LastEpochMustBeFinalised();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    function initialize(address ownerAddress) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
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
        return 4;
    }

    function stakeWithdrawalDelay() public view returns (uint256) {
        return _stakeWithdrawalDelayCheckpoints.latest();
    }

    function rewardClaimDelay() public view returns (uint256) {
        return _rewardClaimDelayCheckpoints.latest();
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
                lastClaimedEpochId: stake.lastClaimedIndexEpochId
            });
    }

    function stakeClaimedAmounts(uint256 stakeId, uint256 epochId) external view override returns (uint256) {
        return _stakes[stakeId].claimedAmounts[epochId];
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
        return _calculateStakeRewardUntilEpoch(stakeId, dlpRootEpoch.epochsCount() - 1, false);
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function updateMinStakeAmount(uint256 newMinStakeAmount) external override onlyRole(MAINTAINER_ROLE) {
        if (newMinStakeAmount > dlpRootCore.minDlpRegistrationStake()) {
            revert InvalidParam();
        }

        minStakeAmount = newMinStakeAmount;
        emit MinStakeAmountUpdated(newMinStakeAmount);
    }

    function updateStakeWithdrawalDelay(uint256 newStakeWithdrawalDelay) external override onlyRole(MAINTAINER_ROLE) {
        _checkpointPush(_stakeWithdrawalDelayCheckpoints, newStakeWithdrawalDelay);
        emit StakeWithdrawalDelayUpdated(newStakeWithdrawalDelay);
    }

    function updateRewardClaimDelay(uint256 newRewardClaimDelay) external override onlyRole(MAINTAINER_ROLE) {
        _checkpointPush(_rewardClaimDelayCheckpoints, newRewardClaimDelay);
        emit RewardClaimDelayUpdated(newRewardClaimDelay);
    }

    function updateTrustedForwarder(address trustedForwarderAddress) external onlyRole(MAINTAINER_ROLE) {
        _trustedForwarder = trustedForwarderAddress;
    }

    function updateDlpRootMetrics(address newDlpRootMetricsAddress) external override onlyRole(MAINTAINER_ROLE) {
        dlpRootMetrics = IDLPRootMetrics(newDlpRootMetricsAddress);
    }

    function updateDlpRootCore(address newDlpRootCoreAddress) external override onlyRole(MAINTAINER_ROLE) {
        dlpRootCore = IDLPRootCore(newDlpRootCoreAddress);
    }
    function updateDlpRootEpoch(address newDlpRootEpochAddress) external override onlyRole(MAINTAINER_ROLE) {
        dlpRootEpoch = IDLPRootEpoch(newDlpRootEpochAddress);
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

    function createStake(uint256 dlpId) external payable override nonReentrant whenNotPaused {
        dlpRootEpoch.createEpochsUntilBlockNumber(block.number);

        _createStake(_msgSender(), dlpId, msg.value, block.number);
    }

    function createStakeOnBehalf(
        uint256 dlpId,
        address stakeOwner
    ) external payable override nonReentrant whenNotPaused {
        dlpRootEpoch.createEpochsUntilBlockNumber(block.number);

        _createStake(stakeOwner, dlpId, msg.value, block.number);
    }

    /**
     * @notice Closes multiple stakes
     */
    function closeStakes(uint256[] memory stakeIds) external override nonReentrant whenNotPaused {
        dlpRootEpoch.createEpochsUntilBlockNumber(block.number);
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
        dlpRootEpoch.createEpochsUntilBlockNumber(block.number);
        for (uint256 i = 0; i < stakeIds.length; ) {
            _withdrawStake(_msgSender(), stakeIds[i]);
            unchecked {
                ++i;
            }
        }
    }

    function migrateStake(
        uint256 stakeId,
        uint256 newDlpId,
        uint256 newAmount
    ) external override nonReentrant whenNotPaused {
        dlpRootEpoch.createEpochsUntilBlockNumber(block.number);

        Stake storage stake = _stakes[stakeId];

        if (newDlpId != stake.dlpId) {
            revert InvalidDlpId();
        }

        if (newAmount > stake.amount) {
            revert InvalidStakeAmount();
        }

        _closeStake(_msgSender(), stakeId);
        stake.movedAmount = newAmount;

        _createStake(_msgSender(), newDlpId, newAmount, stake.startBlock);

        emit StakeMigrated(stakeId, stakesCount, newDlpId, newAmount);
    }

    /**
     * @notice Claims rewards for multiple stakes
     */
    function claimStakesReward(uint256[] memory stakeIds) external override nonReentrant whenNotPaused {
        dlpRootEpoch.createEpochsUntilBlockNumber(block.number);

        for (uint256 i = 0; i < stakeIds.length; ) {
            _claimStakeRewardUntilEpoch(stakeIds[i], dlpRootEpoch.epochsCount() - 1);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Claims rewards for a stake up to specified epoch
     */
    function claimStakeRewardUntilEpoch(
        uint256 stakeId,
        uint256 lastEpochToClaim
    ) external override nonReentrant whenNotPaused {
        dlpRootEpoch.createEpochsUntilBlockNumber(block.number);
        uint256 epochsCount = dlpRootEpoch.epochsCount();
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
    ) public view override returns (uint256) {
        uint256 daySize = dlpRootEpoch.daySize();
        uint256 daysStaked = (blockNumber - stakeStartBlock) / daySize;
        // changed the multiplier formula but we want to keep the same behavior for stakes before epoch3
        if (stakeStartBlock <= dlpRootEpoch.epochs(NEW_MULTIPLIER_EPOCH - 1).endBlock) {
            daysStaked += dlpRootEpoch.epochSize() / daySize - 1;
        }
        return (stakeAmount * dlpRootMetrics.getMultiplier(daysStaked)) / 10000;
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

        uint256 totalRewardAmount;
        uint256 epochToClaim = stake.lastClaimedIndexEpochId + 1;

        while (epochToClaim <= lastEpochToClaim) {
            totalRewardAmount += _calculateStakeRewardByEpoch(stakeId, epochToClaim, isClaim);

            ++epochToClaim;
        }

        return totalRewardAmount;
    }

    /**
     * @notice Calculates reward for a stake up to specified epoch
     */
    function _calculateStakeRewardByEpoch(uint256 stakeId, uint256 epochId, bool isClaim) internal returns (uint256) {
        Stake storage stake = _stakes[stakeId];
        uint256 epochToClaim = stake.lastClaimedIndexEpochId + 1;
        uint256 rewardClaimDelayTmp = rewardClaimDelay();

        IDLPRootEpoch.EpochInfo memory epoch = dlpRootEpoch.epochs(epochId);
        IDLPRootEpoch.EpochDlpInfo memory epochDlp = dlpRootEpoch.epochDlps(epochId, stake.dlpId);

        if (
            epochId == 0 ||
            epochDlp.totalStakesScore == 0 ||
            stake.startBlock > epoch.endBlock ||
            (stake.endBlock > 0 && epoch.endBlock > stake.endBlock)
        ) {
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
                stake.lastClaimedIndexEpochId = epochToClaim;
            }
        }

        return claimableAmount;
    }

    /**
     * @notice Creates a new stake for a DLP
     * @dev Validates stake amount and DLP status before creating
     */
    function _createStake(address stakerAddress, uint256 dlpId, uint256 amount, uint256 startBlock) internal {
        if (stakerAddress == address(0)) {
            revert InvalidAddress();
        }

        if (amount < minStakeAmount) {
            revert InvalidStakeAmount();
        }

        IDLPRootCore.DlpInfo memory dlp = dlpRootCore.dlps(dlpId);

        if (dlp.status == IDLPRootCore.DlpStatus.None || dlp.status == IDLPRootCore.DlpStatus.Deregistered) {
            revert InvalidDlpStatus();
        }

        uint256 epochsCount = dlpRootEpoch.epochsCount();

        Stake storage stake = _stakes[++stakesCount];
        stake.amount = amount;
        stake.startBlock = startBlock;
        stake.stakerAddress = stakerAddress;
        stake.dlpId = dlpId;
        stake.lastClaimedIndexEpochId = epochsCount > 1 ? epochsCount - 1 : 0;

        Staker storage staker = _stakers[stakerAddress];
        staker.dlpIds.add(dlpId);
        staker.dlpStakeAmounts[dlpId] += amount;
        staker.stakeIds.add(stakesCount);
        staker.totalStakeAmount += amount;

        _stakersList.add(stakerAddress);

        IDLPRootEpoch.EpochInfo memory epoch = dlpRootEpoch.epochs(epochsCount);
        if (startBlock >= epoch.startBlock && epochsCount >= NEW_MULTIPLIER_EPOCH) {
            // we know that amount > calculateStakeScore(amount, startBlock, _epochs[epochsCount].endBlock
            // because the multiplier during the current epoch is less than 10000
            dlpRootMetrics.updateEpochDlpStakeAmountAdjustment(
                epochsCount,
                dlpId,
                amount - calculateStakeScore(amount, startBlock, dlpRootEpoch.epochs(epochsCount).endBlock),
                true
            );
        }

        (bool success, ) = payable(address(dlpRootStakesTreasury)).call{value: msg.value}("");

        if (!success) {
            revert TransferFailed();
        }

        dlpRootCore.addDlpStake(dlpId, amount);

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

        Staker storage staker = _stakers[stakerAddress];
        staker.dlpStakeAmounts[stake.dlpId] -= stake.amount;
        staker.totalStakeAmount -= stake.amount;

        stake.endBlock = block.number;

        uint256 epochsCount = dlpRootEpoch.epochsCount();
        IDLPRootEpoch.EpochInfo memory epoch = dlpRootEpoch.epochs(epochsCount);

        //we need to subtract the epoch dlp stake amount adjustment if the stake was created and closed in the current epoch
        if (epochsCount >= NEW_MULTIPLIER_EPOCH && stake.startBlock > epoch.startBlock) {
            dlpRootMetrics.updateEpochDlpStakeAmountAdjustment(
                epochsCount,
                stake.dlpId,
                stake.amount - calculateStakeScore(stake.amount, stake.startBlock, epoch.endBlock),
                false
            );
        }

        emit StakeClosed(stakeId);

        dlpRootCore.removeDlpStake(stake.dlpId, stake.amount);

        if (stakeWithdrawalDelay() == 0) {
            _executeStakeWithdrawal(stakeId);
        }
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

        _executeStakeWithdrawal(stakeId);
    }

    function _executeStakeWithdrawal(uint256 stakeId) internal {
        Stake storage stake = _stakes[stakeId];

        stake.withdrawn = true;

        bool success = dlpRootStakesTreasury.transferVana(
            payable(stake.stakerAddress),
            stake.amount - stake.movedAmount
        );
        if (!success) {
            revert TransferFailed();
        }

        emit StakeWithdrawn(stakeId);
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
     * @notice Helper function to add value to checkpoint
     */
    function _checkpointAdd(Checkpoints.Trace208 storage store, uint256 delta) private returns (uint208, uint208) {
        return store.push(uint48(block.number), store.latest() + uint208(delta));
    }

    /**
     * @notice Helper function to set checkpoint value
     */
    function _checkpointPush(Checkpoints.Trace208 storage store, uint256 delta) private returns (uint208, uint208) {
        return store.push(uint48(block.number), uint208(delta));
    }

    function stakeEpochReward(uint256 stakeId, uint256 epochId) external view returns (uint256) {
        Stake storage stake = _stakes[stakeId];

        IDLPRootEpoch.EpochInfo memory epoch = dlpRootEpoch.epochs(epochId);
        IDLPRootEpoch.EpochDlpInfo memory epochDlp = dlpRootEpoch.epochDlps(epochId, stake.dlpId);

        if (
            epochId == 0 ||
            epochDlp.totalStakesScore == 0 ||
            stake.startBlock > epoch.endBlock ||
            (stake.endBlock > 0 && epoch.endBlock > stake.endBlock)
        ) {
            return 0;
        }

        uint256 stakeScore = calculateStakeScore(stake.amount, stake.startBlock, epoch.endBlock);

        return (epochDlp.stakersRewardAmount * stakeScore) / epochDlp.totalStakesScore;
    }
}
