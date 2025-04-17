// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./interfaces/DataRefinerRegistryStorageV1.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract DataRefinerRegistryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    DataRefinerRegistryStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    event RefinerAdded(
        uint256 indexed refinerId,
        uint256 indexed dlpId,
        string name,
        string schemaDefinitionUrl,
        string refinementInstructionUrl
    );

    error NotDlpOwner();

    /// @notice Reverts if the caller is not the owner of the DLP
    /// @param dlpId The ID of the DLP
    modifier onlyDlpOwner(uint256 dlpId) {
        if (dlpRootCore.dlps(dlpId).ownerAddress != msg.sender) {
            revert NotDlpOwner();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract
     *
     * @param ownerAddress Address of the owner
     */
    function initialize(address ownerAddress, address initDlpRootCoreAddress) external initializer {
        __UUPSUpgradeable_init();
        __Pausable_init();
        __AccessControl_init();

        dlpRootCore = IDLPRootCoreReadOnly(initDlpRootCoreAddress);

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    /**
     * @notice Upgrades the contract
     * This function is required by OpenZeppelin's UUPSUpgradeable
     *
     * @param newImplementation New implementation
     */
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /// @inheritdoc IDataRefinerRegistry
    function updateDlpRootCore(address newDlpRootCoreAddress) external onlyRole(MAINTAINER_ROLE) {
        dlpRootCore = IDLPRootCoreReadOnly(newDlpRootCoreAddress);
    }

    /// @inheritdoc IDataRefinerRegistry
    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    /// @inheritdoc IDataRefinerRegistry
    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    /// @inheritdoc IDataRefinerRegistry
    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    /// @inheritdoc IDataRefinerRegistry
    function refiners(uint256 refinerId) external view override returns (Refiner memory) {
        return _refiners[refinerId];
    }

    /// @inheritdoc IDataRefinerRegistry
    function dlpRefiners(uint256 dlpId) external view override returns (uint256[] memory) {
        return _dlpRefiners[dlpId].values();
    }

    /// @inheritdoc IDataRefinerRegistry
    function addRefiner(
        uint256 dlpId,
        string calldata name,
        string calldata schemaDefinitionUrl,
        string calldata refinementInstructionUrl,
        string calldata publicKey
    ) external override onlyDlpOwner(dlpId) whenNotPaused returns (uint256) {
        uint256 newRefinerId = ++refinersCount;

        {
            Refiner storage newRefiner = _refiners[newRefinerId];
            newRefiner.dlpId = dlpId;
            newRefiner.owner = msg.sender;
            newRefiner.name = name;
            newRefiner.schemaDefinitionUrl = schemaDefinitionUrl;
            newRefiner.refinementInstructionUrl = refinementInstructionUrl;
            newRefiner.publicKey = publicKey;
        }

        _dlpRefiners[dlpId].add(newRefinerId);

        emit RefinerAdded(newRefinerId, dlpId, name, schemaDefinitionUrl, refinementInstructionUrl);

        return newRefinerId;
    }

    /// @inheritdoc IDataRefinerRegistry
    function updateRefinerOwner(uint256 refinerId) external override whenNotPaused {
        Refiner storage refiner = _refiners[refinerId];
        if (dlpRootCore.dlps(refiner.dlpId).ownerAddress != msg.sender) {
            revert NotDlpOwner();
        }

        /// @dev The refiner owner should be always the DLP owner.
        /// When the owner of a DLP is changed, the new DLP owner
        /// should call this function to be set as the new owner
        /// of the DLP refiner.
        _refiners[refinerId].owner = msg.sender;
    }

    /// @inheritdoc IDataRefinerRegistry
    function updateDlpRefinersOwner(uint256 dlpId) external override onlyDlpOwner(dlpId) whenNotPaused {
        EnumerableSet.UintSet storage refinerIds = _dlpRefiners[dlpId];
        uint256 length = refinerIds.length();
        for (uint256 i = 0; i < length;) {
            uint256 refinerId = refinerIds.at(i);
            _refiners[refinerId].owner = msg.sender;
            unchecked {
                ++i;
            }
        }
    }
}
