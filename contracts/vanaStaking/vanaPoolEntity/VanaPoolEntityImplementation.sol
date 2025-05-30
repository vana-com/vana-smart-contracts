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

        // Calculate theoretical yield based on maxAPY
        uint256 toDistribute = calculateYield(entity.activeRewardPool, entity.maxAPY, timeElapsed);

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
