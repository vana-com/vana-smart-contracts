// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/VanaPoolStakingStorageV1.sol";

contract VanaPoolStakingImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    MulticallUpgradeable,
    ERC2771ContextUpgradeable,
    VanaPoolStakingStorageV1
{
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant VANA_POOL_ENTITY = keccak256("VANA_POOL_ENTITY");

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
        __Multicall_init();

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
        return 1;
    }

    /**
     * @notice Returns staker info for a specific entity
     *
     * @param staker                           address of the staker
     * @param entityId                         ID of the entity
     * @return uint256                         shares owned by staker in the entity
     */
    function stakerEntities(address staker, uint256 entityId) external view override returns (StakerEntity memory) {
        return StakerEntity({shares: _stakers[staker].entities[entityId].shares});
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
            _revokeRole(VANA_POOL_ENTITY, address(vanaPoolEntity));
        }
        _grantRole(VANA_POOL_ENTITY, newVanaPoolEntityAddress);

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

        // Update recipient's position instead of the sender's
        _stakers[recipient].entities[entityId].shares += sharesIssued;

        _stakersList.add(recipient);

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
        uint256 stakerShares = _stakers[_msgSender()].entities[entityId].shares;
        if (stakerShares == 0 || shareAmount == 0) {
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

        // Store the exact VANA amount corresponding to shares at this point
        uint256 exactVanaAmount = (shareAmount * shareToVana) / 1e18;

        if (exactVanaAmount < vanaAmountMin) {
            revert InvalidSlippage();
        }

        // Update staker's position
        _stakers[_msgSender()].entities[entityId].shares -= shareAmount;

        // Update entity staking data in VanaPoolEntity contract
        vanaPoolEntity.updateEntityPool(entityId, shareAmount, exactVanaAmount, false);

        bool success = vanaPoolTreasury.transferVana(payable(_msgSender()), exactVanaAmount);
        if (!success) {
            revert TransferFailed();
        }

        emit Unstaked(entityId, _msgSender(), exactVanaAmount, shareAmount);
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
    ) external override nonReentrant whenNotPaused onlyRole(VANA_POOL_ENTITY) {
        // Register shares for the owner
        _stakers[ownerAddress].entities[entityId].shares = registrationStake;

        _stakersList.add(ownerAddress);

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
}
