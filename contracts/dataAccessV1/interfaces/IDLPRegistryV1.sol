// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IDLPRegistryV1
 * @notice Interface for the DLPRegistry contract with Data Access V1 support
 * @dev Extends DLP entities with dataset references
 */
interface IDLPRegistryV1 {
    /**
     * @notice Structure representing a DLP with dataset support
     * @param id Unique DLP identifier
     * @param dlpAddress Address of the DLP contract
     * @param ownerAddress Address of the DLP owner
     * @param name Name of the DLP
     * @param datasetId Reference to the dataset owned by this DLP (0 if none)
     * @param isActive Whether the DLP is currently active
     * @param registeredAt Timestamp when DLP was registered
     */
    struct DlpInfo {
        uint256 id;
        address dlpAddress;
        address ownerAddress;
        string name;
        uint256 datasetId; // NEW: Dataset reference
        bool isActive;
        uint256 registeredAt;
    }

    /**
     * @notice Emitted when a new DLP is registered
     * @param dlpId The unique DLP identifier
     * @param dlpAddress Address of the DLP contract
     * @param ownerAddress Address of the owner
     * @param name Name of the DLP
     */
    event DLPRegistered(
        uint256 indexed dlpId,
        address indexed dlpAddress,
        address indexed ownerAddress,
        string name
    );

    /**
     * @notice Emitted when a DLP's dataset is updated
     * @param dlpId The DLP identifier
     * @param datasetId The new dataset identifier
     */
    event DLPDatasetUpdated(uint256 indexed dlpId, uint256 indexed datasetId);

    /**
     * @notice Emitted when a DLP is deactivated
     * @param dlpId The DLP identifier that was deactivated
     */
    event DLPDeactivated(uint256 indexed dlpId);

    /**
     * @notice Emitted when a DLP is reactivated
     * @param dlpId The DLP identifier that was reactivated
     */
    event DLPReactivated(uint256 indexed dlpId);

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
    ) external returns (uint256 dlpId);

    /**
     * @notice Update the dataset associated with a DLP
     * @param dlpId The DLP identifier
     * @param datasetId The new dataset identifier
     */
    function updateDLPDataset(uint256 dlpId, uint256 datasetId) external;

    /**
     * @notice Deactivate a DLP
     * @param dlpId The DLP to deactivate
     */
    function deactivateDLP(uint256 dlpId) external;

    /**
     * @notice Reactivate a DLP
     * @param dlpId The DLP to reactivate
     */
    function reactivateDLP(uint256 dlpId) external;

    /**
     * @notice Get DLP information
     * @param dlpId The DLP identifier
     * @return dlpInfo The DLP information structure
     */
    function getDLP(uint256 dlpId) external view returns (DlpInfo memory dlpInfo);

    /**
     * @notice Get DLP by address
     * @param dlpAddress The DLP contract address
     * @return dlpInfo The DLP information structure
     */
    function getDLPByAddress(
        address dlpAddress
    ) external view returns (DlpInfo memory dlpInfo);

    /**
     * @notice Get all DLPs owned by an address
     * @param owner The owner address
     * @return dlps Array of DLP information structures
     */
    function getDLPsByOwner(
        address owner
    ) external view returns (DlpInfo[] memory dlps);

    /**
     * @notice Check if a DLP address is registered
     * @param dlpAddress The DLP address to check
     * @return isRegistered True if the DLP is registered
     */
    function isDLPRegistered(
        address dlpAddress
    ) external view returns (bool isRegistered);

    /**
     * @notice Check if a DLP is active
     * @param dlpId The DLP identifier to check
     * @return isActive True if the DLP is active
     */
    function isDLPActive(uint256 dlpId) external view returns (bool isActive);

    /**
     * @notice Get the dataset ID for a DLP
     * @param dlpId The DLP identifier
     * @return datasetId The dataset identifier (0 if none)
     */
    function getDLPDataset(uint256 dlpId) external view returns (uint256 datasetId);
}
