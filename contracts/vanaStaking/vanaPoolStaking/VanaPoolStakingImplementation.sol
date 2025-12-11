// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/VanaPoolStakingStorageV2.sol";

contract VanaPoolStakingImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC2771ContextUpgradeable,
    VanaPoolStakingStorageV2
{
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant VANA_POOL_ENTITY_ROLE = keccak256("VANA_POOL_ENTITY_ROLE");

    /**
     * @notice Triggered when a user stakes VANA to an entity
     *
     * @param entityId                         ID of the entity
     * @param staker                           address of the staker
     * @param amount                           amount staked
     * @param sharesIssued                     shares issued
     */
    event Staked(uint256 indexed entityId, address indexed staker, uint256 amount, uint256 sharesIssued);

    /**
     * @notice Triggered when a user unstakes VANA from an entity
     *
     * @param entityId                         ID of the entity
     * @param staker                           address of the staker
     * @param amount                           amount unstaked
     * @param sharesBurned                     shares burned
     */
    event Unstaked(uint256 indexed entityId, address indexed staker, uint256 amount, uint256 sharesBurned);

    /**
     * @notice Triggered when minimum stake amount is updated
     *
     * @param newMinStake                      new minimum stake amount
     */
    event MinStakeUpdated(uint256 newMinStake);

    /**
     * @notice Triggered when an entity stake is registered
     *
     * @param entityId                         ID of the entity
     * @param ownerAddress                     address of the owner
     */
    event EntityStakeRegistered(uint256 indexed entityId, address indexed ownerAddress);

    error InsufficientStakeAmount();
    error InvalidRecipient();
    error InsufficientShares();
    error TransferFailed();
    error InvalidAmount();
    error EntityNotFound();
    error EntityNotActive();
    error InvalidAddress();
    error InvalidEntity();
    error NotEntityOwner();
    error CannotRemoveRegistrationStake();
    error NotAuthorized();
    error InvalidSlippage();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     *
     * @param trustedForwarderAddress           address of the trusted forwarder
     * @param ownerAddress                      address of the owner
     * @param initialMinStake                   initial minimum stake amount (in wei)
     */
    function initialize(
        address trustedForwarderAddress,
        address ownerAddress,
        uint256 initialMinStake
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        _trustedForwarder = trustedForwarderAddress;
        minStakeAmount = initialMinStake;

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    /**
     * @notice Upgrade the contract
     * This function is required by OpenZeppelin's UUPSUpgradeable
     *
     * @param newImplementation                  new implementation
     */
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

    function trustedForwarder() public view virtual override returns (address) {
        return _trustedForwarder;
    }

    /**
     * @notice Returns the version of the contract
     */
    function version() external pure virtual override returns (uint256) {
        return 2;
    }

    /**
     * @notice Returns staker info for a specific entity
     *
     * @param staker                           address of the staker
     * @param entityId                         ID of the entity
     * @return uint256                         shares owned by staker in the entity
     */
    function stakerEntities(address staker, uint256 entityId) external view override returns (StakerEntity memory) {
        return _stakers[staker].entities[entityId];
    }

    function activeStakersListCount() external view returns (uint256) {
        return _activeStakersList.length();
    }
    function activeStakersListValues(uint256 from, uint256 to) external view returns (address[] memory) {
        uint256 count = _activeStakersList.length();
        if (to > count) {
            to = count;
        }
        address[] memory stakers = new address[](to - from);
        for (uint256 i = from; i < to; i++) {
            stakers[i - from] = _activeStakersList.at(i);
        }
        return stakers;
    }

    function activeStakersListAt(uint256 index) external view returns (address) {
        return _activeStakersList.at(index);
    }

    function inactiveStakersListCount() external view returns (uint256) {
        return _inactiveStakersList.length();
    }
    function inactiveStakersListValues(uint256 from, uint256 to) external view returns (address[] memory) {
        uint256 count = _inactiveStakersList.length();
        if (to > count) {
            to = count;
        }
        address[] memory stakers = new address[](to - from);
        for (uint256 i = from; i < to; i++) {
            stakers[i - from] = _inactiveStakersList.at(i);
        }
        return stakers;
    }

    function inactiveStakersListAt(uint256 index) external view returns (address) {
        return _inactiveStakersList.at(index);
    }

    /**
     * @notice Get the maximum amount of VANA that can be unstaked in a single transaction
     * @dev Returns the minimum of:
     *      1. The withdrawable VANA (costBasis if in bonding period, shareValue if eligible)
     *      2. The entity's activeRewardPool (what the entity has available)
     *      3. The treasury balance (what can be paid out)
     *      Note: This simulates processRewards() to get accurate share prices
     *
     * @param staker                            address of the staker
     * @param entityId                          ID of the entity
     * @return maxVana                          maximum VANA that can be unstaked
     * @return maxShares                        corresponding shares to unstake for maxVana
     * @return limitingFactor                   0 = user shares/costBasis, 1 = activeRewardPool, 2 = treasury
     * @return isInBondingPeriod                true if staker is still in bonding period
     */
    function getMaxUnstakeAmount(
        address staker,
        uint256 entityId
    ) external view returns (uint256 maxVana, uint256 maxShares, uint256 limitingFactor, bool isInBondingPeriod) {
        StakerEntity storage stakerEntity = _stakers[staker].entities[entityId];

        if (stakerEntity.shares == 0) {
            return (0, 0, 0, false);
        }

        // Get entity info and simulate processRewards to get accurate values
        IVanaPoolEntity.EntityInfo memory entityInfo = vanaPoolEntity.entities(entityId);

        // Simulate processRewards: calculate pending rewards to distribute
        uint256 simulatedActiveRewardPool = entityInfo.activeRewardPool;
        uint256 timeElapsed = block.timestamp - entityInfo.lastUpdateTimestamp;
        if (timeElapsed > 0 && entityInfo.lockedRewardPool > 0) {
            uint256 toDistribute = vanaPoolEntity.calculateYield(simulatedActiveRewardPool, entityInfo.maxAPY, timeElapsed);
            if (toDistribute > entityInfo.lockedRewardPool) {
                toDistribute = entityInfo.lockedRewardPool;
            }
            simulatedActiveRewardPool += toDistribute;
        }

        // Calculate share prices using simulated activeRewardPool
        uint256 shareToVana = entityInfo.totalShares > 0
            ? (simulatedActiveRewardPool * 1e18) / entityInfo.totalShares
            : 1e18;
        uint256 vanaToShare = simulatedActiveRewardPool > 0
            ? (entityInfo.totalShares * 1e18) / simulatedActiveRewardPool
            : 1e18;

        // Check if staker is in bonding period
        isInBondingPeriod = block.timestamp < stakerEntity.rewardEligibilityTimestamp;

        // Constraint 1: User's withdrawable amount
        // If in bonding period: can only withdraw costBasis (principal)
        // If reward eligible: can withdraw full share value (principal + rewards)
        uint256 userShareValue = (stakerEntity.shares * shareToVana) / 1e18;
        uint256 userWithdrawable;

        if (isInBondingPeriod) {
            // In bonding period: can only withdraw cost basis (principal)
            userWithdrawable = stakerEntity.costBasis;
        } else {
            // Reward eligible: can withdraw full share value
            userWithdrawable = userShareValue;
        }

        // Constraint 2: Entity's activeRewardPool (use simulated value)
        uint256 entityPoolBalance = simulatedActiveRewardPool;

        // Constraint 3: Treasury balance
        uint256 treasuryBalance = address(vanaPoolTreasury).balance;

        // Find the minimum constraint
        maxVana = userWithdrawable;
        limitingFactor = 0; // user shares/costBasis

        if (entityPoolBalance < maxVana) {
            maxVana = entityPoolBalance;
            limitingFactor = 1; // activeRewardPool
        }

        if (treasuryBalance < maxVana) {
            maxVana = treasuryBalance;
            limitingFactor = 2; // treasury
        }

        // Convert maxVana back to shares
        if (maxVana > 0) {
            if (isInBondingPeriod) {
                // In bonding period: shares = maxVana * totalShares / costBasis
                // Because vanaToReturn = (costBasis * shareAmount) / totalShares
                // So shareAmount = vanaToReturn * totalShares / costBasis
                if (stakerEntity.costBasis > 0) {
                    maxShares = (maxVana * stakerEntity.shares) / stakerEntity.costBasis;
                }
            } else {
                // Reward eligible: shares = maxVana / shareToVana
                maxShares = (maxVana * vanaToShare) / 1e18;
            }

            // Ensure we don't exceed user's actual shares
            if (maxShares > stakerEntity.shares) {
                maxShares = stakerEntity.shares;
            }
        }

        return (maxVana, maxShares, limitingFactor, isInBondingPeriod);
    }

    /**
     * @notice Get the accruing interest for a staker in a specific entity
     * @dev Accruing interest = (current VANA value of shares - cost basis) + vested rewards
     *      This represents all rewards that have not yet been withdrawn (unstaked)
     *
     * @param staker                            address of the staker
     * @param entityId                          ID of the entity
     * @return uint256                          accruing interest in VANA (0 if negative or no shares)
     */
    function getAccruingInterest(address staker, uint256 entityId) external view override returns (uint256) {
        StakerEntity storage stakerEntity = _stakers[staker].entities[entityId];

        uint256 pendingInterest = 0;
        if (stakerEntity.shares > 0) {
            uint256 shareToVana = vanaPoolEntity.entityShareToVana(entityId);
            uint256 currentValue = (stakerEntity.shares * shareToVana) / 1e18;

            if (currentValue > stakerEntity.costBasis) {
                pendingInterest = currentValue - stakerEntity.costBasis;
            }
        }

        return pendingInterest + stakerEntity.vestedRewards;
    }

    /**
     * @notice Returns the total rewards earned by a staker for an entity
     * @dev Total earned = accruing interest (not yet withdrawn) + realized (withdrawn)
     *      - accruingInterest: pending interest + vested rewards (all rewards not yet withdrawn)
     *      - realizedRewards: rewards actually withdrawn during unstakes
     *
     * @param staker                            address of the staker
     * @param entityId                          ID of the entity
     * @return uint256                          total rewards earned in VANA
     */
    function getEarnedRewards(address staker, uint256 entityId) external view override returns (uint256) {
        StakerEntity storage stakerEntity = _stakers[staker].entities[entityId];

        // Calculate pending interest (current value - cost basis)
        uint256 pendingInterest = 0;
        if (stakerEntity.shares > 0) {
            uint256 shareToVana = vanaPoolEntity.entityShareToVana(entityId);
            uint256 currentValue = (stakerEntity.shares * shareToVana) / 1e18;
            if (currentValue > stakerEntity.costBasis) {
                pendingInterest = currentValue - stakerEntity.costBasis;
            }
        }

        // Total = pending interest + vested (not yet withdrawn) + realized (withdrawn)
        return pendingInterest + stakerEntity.vestedRewards + stakerEntity.realizedRewards;
    }

    /**
     * @dev Pauses the contract
     */
    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpauses the contract
     */
    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    /**
     * @notice Updates the minimum stake amount
     *
     * @param newMinStake                       new minimum stake amount in wei
     */
    function updateMinStakeAmount(uint256 newMinStake) external override onlyRole(MAINTAINER_ROLE) {
        minStakeAmount = newMinStake;
        emit MinStakeUpdated(newMinStake);
    }

    /**
     * @notice Update the bonding period
     *
     * @param newBondingPeriod                  new bonding period in seconds
     */
    function updateBondingPeriod(uint256 newBondingPeriod) external onlyRole(MAINTAINER_ROLE) {
        bondingPeriod = newBondingPeriod;
    }

    /**
     * @notice Update the trusted forwarder
     *
     * @param trustedForwarderAddress           address of the trusted forwarder
     */
    function updateTrustedForwarder(address trustedForwarderAddress) external onlyRole(MAINTAINER_ROLE) {
        _trustedForwarder = trustedForwarderAddress;
    }

    /**
     * @notice Update the VanaPoolEntity contract address
     *
     * @param newVanaPoolEntityAddress                new VanaPoolEntity contract address
     */
    function updateVanaPoolEntity(address newVanaPoolEntityAddress) external override onlyRole(MAINTAINER_ROLE) {
        if (newVanaPoolEntityAddress == address(0) || newVanaPoolEntityAddress == address(vanaPoolEntity)) {
            revert InvalidAddress();
        }

        if (address(vanaPoolEntity) != address(0)) {
            _revokeRole(VANA_POOL_ENTITY_ROLE, address(vanaPoolEntity));
        }
        _grantRole(VANA_POOL_ENTITY_ROLE, newVanaPoolEntityAddress);

        vanaPoolEntity = IVanaPoolEntity(newVanaPoolEntityAddress);
    }

    /**
     * @notice Update the VanaPoolTreasury contract
     *
     * @param newVanaPoolTreasuryAddress                new VanaPoolTreasury contract address
     */
    function updateVanaPoolTreasury(address newVanaPoolTreasuryAddress) external override onlyRole(MAINTAINER_ROLE) {
        if (newVanaPoolTreasuryAddress == address(0) || newVanaPoolTreasuryAddress == address(vanaPoolTreasury)) {
            revert InvalidAddress();
        }

        vanaPoolTreasury = IVanaPoolTreasury(newVanaPoolTreasuryAddress);
    }

    /**
     * @notice Stake VANA into a specific entity and allocate it to a recipient
     *
     * @param entityId   ID of the entity to stake into
     * @param recipient  Address of the recipient who will receive the stake
     * @param shareAmountMin  Minimum amount of share to receive
     */
    function stake(
        uint256 entityId,
        address recipient,
        uint256 shareAmountMin
    ) external payable override nonReentrant whenNotPaused {
        if (!_isValidEntity(entityId)) {
            revert EntityNotActive();
        }

        uint256 stakeAmount = msg.value;

        //todo: block users from staking below min stake after the DLPStakes are migrated
        //        if (stakeAmount < minStakeAmount) {
        //            revert InsufficientStakeAmount();
        //        }

        if (recipient == address(0)) {
            revert InvalidRecipient();
        }

        // Process entity rewards through VanaPoolEntity to ensure current share price is used
        vanaPoolEntity.processRewards(entityId);

        // Calculate shares
        uint256 vanaToShare = vanaPoolEntity.vanaToEntityShare(entityId);
        uint256 sharesIssued = (vanaToShare * stakeAmount) / 1e18;

        if (sharesIssued < shareAmountMin) {
            revert InvalidSlippage();
        }

        // Update recipient's position
        StakerEntity storage stakerEntity = _stakers[recipient].entities[entityId];
        uint256 currentTimestamp = block.timestamp;
        uint256 shareToVana = vanaPoolEntity.entityShareToVana(entityId);

        // Calculate new total shares and their VANA value after this stake
        uint256 newTotalShares = stakerEntity.shares + sharesIssued;
        uint256 newTotalValue = (newTotalShares * shareToVana) / 1e18;

        if (stakerEntity.rewardEligibilityTimestamp <= currentTimestamp) {
            // Reward eligible (or first stake): capture unrealized rewards into vestedRewards before resetting costBasis
            // This ensures earned rewards are tracked when staking additional amounts (rewards rolled into costBasis)
            if (stakerEntity.shares > 0) {
                uint256 oldValue = (stakerEntity.shares * shareToVana) / 1e18;
                if (oldValue > stakerEntity.costBasis) {
                    stakerEntity.vestedRewards += oldValue - stakerEntity.costBasis;
                }
            }
            // All current value becomes new cost basis (includes old principal + old rewards + new stake)
            // Weighted time: only new stake contributes (old stake has 0 remaining time)
            stakerEntity.costBasis = newTotalValue;
            stakerEntity.rewardEligibilityTimestamp = currentTimestamp + (stakeAmount * bondingPeriod) / newTotalValue;
        } else {
            // Still in bonding period: add new stake to cost basis, calculate weighted average time
            stakerEntity.costBasis += stakeAmount;

            uint256 oldValue = (stakerEntity.shares * shareToVana) / 1e18;
            uint256 remainingTime = stakerEntity.rewardEligibilityTimestamp - currentTimestamp;
            uint256 weightedTime = (oldValue * remainingTime + stakeAmount * bondingPeriod) / newTotalValue;
            stakerEntity.rewardEligibilityTimestamp = currentTimestamp + weightedTime;
        }

        stakerEntity.shares = newTotalShares;

        _addStaker(recipient);

        // Update entity staking data in VanaPoolEntity contract
        vanaPoolEntity.updateEntityPool(entityId, sharesIssued, stakeAmount, true);

        (bool success, ) = payable(address(vanaPoolTreasury)).call{value: stakeAmount}("");

        if (!success) {
            revert TransferFailed();
        }

        emit Staked(entityId, recipient, stakeAmount, sharesIssued);
    }

    /**
     * @notice Unstake VANA from a specific entity
     *
     * @param entityId                          ID of the entity to unstake from
     * @param shareAmount                       shareAmount to unstake
     * @param vanaAmountMin                     minimum amount of VANA to receive
     */
    function unstake(
        uint256 entityId,
        uint256 shareAmount,
        uint256 vanaAmountMin
    ) external override nonReentrant whenNotPaused {
        StakerEntity storage stakerEntity = _stakers[_msgSender()].entities[entityId];
        if (stakerEntity.shares == 0 || shareAmount == 0) {
            revert InvalidAmount();
        }

        // Process entity rewards through VanaPoolEntity to ensure current share price is used
        vanaPoolEntity.processRewards(entityId);

        //todo: block owner from unstaking below registration stake
        //        uint256 vanaToShare = vanaPoolEntity.vanaToEntityShare(entityId);
        //
        //        // Get entity info from VanaPoolEntity
        //        IVanaPoolEntity.EntityInfo memory entityInfo = vanaPoolEntity.entities(entityId);
        //        // If this is the entity owner, ensure they can't unstake below the registration stake
        //        if (entityInfo.ownerAddress == _msgSender()) {
        //            uint256 ownerMinShares = (vanaToShare * vanaPoolEntity.minRegistrationStake()) / 1e18;
        //
        //            if (stakerShares - shareAmount < ownerMinShares) {
        //                revert CannotRemoveRegistrationStake();
        //            }
        //        }

        uint256 shareToVana = vanaPoolEntity.entityShareToVana(entityId);
        uint256 shareValue = (shareAmount * shareToVana) / 1e18;
        uint256 currentTimestamp = block.timestamp;

        // Calculate the VANA amount to return based on reward eligibility
        uint256 vanaToReturn;
        uint256 proportionalCostBasis = (stakerEntity.costBasis * shareAmount) / stakerEntity.shares;
        uint256 forfeitedRewards = 0;

        // Move proportional vested rewards to realized rewards (they're being withdrawn as part of costBasis)
        // Note: vestedRewards are already included in costBasis, this is just for accounting tracking
        uint256 proportionalVestedRewards = (stakerEntity.vestedRewards * shareAmount) / stakerEntity.shares;
        if (proportionalVestedRewards > 0) {
            stakerEntity.vestedRewards -= proportionalVestedRewards;
            stakerEntity.realizedRewards += proportionalVestedRewards;
        }

        if (currentTimestamp >= stakerEntity.rewardEligibilityTimestamp) {
            // Reward eligible: user receives full value (principal + rewards)
            vanaToReturn = shareValue;
            // Track NEW unrealized rewards being withdrawn (separate from vested rewards already tracked above)
            if (shareValue > proportionalCostBasis) {
                stakerEntity.realizedRewards += shareValue - proportionalCostBasis;
            }
        } else {
            // Still in bonding period: user receives only principal (forfeits rewards)
            vanaToReturn = proportionalCostBasis;
            // Calculate forfeited rewards (difference between share value and cost basis)
            if (shareValue > proportionalCostBasis) {
                forfeitedRewards = shareValue - proportionalCostBasis;
            }
        }

        // Reduce cost basis proportionally
        stakerEntity.costBasis -= proportionalCostBasis;

        // Anti-gaming logic for partial unstaking during bonding period
        // Extends remaining bonding time using inverse weighted average formula:
        // new_remaining_time = current_remaining_time * (amount_before / amount_after)
        // This prevents "wash attacks" where users use old bonded capital to accelerate new capital vesting
        if (currentTimestamp < stakerEntity.rewardEligibilityTimestamp && stakerEntity.shares > shareAmount) {
            uint256 remainingTime = stakerEntity.rewardEligibilityTimestamp - currentTimestamp;
            uint256 amountBefore = stakerEntity.shares;
            uint256 amountAfter = stakerEntity.shares - shareAmount;

            // Calculate extended time: remainingTime * (amountBefore / amountAfter)
            uint256 extendedTime = (remainingTime * amountBefore) / amountAfter;

            // Cap at full bonding period
            if (extendedTime > bondingPeriod) {
                extendedTime = bondingPeriod;
            }

            stakerEntity.rewardEligibilityTimestamp = currentTimestamp + extendedTime;
        }

        if (vanaToReturn < vanaAmountMin) {
            revert InvalidSlippage();
        }

        // Update staker's position
        stakerEntity.shares -= shareAmount;

        _removeStaker(_msgSender());

        // Update entity staking data in VanaPoolEntity contract
        vanaPoolEntity.updateEntityPool(entityId, shareAmount, shareValue, false);

        // Return forfeited rewards to the locked reward pool for gradual redistribution
        if (forfeitedRewards > 0) {
            vanaPoolEntity.returnForfeitedRewards(entityId, forfeitedRewards);
        }

        bool success = vanaPoolTreasury.transferVana(payable(_msgSender()), vanaToReturn);
        if (!success) {
            revert TransferFailed();
        }

        emit Unstaked(entityId, _msgSender(), vanaToReturn, shareAmount);
    }

    /**
     * @notice Register stake for a new entity (called by VanaPoolEntity contract)
     *
     * @param entityId                          ID of the entity
     * @param ownerAddress                      Address of the entity owner
     */
    function registerEntityStake(
        uint256 entityId,
        address ownerAddress,
        uint256 registrationStake
    ) external override nonReentrant whenNotPaused onlyRole(VANA_POOL_ENTITY_ROLE) {
        // Register shares for the owner
        _stakers[ownerAddress].entities[entityId].shares = registrationStake;

        _addStaker(ownerAddress);

        emit Staked(entityId, ownerAddress, registrationStake, registrationStake);
    }

    /**
     * @notice Checks if entity exists and is active
     *
     * @param entityId                         ID of the entity
     * @return bool                            true if entity exists and is active
     */
    function _isValidEntity(uint256 entityId) internal view returns (bool) {
        // Check if entity exists in VanaPoolEntity contract
        IVanaPoolEntity.EntityInfo memory entityInfo = vanaPoolEntity.entities(entityId);
        return entityInfo.status == IVanaPoolEntity.EntityStatus.Active;
    }

    function _addStaker(address staker) internal {
        _activeStakersList.add(staker);
        _inactiveStakersList.remove(staker);
    }

    function _removeStaker(address staker) internal {
        uint256 entitiesCount = vanaPoolEntity.entitiesCount();

        bool hasStake = false;

        for (uint256 i = 1; i <= entitiesCount; i++) {
            if (_stakers[staker].entities[i].shares > 0) {
                hasStake = true;
                break;
            }
        }

        if (!hasStake) {
            _activeStakersList.remove(staker);
            _inactiveStakersList.add(staker);
        }
    }
}
