// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/IDLPRegistryV1.sol";

/**
 * @title DLPRegistryV1Implementation
 * @notice Implementation of the DLPRegistry contract with Data Access V1 support
 * @dev Manages DLP registration with dataset references
 */
contract DLPRegistryV1Implementation is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    IDLPRegistryV1
{
    /// @notice Role for DLP registration operations
    bytes32 public constant DLP_REGISTRAR_ROLE =
        keccak256("DLP_REGISTRAR_ROLE");

    /// @notice Counter for DLP IDs
    uint256 private _dlpIdCounter;

    /// @notice Mapping from DLP ID to DlpInfo struct
    mapping(uint256 => DlpInfo) private _dlps;

    /// @notice Mapping from DLP address to DLP ID
    mapping(address => uint256) private _dlpAddressToId;

    /// @notice Mapping from owner to array of DLP IDs
    mapping(address => uint256[]) private _ownerDLPs;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param admin Address to be granted admin role
     */
    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DLP_REGISTRAR_ROLE, admin);

        _dlpIdCounter = 1; // Start from 1
    }

    /**
     * @notice Register a new DLP
     * @param dlpAddress Address of the DLP contract
     * @param ownerAddress Address of the DLP owner
     * @param name Name of the DLP
     * @param datasetId Optional dataset ID to associate with the DLP
     * @return dlpId The unique identifier for the registered DLP
     */
    function registerDLP(
        address dlpAddress,
        address ownerAddress,
        string memory name,
        uint256 datasetId
    ) external override nonReentrant returns (uint256) {
        require(
            hasRole(DLP_REGISTRAR_ROLE, msg.sender) ||
                msg.sender == ownerAddress,
            "Not authorized"
        );
        require(dlpAddress != address(0), "Invalid DLP address");
        require(ownerAddress != address(0), "Invalid owner address");
        require(bytes(name).length > 0, "Invalid name");
        require(_dlpAddressToId[dlpAddress] == 0, "DLP already registered");

        uint256 dlpId = _dlpIdCounter++;

        _dlps[dlpId] = DlpInfo({
            id: dlpId,
            dlpAddress: dlpAddress,
            ownerAddress: ownerAddress,
            name: name,
            datasetId: datasetId,
            isActive: true,
            registeredAt: block.timestamp
        });

        _dlpAddressToId[dlpAddress] = dlpId;
        _ownerDLPs[ownerAddress].push(dlpId);

        emit DLPRegistered(dlpId, dlpAddress, ownerAddress, name);

        if (datasetId != 0) {
            emit DLPDatasetUpdated(dlpId, datasetId);
        }

        return dlpId;
    }

    /**
     * @notice Update the dataset associated with a DLP
     * @param dlpId The DLP identifier
     * @param datasetId The new dataset identifier
     */
    function updateDLPDataset(
        uint256 dlpId,
        uint256 datasetId
    ) external override {
        DlpInfo storage dlp = _dlps[dlpId];
        require(dlp.id != 0, "DLP not found");
        require(
            msg.sender == dlp.ownerAddress ||
                hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );

        dlp.datasetId = datasetId;

        emit DLPDatasetUpdated(dlpId, datasetId);
    }

    /**
     * @notice Deactivate a DLP
     * @param dlpId The DLP to deactivate
     */
    function deactivateDLP(uint256 dlpId) external override {
        DlpInfo storage dlp = _dlps[dlpId];
        require(dlp.id != 0, "DLP not found");
        require(
            msg.sender == dlp.ownerAddress ||
                hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );
        require(dlp.isActive, "DLP already inactive");

        dlp.isActive = false;

        emit DLPDeactivated(dlpId);
    }

    /**
     * @notice Reactivate a DLP
     * @param dlpId The DLP to reactivate
     */
    function reactivateDLP(uint256 dlpId) external override {
        DlpInfo storage dlp = _dlps[dlpId];
        require(dlp.id != 0, "DLP not found");
        require(
            msg.sender == dlp.ownerAddress ||
                hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Not authorized"
        );
        require(!dlp.isActive, "DLP already active");

        dlp.isActive = true;

        emit DLPReactivated(dlpId);
    }

    /**
     * @notice Get DLP information
     * @param dlpId The DLP identifier
     * @return dlpInfo The DLP information structure
     */
    function getDLP(
        uint256 dlpId
    ) external view override returns (DlpInfo memory) {
        require(_dlps[dlpId].id != 0, "DLP not found");
        return _dlps[dlpId];
    }

    /**
     * @notice Get DLP by address
     * @param dlpAddress The DLP contract address
     * @return dlpInfo The DLP information structure
     */
    function getDLPByAddress(
        address dlpAddress
    ) external view override returns (DlpInfo memory) {
        uint256 dlpId = _dlpAddressToId[dlpAddress];
        require(dlpId != 0, "DLP not registered");
        return _dlps[dlpId];
    }

    /**
     * @notice Get all DLPs owned by an address
     * @param owner The owner address
     * @return dlps Array of DLP information structures
     */
    function getDLPsByOwner(
        address owner
    ) external view override returns (DlpInfo[] memory) {
        uint256[] memory dlpIds = _ownerDLPs[owner];
        DlpInfo[] memory dlps = new DlpInfo[](dlpIds.length);

        for (uint256 i = 0; i < dlpIds.length; i++) {
            dlps[i] = _dlps[dlpIds[i]];
        }

        return dlps;
    }

    /**
     * @notice Check if a DLP address is registered
     * @param dlpAddress The DLP address to check
     * @return isRegistered True if the DLP is registered
     */
    function isDLPRegistered(
        address dlpAddress
    ) external view override returns (bool) {
        return _dlpAddressToId[dlpAddress] != 0;
    }

    /**
     * @notice Check if a DLP is active
     * @param dlpId The DLP identifier to check
     * @return isActive True if the DLP is active
     */
    function isDLPActive(uint256 dlpId) external view override returns (bool) {
        if (_dlps[dlpId].id == 0) return false;
        return _dlps[dlpId].isActive;
    }

    /**
     * @notice Get the dataset ID for a DLP
     * @param dlpId The DLP identifier
     * @return datasetId The dataset identifier (0 if none)
     */
    function getDLPDataset(
        uint256 dlpId
    ) external view override returns (uint256) {
        require(_dlps[dlpId].id != 0, "DLP not found");
        return _dlps[dlpId].datasetId;
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
