// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/VanaPoolEntityStorageV1.sol";

contract VanaPoolEntityImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    VanaPoolEntityStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;

    // Commission is expressed as percent * 1e18, matching maxAPY's scale, so
    // 100% == 100e18 and this is the divisor when skimming a distribution.
    uint256 public constant MAX_COMMISSION = 100e18;

    // Events for entity lifecycle and operations
    event EntityCreated(uint256 indexed entityId, address ownerAddress, string name, uint256 maxAPY);
    event EntityUpdated(uint256 indexed entityId, address ownerAddress, string name);
    event EntityStatusUpdated(uint256 indexed entityId, EntityStatus newStatus);
    event EntityMaxAPYUpdated(uint256 indexed entityId, uint256 newMaxAPY);
    event EntityRewardModelUpdated(uint256 indexed entityId, RewardModel model);
    event EntityCommissionUpdated(uint256 indexed entityId, uint256 newCommissionRate);
    event CommissionClaimed(uint256 indexed entityId, address indexed to, uint256 amount);
    event RewardsAdded(uint256 indexed entityId, uint256 amount);
    event RewardsDistributed(uint256 indexed entityId, uint256 amount, uint64 start, uint32 duration);
    event QueuedRewardsToppedUp(uint256 indexed entityId, uint256 addedAmount, uint256 newQueuedTotal);
    event RewardsProcessed(uint256 indexed entityId, uint256 distributedAmount);
    event ForfeitedRewardsReturned(uint256 indexed entityId, uint256 amount);

    // Custom errors
    error InvalidParam();
    error InvalidEntityId();
    error InvalidEntityStatus();
    error InvalidAddress();
    error InvalidName();
    error NotEntityOwner();
    error EntityNameAlreadyExists();
    error NameTooShort();
    error InvalidRegistrationStake();
    error StakersStillPresent();
    error InvalidRewardModel();
    error InsufficientRewardFunds();
    error NotAuthorized();
    error TransferFailed();

    modifier onlyEntityOwner(uint256 entityId) {
        if (_entities[entityId].ownerAddress != msg.sender) {
            revert NotEntityOwner();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract
     * @param ownerAddress The admin address
     * @param vanaPoolStakingAddress The address of the VanaPoolStaking contract
     */
    function initialize(
        address ownerAddress,
        address vanaPoolStakingAddress,
        uint256 initialMinRegistrationStake,
        uint256 initialMaxAPYDefault
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        vanaPoolStaking = IVanaPoolStaking(vanaPoolStakingAddress);
        minRegistrationStake = initialMinRegistrationStake;
        maxAPYDefault = initialMaxAPYDefault;

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
        _grantRole(VANA_POOL_ROLE, vanaPoolStakingAddress);
    }

    /**
     * @notice Upgrade the contract
     * This function is required by OpenZeppelin's UUPSUpgradeable
     *
     * @param newImplementation                  new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /**
     * @notice Set totalDistributedRewards for entities to seed historical values
     * @param entityIds The entity IDs to update
     * @param amounts The totalDistributedRewards values to add for each entity
     */
    function addTotalDistributedRewards(
        uint256[] calldata entityIds,
        uint256[] calldata amounts
    ) external onlyRole(MAINTAINER_ROLE) {
        if (entityIds.length != amounts.length) {
            revert InvalidParam();
        }

        for (uint256 i = 0; i < entityIds.length; i++) {
            _entities[entityIds[i]].totalDistributedRewards += amounts[i];
        }
    }

    /**
     * @notice Returns the version of the contract
     */
    function version() external pure virtual override returns (uint256) {
        return 2;
    }

    /**
     * @notice Gets entity information
     * @param entityId The ID of the entity
     * @return Entity information
     */
    function entities(uint256 entityId) public view override returns (EntityInfo memory) {
        Entity storage entity = _entities[entityId];

        return
            EntityInfo({
                entityId: entityId,
                ownerAddress: entity.ownerAddress,
                status: entity.status,
                name: entity.name,
                maxAPY: entity.maxAPY,
                lockedRewardPool: entity.lockedRewardPool,
                activeRewardPool: entity.activeRewardPool,
                totalShares: entity.totalShares,
                lastUpdateTimestamp: entity.lastUpdateTimestamp,
                totalDistributedRewards: entity.totalDistributedRewards
            });
    }

    /**
     * @notice The reward model (APY or STREAM) an entity currently vests by
     */
    function entityRewardModel(uint256 entityId) external view override returns (RewardModel) {
        return _entities[entityId].rewardModel;
    }

    /**
     * @notice An entity's reward schedule (active entry + queued follow-on).
     *         Meaningful only while the entity is in STREAM mode.
     */
    function entityRewardSchedule(
        uint256 entityId
    ) external view override returns (RewardSchedule memory) {
        return _entities[entityId].rewardSchedule;
    }

    /**
     * @notice Wei a STREAM entity still owes: active-unvested + queued. Its
     *         lockedRewardPool is kept at least this large. Returns 0 for an
     *         APY entity or one with no schedule.
     */
    function committedRewards(uint256 entityId) external view override returns (uint256) {
        return _committedRewards(_entities[entityId].rewardSchedule);
    }

    /**
     * @notice Convert share to VANA for a specific entity
     *
     * @param entityId                          ID of the entity
     * @return uint256                          corresponding VANA value
     */
    function entityShareToVana(uint256 entityId) external view override returns (uint256) {
        Entity storage entity = _entities[entityId];

        return entity.totalShares > 0 ? (entity.activeRewardPool * 1e18) / entity.totalShares : 1e18;
    }

    /**
     * @notice Convert VANA to shares for a specific entity
     *
     * @param entityId                          ID of the entity
     * @return uint256                          corresponding shares amount
     */
    function vanaToEntityShare(uint256 entityId) external view override returns (uint256) {
        Entity storage entity = _entities[entityId];

        return entity.activeRewardPool > 0 ? (entity.totalShares * 1e18) / entity.activeRewardPool : 1e18;
    }

    /**
     * @notice Gets entity information by name
     * @param entityName The name of the entity
     * @return Entity information
     */
    function entityByName(string memory entityName) external view override returns (EntityInfo memory) {
        uint256 entityId = entityNameToId[entityName];
        return entities(entityId);
    }

    /**
     * @notice Pauses the contract
     */
    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses the contract
     */
    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    /**
     * @notice Updates the VanaPoolStaking contract address
     * @param newVanaPoolStakingAddress The new VanaPoolStaking contract address
     */
    function updateVanaPool(address newVanaPoolStakingAddress) external override onlyRole(MAINTAINER_ROLE) {
        if (address(newVanaPoolStakingAddress) == address(0)) {
            revert InvalidAddress();
        }

        _revokeRole(VANA_POOL_ROLE, address(vanaPoolStaking));
        _grantRole(VANA_POOL_ROLE, address(newVanaPoolStakingAddress));

        vanaPoolStaking = IVanaPoolStaking(newVanaPoolStakingAddress);
    }

    /**
     * @notice Updates the minimum registration stake
     * @param newMinRegistrationStake The new minimum registration stake
     */
    function updateMinRegistrationStake(uint256 newMinRegistrationStake) external override onlyRole(MAINTAINER_ROLE) {
        minRegistrationStake = newMinRegistrationStake;
    }

    /**
     * @notice Creates a new entity
     * @param entityRegistrationInfo The entity registration information
     */
    function createEntity(
        EntityRegistrationInfo calldata entityRegistrationInfo
    ) external payable override whenNotPaused nonReentrant onlyRole(MAINTAINER_ROLE) {
        if (entityRegistrationInfo.ownerAddress == address(0)) {
            revert InvalidAddress();
        }

        if (
            entityNameToId[entityRegistrationInfo.name] != 0 || !_validateEntityNameLength(entityRegistrationInfo.name)
        ) {
            revert InvalidName();
        }

        if (msg.value != minRegistrationStake) {
            revert InvalidRegistrationStake();
        }

        uint256 registrationStake = msg.value;

        uint256 entityId = ++entitiesCount;
        Entity storage entity = _entities[entityId];

        entity.ownerAddress = entityRegistrationInfo.ownerAddress;
        entity.name = entityRegistrationInfo.name;
        entity.status = EntityStatus.Active;
        entity.maxAPY = maxAPYDefault;
        entity.lastUpdateTimestamp = block.timestamp;

        entityNameToId[entityRegistrationInfo.name] = entityId;
        _activeEntityIds.add(entityId);

        // Initialize share values directly in the entity
        entity.totalShares = registrationStake;
        entity.activeRewardPool = registrationStake;

        // Call VanaPoolStaking to register the entity stake
        vanaPoolStaking.registerEntityStake(entityId, entityRegistrationInfo.ownerAddress, registrationStake);

        (bool success, ) = payable(address(vanaPoolStaking.vanaPoolTreasury())).call{value: registrationStake}("");

        if (!success) {
            revert TransferFailed();
        }

        emit EntityCreated(entityId, entityRegistrationInfo.ownerAddress, entityRegistrationInfo.name, maxAPYDefault);
        emit EntityStatusUpdated(entityId, EntityStatus.Active);
    }

    /**
     * @notice Updates an entity
     * @param entityId The ID of the entity
     * @param entityRegistrationInfo The updated entity information
     */
    function updateEntity(
        uint256 entityId,
        EntityRegistrationInfo calldata entityRegistrationInfo
    ) external override whenNotPaused nonReentrant onlyEntityOwner(entityId) {
        if (entityRegistrationInfo.ownerAddress == address(0)) {
            revert InvalidAddress();
        }

        Entity storage entity = _entities[entityId];

        if (entity.status != EntityStatus.Active) {
            revert InvalidEntityStatus();
        }

        // Check if name is changing and validate
        if (keccak256(bytes(entityRegistrationInfo.name)) != keccak256(bytes(entity.name))) {
            if (
                entityNameToId[entityRegistrationInfo.name] != 0 ||
                !_validateEntityNameLength(entityRegistrationInfo.name)
            ) {
                revert InvalidName();
            }

            // Update name mappings
            entityNameToId[entity.name] = 0;
            entityNameToId[entityRegistrationInfo.name] = entityId;
            entity.name = entityRegistrationInfo.name;
        }

        // Update fields
        entity.ownerAddress = entityRegistrationInfo.ownerAddress;

        //todo: move owner's shares to new address if we allow public entity registration

        emit EntityUpdated(entityId, entityRegistrationInfo.ownerAddress, entityRegistrationInfo.name);
    }

    //    /**
    //     * @notice Removes an entity
    //     * @param entityId The ID of the entity to remove
    //     */
    //    function removeEntity(uint256 entityId) external override whenNotPaused nonReentrant onlyEntityOwner(entityId) {
    //        Entity storage entity = _entities[entityId];
    //
    //        if (entity.status != EntityStatus.Active) {
    //            revert InvalidEntityStatus();
    //        }
    //
    //        // Process any pending rewards
    //        processRewards(entityId);
    //
    //        // Update status
    //        entity.status = EntityStatus.Removed;
    //        _activeEntityIds.remove(entityId);
    //
    //        emit EntityStatusUpdated(entityId, EntityStatus.Removed);
    //    }

    /**
     * @notice Add rewards to an entity's locked reward pool
     * @param entityId The entity ID to add rewards to
     */
    function addRewards(uint256 entityId) external payable override whenNotPaused {
        Entity storage entity = _entities[entityId];

        if (entity.status != EntityStatus.Active) {
            revert InvalidEntityStatus();
        }

        if (msg.value == 0) {
            revert InvalidParam();
        }

        // Add to locked reward pool
        entity.lockedRewardPool += msg.value;

        (bool success, ) = payable(address(vanaPoolStaking.vanaPoolTreasury())).call{value: msg.value}("");

        if (!success) {
            revert TransferFailed();
        }

        emit RewardsAdded(entityId, msg.value);
    }

    /**
     * @notice Schedule a linear reward stream for a STREAM-model entity, funded
     *         by msg.value and/or the entity's existing locked residue. Uses the
     *         Synthetix V3 replace/queue rules: the new entry either replaces the
     *         active one (cancelling its unvested remainder to residue) or is
     *         queued as the single follow-on when it starts after the active one.
     *
     * @param entityId  the entity to schedule rewards for
     * @param amount    wei to distribute over [start, start + duration]
     * @param start     vesting start; must be >= block.timestamp
     * @param duration  vesting span in seconds; 0 == instant
     */
    function distributeRewards(
        uint256 entityId,
        uint256 amount,
        uint64 start,
        uint32 duration
    ) external payable override whenNotPaused {
        Entity storage entity = _entities[entityId];

        if (entity.status != EntityStatus.Active) {
            revert InvalidEntityStatus();
        }
        if (msg.sender != entity.ownerAddress && !hasRole(MAINTAINER_ROLE, msg.sender)) {
            revert NotEntityOwner();
        }
        if (entity.rewardModel != RewardModel.STREAM) {
            revert InvalidRewardModel();
        }
        if (amount == 0 || start < block.timestamp) {
            revert InvalidParam();
        }

        // Settle vesting under the current schedule before changing it, using
        // the pre-funding locked balance.
        processRewards(entityId);

        // Fund: account the new value and move it to the treasury (residue that
        // is already there backs any amount drawn beyond msg.value).
        if (msg.value > 0) {
            entity.lockedRewardPool += msg.value;

            (bool success, ) = payable(address(vanaPoolStaking.vanaPoolTreasury())).call{value: msg.value}("");
            if (!success) {
                revert TransferFailed();
            }
        }

        // Install the new distribution (replace or queue).
        _scheduleDistribution(entity.rewardSchedule, amount, start, duration);

        // Every scheduled reward must be backed by locked funds.
        if (entity.lockedRewardPool < _committedRewards(entity.rewardSchedule)) {
            revert InsufficientRewardFunds();
        }

        emit RewardsDistributed(entityId, amount, start, duration);
    }

    /**
     * @notice Add funds to a STREAM entity's already-queued reward entry,
     *         leaving its start and duration unchanged. Purely additive --
     *         unlike distributeRewards, which overwrites the queued entry -- so
     *         it can neither cancel nor defer anything already scheduled.
     *
     * @param entityId  the entity whose queued entry to top up
     */
    function topUpQueuedRewards(uint256 entityId) external payable override whenNotPaused {
        Entity storage entity = _entities[entityId];

        if (entity.status != EntityStatus.Active) {
            revert InvalidEntityStatus();
        }
        if (msg.sender != entity.ownerAddress && !hasRole(MAINTAINER_ROLE, msg.sender)) {
            revert NotEntityOwner();
        }
        if (entity.rewardModel != RewardModel.STREAM) {
            revert InvalidRewardModel();
        }
        if (msg.value == 0 || entity.rewardSchedule.nextScheduledValue == 0) {
            revert InvalidParam();
        }

        // Fund: account the value and move it to the treasury.
        entity.lockedRewardPool += msg.value;

        (bool success, ) = payable(address(vanaPoolStaking.vanaPoolTreasury())).call{value: msg.value}("");
        if (!success) {
            revert TransferFailed();
        }

        // Additive: grow the queued entry, start/duration unchanged. locked and
        // committed both rise by msg.value, so the escrow invariant is preserved.
        entity.rewardSchedule.nextScheduledValue += uint128(msg.value);

        emit QueuedRewardsToppedUp(entityId, msg.value, entity.rewardSchedule.nextScheduledValue);
    }

    /**
     * @notice Process rewards for an entity
     * @param entityId The entity ID to process rewards for
     */
    function processRewards(uint256 entityId) public override whenNotPaused {
        Entity storage entity = _entities[entityId];

        if (entity.status != EntityStatus.Active) {
            revert InvalidEntityStatus();
        }

        // Calculate time elapsed since last update
        uint256 timeElapsed = block.timestamp - entity.lastUpdateTimestamp;
        if (timeElapsed == 0) {
            return;
        }

        uint256 toDistribute;
        if (entity.rewardModel == RewardModel.APY) {
            // Calculate theoretical yield based on maxAPY
            toDistribute = calculateYield(entity.activeRewardPool, entity.maxAPY, timeElapsed);
        } else {
            // STREAM: linear vesting of the entity's scheduled rewards
            toDistribute = _vestStream(entity.rewardSchedule, entity.totalShares);
        }

        if (toDistribute > entity.lockedRewardPool) {
            toDistribute = entity.lockedRewardPool;
        }

        // Skim the entity's commission before the remainder raises the share
        // price. Model-agnostic: applies to both APY drip and STREAM vesting.
        uint256 commission = (toDistribute * entity.commissionRate) / MAX_COMMISSION;
        uint256 delegatorReward = toDistribute - commission;

        entity.lockedRewardPool -= toDistribute;
        entity.activeRewardPool += delegatorReward; // to delegators via share price
        entity.accruedCommission += commission; // operator's cut, claimable
        entity.totalDistributedRewards += delegatorReward;

        // Update last process timestamp
        entity.lastUpdateTimestamp = block.timestamp;

        emit RewardsProcessed(entityId, toDistribute);
    }

    /**
     * @notice Update an entity's max APY
     * @param entityId The entity ID
     * @param newMaxAPY The new max APY in basis points (1% = 100)
     */
    function updateEntityMaxAPY(uint256 entityId, uint256 newMaxAPY) external override onlyRole(MAINTAINER_ROLE) {
        Entity storage entity = _entities[entityId];

        if (entity.status != EntityStatus.Active) {
            revert InvalidEntityStatus();
        }

        // Process existing rewards before changing APY
        processRewards(entityId);

        entity.maxAPY = newMaxAPY;

        emit EntityMaxAPYUpdated(entityId, newMaxAPY);
    }

    /**
     * @notice Switch an entity between reward models (APY <-> STREAM)
     * @param entityId The entity ID
     * @param model The reward model to switch to
     */
    function updateEntityRewardModel(
        uint256 entityId,
        RewardModel model
    ) external override onlyRole(MAINTAINER_ROLE) {
        Entity storage entity = _entities[entityId];

        if (entity.status != EntityStatus.Active) {
            revert InvalidEntityStatus();
        }

        // Settle the outgoing model up to now before flipping, so rewards owed
        // under the old model (e.g. APY accrued since the last drip) are moved
        // locked -> active at the switch instant and not mis-credited after.
        processRewards(entityId);

        entity.rewardModel = model;

        emit EntityRewardModelUpdated(entityId, model);
    }

    /**
     * @notice Switch an APY entity to STREAM and roll its entire undistributed
     *         lockedRewardPool into one linear stream over [start, start +
     *         duration], atomically. Settles the capped phase first (so accrued
     *         APY is credited), flips to STREAM, then schedules the residue.
     *         Rolling the leftover in keeps it allocated to stakers and extends
     *         the runway, and avoids the parked state a plain switch leaves
     *         (locked funds vesting nothing until a separate distributeRewards).
     *
     * @param entityId  the entity to switch (must be in APY mode)
     * @param start     stream start; must be >= now
     * @param duration  linear vesting span in seconds
     */
    function switchToStreamModel(
        uint256 entityId,
        uint64 start,
        uint32 duration
    ) external override onlyRole(MAINTAINER_ROLE) {
        Entity storage entity = _entities[entityId];

        if (entity.status != EntityStatus.Active) {
            revert InvalidEntityStatus();
        }
        if (entity.rewardModel != RewardModel.APY) {
            revert InvalidRewardModel();
        }

        // Settle the capped (APY) phase, then flip to STREAM. Clear any stale
        // schedule so a new one would install fresh.
        processRewards(entityId);
        entity.rewardModel = RewardModel.STREAM;
        delete entity.rewardSchedule;
        emit EntityRewardModelUpdated(entityId, RewardModel.STREAM);

        // Roll the whole remaining reservoir into one fresh linear stream. In
        // APY mode all of lockedRewardPool is the reservoir; the escrow then
        // holds with equality (committed == residue == locked). If there is no
        // residue, the entity simply parks in STREAM with no schedule and can
        // be funded later via distributeRewards.
        uint256 residue = entity.lockedRewardPool;
        if (residue > 0) {
            if (start < block.timestamp) {
                revert InvalidParam();
            }
            _scheduleDistribution(entity.rewardSchedule, residue, start, duration);
            emit RewardsDistributed(entityId, residue, start, duration);
        }
    }

    /**
     * @notice Set an entity's commission -- the operator's cut of each reward
     *         distribution, taken before the remainder raises the share price
     *         for delegators. Percent * 1e18 (100% == MAX_COMMISSION). Settles
     *         pending rewards at the old rate first, so the change is forward-only.
     *
     * @param entityId The entity ID
     * @param newCommissionRate New commission rate, 0..MAX_COMMISSION
     */
    function updateEntityCommission(uint256 entityId, uint256 newCommissionRate) external override {
        Entity storage entity = _entities[entityId];

        if (entity.status != EntityStatus.Active) {
            revert InvalidEntityStatus();
        }
        if (msg.sender != entity.ownerAddress && !hasRole(MAINTAINER_ROLE, msg.sender)) {
            revert NotEntityOwner();
        }
        if (newCommissionRate > MAX_COMMISSION) {
            revert InvalidParam();
        }

        // Settle at the old rate so the new rate only applies to future rewards.
        processRewards(entityId);

        entity.commissionRate = newCommissionRate;

        emit EntityCommissionUpdated(entityId, newCommissionRate);
    }

    /**
     * @notice Claim an entity's accrued commission to its owner. Settles first
     *         so freshly-vested commission is included.
     *
     * @param entityId The entity ID
     */
    function claimCommission(uint256 entityId) external override whenNotPaused nonReentrant {
        Entity storage entity = _entities[entityId];

        if (msg.sender != entity.ownerAddress && !hasRole(MAINTAINER_ROLE, msg.sender)) {
            revert NotEntityOwner();
        }

        processRewards(entityId);

        uint256 amount = entity.accruedCommission;
        if (amount == 0) {
            revert InvalidParam();
        }

        entity.accruedCommission = 0;

        bool success = vanaPoolStaking.vanaPoolTreasury().transferVana(payable(entity.ownerAddress), amount);
        if (!success) {
            revert TransferFailed();
        }

        emit CommissionClaimed(entityId, entity.ownerAddress, amount);
    }

    /**
     * @notice An entity's commission rate (percent * 1e18).
     */
    function entityCommissionRate(uint256 entityId) external view override returns (uint256) {
        return _entities[entityId].commissionRate;
    }

    /**
     * @notice Wei of commission accrued to an entity owner, not yet claimed.
     */
    function entityAccruedCommission(uint256 entityId) external view override returns (uint256) {
        return _entities[entityId].accruedCommission;
    }

    /**
     * @notice Get all active entities
     * @return uint256[] Array of active entity IDs
     */
    function activeEntitiesValues() external view override returns (uint256[] memory) {
        return _activeEntityIds.values();
    }

    /**
     * @notice Validates entity name length
     * @param name The name to validate
     * @return Whether the name is valid
     */
    function _validateEntityNameLength(string memory name) internal pure returns (bool) {
        bytes memory nameBytes = bytes(name);
        uint256 count = 0;

        for (uint256 i = 0; i < nameBytes.length; i++) {
            if (nameBytes[i] != 0x20) {
                // 0x20 is the ASCII space character
                count++;
            }
        }

        return count > 3;
    }

    /**
     * @notice Update entity stake information - can only be called by VanaPoolStaking
     * @param entityId The entity ID
     * @param shares The amount of shares to add or remove
     * @param amount The amount of VANA to add or remove
     * @param isStake True if staking, false if unstaking
     */
    function updateEntityPool(
        uint256 entityId,
        uint256 shares,
        uint256 amount,
        bool isStake
    ) external override whenNotPaused onlyRole(VANA_POOL_ROLE) {
        if (!hasRole(VANA_POOL_ROLE, msg.sender)) {
            revert NotAuthorized();
        }

        Entity storage entity = _entities[entityId];

        if (entity.status != EntityStatus.Active) {
            revert InvalidEntityStatus();
        }

        // Update entity totals based on whether it's a stake or unstake
        if (isStake) {
            entity.totalShares += shares;
            entity.activeRewardPool += amount;
        } else {
            entity.totalShares -= shares;
            entity.activeRewardPool -= amount;
        }
    }

    /**
     * @notice Returns forfeited rewards back to the locked reward pool
     * @dev Called when a user unstakes before their reward eligibility date.
     *      Note: updateEntityPool already deducted the full shareValue from activeRewardPool,
     *      so we only need to add the forfeited amount to lockedRewardPool.
     *
     * @param entityId                          ID of the entity
     * @param amount                            Amount of forfeited rewards to return
     */
    function returnForfeitedRewards(
        uint256 entityId,
        uint256 amount
    ) external override whenNotPaused onlyRole(VANA_POOL_ROLE) {
        if (amount == 0) {
            return;
        }

        Entity storage entity = _entities[entityId];

        if (entity.status != EntityStatus.Active) {
            revert InvalidEntityStatus();
        }

        // Add forfeited rewards to locked pool for gradual redistribution
        // (activeRewardPool was already reduced by updateEntityPool)
        entity.lockedRewardPool += amount;
        entity.totalDistributedRewards -= amount;

        emit ForfeitedRewardsReturned(entityId, amount);
    }

    /**
     * @dev Calculates continuously compounded APY
     * @param apy The annual interest rate where 6% = 6e18
     * @param principal The initial amount
     * @param time Time in seconds for which the interest is calculated
     * @return The final amount after applying continuous compounding
     */
    function calculateYield(uint256 principal, uint256 apy, uint256 time) public pure override returns (uint256) {
        // Convert percentage to decimal (e.g., 6e18 (6%) -> 0.06 * 1e18)
        uint256 rateAsDecimal = apy / 100;

        // Calculate e^(rate * time)
        uint256 exponent = (rateAsDecimal * time) / 365 days;
        uint256 eToExponent = calculateExponential(exponent);

        // Calculate principal * (e^(rate * time) - 1) to get only the interest
        return (principal * (eToExponent - 1e18)) / 1e18;
    }

    /**
     * @dev Calculates continuously compounded APY for an entity
     * @param entityId The entity ID
     * @return The compounded APY
     */
    function calculateContinuousAPYByEntity(uint256 entityId) external view override returns (uint256) {
        // Convert percentage to decimal (e.g., 6e18 (6%) -> 0.06 * 1e18)
        uint256 rateAsDecimal = _entities[entityId].maxAPY / 100;

        // Calculate e^rate - 1
        uint256 eToRate = calculateExponential(rateAsDecimal);

        // Calculate (e^rate - 1) * 100 to get APY percentage
        return (eToRate - 1e18) * 100;
    }

    /**
     * @notice The entity's current annualized APY, in the same units as
     *         calculateContinuousAPYByEntity (percentage points scaled by 1e18,
     *         e.g. 6.18% -> 6.18e18). Model-aware:
     *          - APY:    the sustained effective cap (e^maxAPY - 1), but 0 once
     *                    lockedRewardPool is empty (the cap can no longer drip).
     *          - STREAM: the active entry's linear vesting rate annualized over
     *                    activeRewardPool, or 0 when nothing is currently vesting.
     *         This is the forward-looking rate; realized APY is measured from
     *         entityShareToVana over time.
     */
    function currentAPYByEntity(uint256 entityId) external view override returns (uint256) {
        Entity storage entity = _entities[entityId];

        if (entity.rewardModel == RewardModel.APY) {
            if (entity.lockedRewardPool == 0) {
                return 0;
            }
            uint256 rateAsDecimal = entity.maxAPY / 100;
            return (calculateExponential(rateAsDecimal) - 1e18) * 100;
        }

        // STREAM: annualize the active entry's linear rate (scheduledValue /
        // duration wei/sec) over the active pool. Zero unless an entry is
        // currently vesting into a non-empty pool.
        RewardSchedule storage schedule = entity.rewardSchedule;
        uint256 end = uint256(schedule.start) + schedule.duration;
        if (
            entity.activeRewardPool == 0 ||
            schedule.scheduledValue == 0 ||
            schedule.duration == 0 ||
            block.timestamp < schedule.start ||
            block.timestamp >= end
        ) {
            return 0;
        }
        return
            (uint256(schedule.scheduledValue) * 365 days * 100 * 1e18) /
            (uint256(schedule.duration) * entity.activeRewardPool);
    }

    /**
     * @dev Computes how much a STREAM-model entity's active schedule has vested
     *      since its last update, advances the watermark, and promotes the
     *      queued entry once the active one has ended. Returns wei to move from
     *      lockedRewardPool to activeRewardPool. Vesting is linear over
     *      [start, start + duration].
     *
     *      While totalShares is zero the watermark is not advanced, so the
     *      elapsed interval is preserved and vests once shares exist again,
     *      rather than adding rewards to a pool with no shares to receive them.
     *
     * @param schedule     the entity's reward schedule (mutated in place)
     * @param totalShares  the entity's current total shares
     * @return toVest      wei to transfer from locked to active
     */
    function _vestStream(
        RewardSchedule storage schedule,
        uint256 totalShares
    ) internal returns (uint256 toVest) {
        // Nothing scheduled, or no shares to receive it: preserve the interval
        // by returning without advancing the watermark.
        if (schedule.scheduledValue == 0 || totalShares == 0) {
            return 0;
        }

        // Active entry has not started vesting yet.
        if (block.timestamp < schedule.start) {
            return 0;
        }

        uint256 value = schedule.scheduledValue;
        uint256 start = schedule.start;
        uint256 duration = schedule.duration;
        uint256 last = schedule.lastUpdate;

        // vested(t): the total that has vested by time t, a line clamped to
        // [0, value]. The amount owed now is vested(now) - vested(lastUpdate).
        uint256 vestedNow;
        uint256 vestedAtLast;
        if (duration == 0) {
            // Instant entry: the whole value vests at/after start.
            vestedNow = value;
            vestedAtLast = last >= start ? value : 0;
        } else {
            uint256 end = start + duration;
            vestedNow = block.timestamp >= end ? value : (value * (block.timestamp - start)) / duration;
            vestedAtLast = last >= start ? (value * (last - start)) / duration : 0;
        }

        toVest = vestedNow - vestedAtLast;

        // Once the active entry has fully vested, promote the queued entry and
        // vest its head in the same call (mirrors Synthetix updateEntry). Done
        // before writing lastUpdate so the recursion sees a watermark that
        // predates the promoted entry's start, making its vested-so-far zero.
        if (block.timestamp >= start + duration) {
            schedule.scheduledValue = schedule.nextScheduledValue;
            schedule.start = schedule.nextStart;
            schedule.duration = schedule.nextDuration;
            schedule.nextScheduledValue = 0;
            schedule.nextStart = 0;
            schedule.nextDuration = 0;
            toVest += _vestStream(schedule, totalShares);
        }

        // Always advance the watermark. When the recursion above ran with a
        // further queued entry it already wrote this same value (a redundant
        // but harmless SSTORE); when it promoted an empty slot it short-circuited
        // on the scheduledValue == 0 guard without writing, so this is required.
        schedule.lastUpdate = uint32(block.timestamp);
    }

    /**
     * @dev Installs a new reward distribution into a schedule, following the
     *      Synthetix V3 RewardDistribution.distribute rules. Assumes vesting has
     *      already been settled up to now (caller runs processRewards first).
     *      Funds are not moved here; they live in lockedRewardPool and the
     *      caller enforces that locked covers everything still committed.
     *
     *      The new entry either replaces the active one (when it overlaps, or the
     *      active one is absent/ended) or is queued as the single follow-on entry
     *      (when it starts at/after the active one ends). A replaced remainder or
     *      a displaced queued entry is left funded in lockedRewardPool as residue.
     *
     * @param schedule  the entity's reward schedule (mutated in place)
     * @param amount    wei to distribute over [start, start + duration]
     * @param start     vesting start (must be > 0)
     * @param duration  vesting span in seconds; 0 == instant
     */
    function _scheduleDistribution(
        RewardSchedule storage schedule,
        uint256 amount,
        uint64 start,
        uint32 duration
    ) internal {
        uint256 activeEnd = uint256(schedule.start) + schedule.duration;

        if (
            start == 0 ||
            schedule.scheduledValue == 0 ||
            block.timestamp > activeEnd ||
            start < activeEnd
        ) {
            // Replace the active entry. Any queued entry is displaced and the
            // old active entry's unvested remainder stays funded in locked as
            // residue. lastUpdate = 0 (< start, since start > 0) makes the new
            // entry's first vest count from its start, for linear and instant.
            schedule.nextScheduledValue = 0;
            schedule.nextStart = 0;
            schedule.nextDuration = 0;
            schedule.scheduledValue = uint128(amount);
            schedule.start = start;
            schedule.duration = duration;
            schedule.lastUpdate = 0;
        } else {
            // Queue as the single follow-on entry; the active entry keeps
            // running and this one is promoted by _vestStream when it ends.
            schedule.nextScheduledValue = uint128(amount);
            schedule.nextStart = start;
            schedule.nextDuration = duration;
        }
    }

    /**
     * @dev Total wei a STREAM schedule still owes: the active entry's not-yet
     *      vested portion plus the whole queued entry. lockedRewardPool must be
     *      at least this so every future vest is backed by real funds.
     */
    function _committedRewards(RewardSchedule storage schedule) internal view returns (uint256) {
        uint256 activeRemaining;
        if (schedule.scheduledValue > 0) {
            uint256 end = uint256(schedule.start) + schedule.duration;
            if (schedule.duration == 0) {
                // instant: outstanding until it has vested (lastUpdate >= start)
                activeRemaining = schedule.lastUpdate >= schedule.start ? 0 : schedule.scheduledValue;
            } else if (block.timestamp >= end) {
                activeRemaining = 0; // fully vested
            } else if (block.timestamp <= schedule.start) {
                activeRemaining = schedule.scheduledValue; // not started: all outstanding
            } else {
                uint256 vested = (uint256(schedule.scheduledValue) * (block.timestamp - schedule.start)) /
                    schedule.duration;
                activeRemaining = schedule.scheduledValue - vested;
            }
        }
        return activeRemaining + schedule.nextScheduledValue;
    }

    // This function is copied from solmate/utils/SignedWadMath.sol

    /**
     * @dev Approximates e^x using Padé approximation
     * This function is a copy of wadExp from  solmate/utils/SignedWadMath.sol
     * @param exponent The exponent multiplied by 1e18
     * @return r  = e^x multiplied by 1e18
     */
    function calculateExponential(uint256 exponent) public pure returns (uint256 r) {
        unchecked {
            int256 x = int256(exponent);

            // When the result is < 0.5 we return zero. This happens when
            // x <= floor(log(0.5e18) * 1e18) ~ -42e18
            if (x <= -42139678854452767551) return 0;

            // When the result is > (2**255 - 1) / 1e18 we can not represent it as an
            // int. This happens when x >= floor(log((2**255 - 1) / 1e18) * 1e18) ~ 135.
            if (x >= 135305999368893231589) revert("EXP_OVERFLOW");

            // x is now in the range (-42, 136) * 1e18. Convert to (-42, 136) * 2**96
            // for more intermediate precision and a binary basis. This base conversion
            // is a multiplication by 1e18 / 2**96 = 5**18 / 2**78.
            x = (x << 78) / 5 ** 18;

            // Reduce range of x to (-½ ln 2, ½ ln 2) * 2**96 by factoring out powers
            // of two such that exp(x) = exp(x') * 2**k, where k is an integer.
            // Solving this gives k = round(x / log(2)) and x' = x - k * log(2).
            int256 k = ((x << 96) / 54916777467707473351141471128 + 2 ** 95) >> 96;
            x = x - k * 54916777467707473351141471128;

            // k is in the range [-61, 195].

            // Evaluate using a (6, 7)-term rational approximation.
            // p is made monic, we'll multiply by a scale factor later.
            int256 y = x + 1346386616545796478920950773328;
            y = ((y * x) >> 96) + 57155421227552351082224309758442;
            int256 p = y + x - 94201549194550492254356042504812;
            p = ((p * y) >> 96) + 28719021644029726153956944680412240;
            p = p * x + (4385272521454847904659076985693276 << 96);

            // We leave p in 2**192 basis so we don't need to scale it back up for the division.
            int256 q = x - 2855989394907223263936484059900;
            q = ((q * x) >> 96) + 50020603652535783019961831881945;
            q = ((q * x) >> 96) - 533845033583426703283633433725380;
            q = ((q * x) >> 96) + 3604857256930695427073651918091429;
            q = ((q * x) >> 96) - 14423608567350463180887372962807573;
            q = ((q * x) >> 96) + 26449188498355588339934803723976023;

            /// @solidity memory-safe-assembly
            assembly {
                // Div in assembly because solidity adds a zero check despite the unchecked.
                // The q polynomial won't have zeros in the domain as all its roots are complex.
                // No scaling is necessary because p is already 2**96 too large.
                r := sdiv(p, q)
            }

            // r should be in the range (0.09, 0.25) * 2**96.

            // We now need to multiply r by:
            // * the scale factor s = ~6.031367120.
            // * the 2**k factor from the range reduction.
            // * the 1e18 / 2**96 factor for base conversion.
            // We do this all at once, with an intermediate result in 2**213
            // basis, so the final right shift is always by a positive amount.
            r = (uint256(r) * 3822833074963236453042738258902158003155416615667) >> uint256(195 - k);
        }
    }
}
