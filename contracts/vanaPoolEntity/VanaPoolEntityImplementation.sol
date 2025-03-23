// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/VanaPoolEntityStorageV1.sol";

import "hardhat/console.sol";

contract VanaPoolEntityImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    VanaPoolEntityStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;

    // Events for entity lifecycle and operations
    event EntityCreated(uint256 indexed entityId, address ownerAddress, string name, uint256 maxAPY);
    event EntityUpdated(uint256 indexed entityId, address ownerAddress, string name);
    event EntityStatusUpdated(uint256 indexed entityId, EntityStatus newStatus);
    event EntityMaxAPYUpdated(uint256 indexed entityId, uint256 newMaxAPY);
    event RewardsAdded(uint256 indexed entityId, uint256 amount);
    event RewardsProcessed(uint256 indexed entityId, uint256 distributedAmount);

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
     * @notice Returns the version of the contract
     */
    function version() external pure virtual override returns (uint256) {
        return 1;
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
                lastUpdateTimestamp: entity.lastUpdateTimestamp
            });
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
     * @notice Creates a new entity
     * @param entityRegistrationInfo The entity registration information
     */
    function createEntity(
        EntityRegistrationInfo calldata entityRegistrationInfo
    ) external payable override whenNotPaused nonReentrant {
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
        //todo: use compound APY instead of maxAPY
        entity.ratePerSecond = maxAPYDefault / SECONDS_PER_YEAR / 100;
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

        emit EntityUpdated(entityId, entityRegistrationInfo.ownerAddress, entityRegistrationInfo.name);
    }

    /**
     * @notice Removes an entity
     * @param entityId The ID of the entity to remove
     */
    function removeEntity(uint256 entityId) external override whenNotPaused nonReentrant onlyEntityOwner(entityId) {
        Entity storage entity = _entities[entityId];

        if (entity.status != EntityStatus.Active) {
            revert InvalidEntityStatus();
        }

        // Process any pending rewards
        processRewards(entityId);

        // Update status
        entity.status = EntityStatus.Removed;
        _activeEntityIds.remove(entityId);

        emit EntityStatusUpdated(entityId, EntityStatus.Removed);
    }

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

        // Calculate theoretical rewards based on maxAPY
        uint256 toDistribute = (entity.activeRewardPool * entity.ratePerSecond * timeElapsed) / 1e18;

        if (toDistribute > entity.lockedRewardPool) {
            toDistribute = entity.lockedRewardPool;
        }

        entity.lockedRewardPool -= toDistribute;
        entity.activeRewardPool += toDistribute;

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
        //todo: use compound APY instead of maxAPY
        entity.ratePerSecond = newMaxAPY / SECONDS_PER_YEAR / 100;

        emit EntityMaxAPYUpdated(entityId, newMaxAPY);
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
}
