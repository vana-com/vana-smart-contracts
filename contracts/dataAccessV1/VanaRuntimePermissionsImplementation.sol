// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/IVanaRuntimePermissions.sol";
import "./interfaces/IDatasetRegistry.sol";

/**
 * @title VanaRuntimePermissionsImplementation
 * @notice Implementation of the VanaRuntimePermissions contract
 * @dev Manages permissions for Vana Runtime operations on datasets
 */
contract VanaRuntimePermissionsImplementation is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    IVanaRuntimePermissions
{
    /// @notice Role for permission management
    bytes32 public constant PERMISSION_MANAGER_ROLE =
        keccak256("PERMISSION_MANAGER_ROLE");

    /// @notice Counter for permission IDs
    uint256 private _permissionIdCounter;

    /// @notice Reference to the DatasetRegistry contract
    IDatasetRegistry public datasetRegistry;

    /// @notice Mapping from permission ID to Permission struct
    mapping(uint256 => Permission) private _permissions;

    /// @notice Mapping from dataset ID to array of permission IDs
    mapping(uint256 => uint256[]) private _datasetPermissions;

    /// @notice Mapping from grantee ID to array of permission IDs
    mapping(uint256 => uint256[]) private _granteePermissions;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param admin Address to be granted admin role
     * @param _datasetRegistry Address of the DatasetRegistry contract
     */
    function initialize(
        address admin,
        address _datasetRegistry
    ) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PERMISSION_MANAGER_ROLE, admin);

        require(_datasetRegistry != address(0), "Invalid registry address");
        datasetRegistry = IDatasetRegistry(_datasetRegistry);

        _permissionIdCounter = 1; // Start from 1
    }

    /**
     * @notice Create a new permission for dataset access
     * @param datasetId Dataset to grant permission for
     * @param granteeId ID of the data consumer receiving permission
     * @param grant IPFS hash containing permission details (pricing, parameters, etc.)
     * @param startBlock Block when permission becomes active
     * @param endBlock Block when permission expires
     * @return permissionId The unique identifier for the created permission
     */
    function createPermission(
        uint256 datasetId,
        uint256 granteeId,
        string memory grant,
        uint256 startBlock,
        uint256 endBlock
    ) external override nonReentrant returns (uint256) {
        // Verify caller is dataset owner or has permission manager role
        IDatasetRegistry.Dataset memory dataset = datasetRegistry.getDataset(
            datasetId
        );
        require(
            msg.sender == dataset.owner ||
                hasRole(PERMISSION_MANAGER_ROLE, msg.sender),
            "Not authorized"
        );

        require(bytes(grant).length > 0, "Invalid grant");
        require(startBlock < endBlock, "Invalid block range");

        uint256 permissionId = _permissionIdCounter++;

        _permissions[permissionId] = Permission({
            id: permissionId,
            datasetId: datasetId,
            nonce: 0,
            granteeId: granteeId,
            grant: grant,
            startBlock: startBlock,
            endBlock: endBlock
        });

        _datasetPermissions[datasetId].push(permissionId);
        _granteePermissions[granteeId].push(permissionId);

        emit PermissionCreated(permissionId, datasetId, granteeId, grant);

        return permissionId;
    }

    /**
     * @notice Revoke an existing permission
     * @param permissionId The permission to revoke
     */
    function revokePermission(
        uint256 permissionId
    ) external override nonReentrant {
        Permission storage permission = _permissions[permissionId];
        require(permission.id != 0, "Permission not found");

        // Verify caller is dataset owner or has permission manager role
        IDatasetRegistry.Dataset memory dataset = datasetRegistry.getDataset(
            permission.datasetId
        );
        require(
            msg.sender == dataset.owner ||
                hasRole(PERMISSION_MANAGER_ROLE, msg.sender),
            "Not authorized"
        );

        // Set end block to current block to effectively revoke
        permission.endBlock = block.number;

        emit PermissionRevoked(permissionId);
    }

    /**
     * @notice Update an existing permission's grant details
     * @param permissionId The permission to update
     * @param newGrant New IPFS hash containing updated permission details
     */
    function updatePermission(
        uint256 permissionId,
        string memory newGrant
    ) external override nonReentrant {
        Permission storage permission = _permissions[permissionId];
        require(permission.id != 0, "Permission not found");

        // Verify caller is dataset owner or has permission manager role
        IDatasetRegistry.Dataset memory dataset = datasetRegistry.getDataset(
            permission.datasetId
        );
        require(
            msg.sender == dataset.owner ||
                hasRole(PERMISSION_MANAGER_ROLE, msg.sender),
            "Not authorized"
        );

        require(bytes(newGrant).length > 0, "Invalid grant");

        permission.grant = newGrant;
        permission.nonce++;

        emit PermissionUpdated(permissionId, newGrant);
    }

    /**
     * @notice Get permission details
     * @param permissionId The permission identifier
     * @return permission The permission structure
     */
    function getPermission(
        uint256 permissionId
    ) external view override returns (Permission memory) {
        require(_permissions[permissionId].id != 0, "Permission not found");
        return _permissions[permissionId];
    }

    /**
     * @notice Check if a permission is currently active
     * @param permissionId The permission identifier
     * @return isActive True if the permission is active at current block
     */
    function isPermissionActive(
        uint256 permissionId
    ) external view override returns (bool) {
        Permission memory permission = _permissions[permissionId];
        if (permission.id == 0) return false;

        return
            block.number >= permission.startBlock &&
            block.number <= permission.endBlock;
    }

    /**
     * @notice Get all permissions for a dataset
     * @param datasetId The dataset identifier
     * @return permissions Array of permission structures
     */
    function getDatasetPermissions(
        uint256 datasetId
    ) external view override returns (Permission[] memory) {
        uint256[] memory permissionIds = _datasetPermissions[datasetId];
        Permission[] memory permissions = new Permission[](
            permissionIds.length
        );

        for (uint256 i = 0; i < permissionIds.length; i++) {
            permissions[i] = _permissions[permissionIds[i]];
        }

        return permissions;
    }

    /**
     * @notice Get all permissions for a grantee
     * @param granteeId The grantee identifier
     * @return permissions Array of permission structures
     */
    function getGranteePermissions(
        uint256 granteeId
    ) external view override returns (Permission[] memory) {
        uint256[] memory permissionIds = _granteePermissions[granteeId];
        Permission[] memory permissions = new Permission[](
            permissionIds.length
        );

        for (uint256 i = 0; i < permissionIds.length; i++) {
            permissions[i] = _permissions[permissionIds[i]];
        }

        return permissions;
    }

    /**
     * @dev Required override for UUPS upgrades
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     */
    uint256[50] private __gap;
}
