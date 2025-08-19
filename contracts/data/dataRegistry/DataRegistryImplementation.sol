// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./interfaces/DataRegistryStorageV1.sol";

contract DataRegistryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    MulticallUpgradeable,
    ERC2771ContextUpgradeable,
    DataRegistryStorageV1
{
    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    bytes32 public constant REFINEMENT_SERVICE_ROLE = keccak256("REFINEMENT_SERVICE_ROLE");

    bytes32 public constant DATA_PORTABILITY_ROLE = keccak256("DATA_PORTABILITY_ROLE");

    /**
     * @notice Triggered when a file has been added
     *
     * @param fileId                            id of the file
     * @param ownerAddress                      address of the owner
     * @param url                               url of the file
     */
    event FileAdded(uint256 indexed fileId, address indexed ownerAddress, string url);

    /**
     * @notice Triggered when a file has been added
     *
     * @param fileId                            id of the file
     * @param ownerAddress                      address of the owner
     * @param url                               url of the file
     * @param schemaId                          id of the schema (0 if not applicable)
     * @dev This event is used to track files with schemas in the new version of the contract.
     * @dev It is emitted in addition to the original FileAdded event to maintain backward compatibility.
     */
    event FileAddedV2(uint256 indexed fileId, address indexed ownerAddress, string url, uint256 schemaId);

    /**
     * @notice Triggered when user has added an proof to the file
     *
     * @param fileId                            id of the file
     * @param ownerAddress                      file owner address
     * @param proofIndex                        index of the proof
     * @param dlpId                             id of the DLP
     * @param score                             score of the proof
     * @param proofUrl                          url of the proof
     */
    event ProofAdded(
        uint256 indexed fileId,
        address indexed ownerAddress,
        uint256 proofIndex,
        uint256 indexed dlpId,
        uint256 score,
        string proofUrl
    );

    /**
     * @notice Triggered when user has added a refinement to the file
     *
     * @param fileId                            id of the file
     * @param refinerId                         id of the refiner
     * @param url                               url of the refinement
     */
    event RefinementAdded(uint256 indexed fileId, uint256 indexed refinerId, string url);

    /**
     * @notice Triggered when user has updated a refinement to the file
     *
     * @param fileId                            id of the file
     * @param refinerId                         id of the refiner
     * @param url                               url of the refinement
     */
    event RefinementUpdated(uint256 indexed fileId, uint256 indexed refinerId, string url);

    /**
     * @notice Triggered when user has authorized an account to access the file
     *
     * @param fileId                            id of the file
     * @param account                        address of the account
     */
    event PermissionGranted(uint256 indexed fileId, address indexed account);

    error NotFileOwner();
    error FileUrlAlreadyUsed();
    error FileNotFound();
    error NoPermission();
    error InvalidUrl();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     *
     * @param ownerAddress                      address of the owner
     */
    function initialize(address trustedForwarderAddress, address ownerAddress) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _trustedForwarder = trustedForwarderAddress;
        emitLegacyEvents = true;

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

    function setRoleAdmin(bytes32 role, bytes32 adminRole) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRoleAdmin(role, adminRole);
    }

    /**
     * @dev Returns the address of the trusted forwarder.
     */
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
     * @notice Update the trusted forwarder
     *
     * @param trustedForwarderAddress                  address of the trusted forwarder
     */
    function updateTrustedForwarder(address trustedForwarderAddress) external onlyRole(MAINTAINER_ROLE) {
        _trustedForwarder = trustedForwarderAddress;
    }

    function updateDataRefinerRegistry(IDataRefinerRegistry newDataRefinerRegistry) external onlyRole(MAINTAINER_ROLE) {
        dataRefinerRegistry = newDataRefinerRegistry;
    }

    function updateEmitLegacyEvents(bool newEmitLegacyEvents) external onlyRole(MAINTAINER_ROLE) {
        emitLegacyEvents = newEmitLegacyEvents;
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
     * @notice Returns information about the file
     *
     * @param fileId                            id of the file
     * @return FileResponse                     information about the file
     */
    function files(uint256 fileId) external view returns (FileResponse memory) {
        File storage file = _files[fileId];

        return
            FileResponse({
                id: fileId,
                url: file.url,
                ownerAddress: file.ownerAddress,
                schemaId: file.schemaId,
                addedAtBlock: file.addedAtBlock
            });
    }

    /**
     * @notice Get fileId by URL
     * @param url The URL to look up
     * @return fileId The ID of the file (0 if not found)
     */
    function fileIdByUrl(string memory url) external view override returns (uint256) {
        return _urlHashToFileId[keccak256(abi.encodePacked(url))];
    }

    /**
     * @notice Returns the proof of the file
     *
     * @param fileId                            id of the file
     * @param index                             index of the proof
     * @return Proof                            proof of the file
     */
    function fileProofs(uint256 fileId, uint256 index) external view override returns (Proof memory) {
        return _files[fileId].proofs[index];
    }

    /**
     * @notice Returns permissions for the file
     *
     * @param fileId                            id of the file
     * @param account                        address of the account
     * @return string                           key for the account
     */
    function filePermissions(uint256 fileId, address account) external view override returns (string memory) {
        return _files[fileId].permissions[account];
    }

    /**
     * @notice Adds a file to the registry
     *
     * @param url                               url of the file
     * @return uint256                          id of the file
     */
    function addFile(string memory url) external override whenNotPaused returns (uint256) {
        return addFileWithSchema(url, 0);
    }

    function addFileWithSchema(string memory url, uint256 schemaId) public override whenNotPaused returns (uint256) {
        return _addFile(url, _msgSender(), schemaId);
    }

    /**
     * @notice Adds a file to the registry with permissions
     *
     * @param url                               url of the file
     * @param ownerAddress                      address of the owner
     * @param permissions                       permissions for the file
     * @return uint256                          id of the file
     */
    function addFileWithPermissions(
        string memory url,
        address ownerAddress,
        Permission[] memory permissions
    ) external override whenNotPaused returns (uint256) {
        return addFileWithPermissionsAndSchema(url, ownerAddress, permissions, 0);
    }

    function addFileWithPermissionsAndSchema(
        string memory url,
        address ownerAddress,
        Permission[] memory permissions,
        uint256 schemaId
    ) public override whenNotPaused returns (uint256) {
        uint256 fileId = _addFile(url, ownerAddress, schemaId);

        for (uint256 i = 0; i < permissions.length; i++) {
            _files[fileId].permissions[permissions[i].account] = permissions[i].key;
            emit PermissionGranted(fileId, permissions[i].account);
        }

        return fileId;
    }

    /**
     * @notice Adds an proof to the file
     *
     * @param fileId                            id of the file
     * @param proof                       proof for the file
     */
    function addProof(uint256 fileId, Proof memory proof) external override whenNotPaused {
        uint256 cachedProofCount = ++_files[fileId].proofsCount;

        _files[fileId].proofs[cachedProofCount] = proof;

        emit ProofAdded(
            fileId,
            _files[fileId].ownerAddress,
            cachedProofCount,
            proof.data.dlpId,
            proof.data.score,
            proof.data.proofUrl
        );
    }

    /**
     * @notice Adds permissions for accounts to access the file
     *
     * @param fileId                            id of the file
     * @param account                           address of the account
     * @param key                               encryption key for the account
     */
    function addFilePermission(uint256 fileId, address account, string memory key) external override whenNotPaused {
        if (_msgSender() != _files[fileId].ownerAddress && !hasRole(DATA_PORTABILITY_ROLE, _msgSender())) {
            revert NotFileOwner();
        }

        _files[fileId].permissions[account] = key;
        emit PermissionGranted(fileId, account);
    }

    /// @inheritdoc IDataRegistry
    function addRefinementWithPermission(
        uint256 fileId,
        uint256 refinerId,
        string calldata url,
        address account,
        string calldata key
    ) external override whenNotPaused {
        // @dev Only the account with REFINEMENT_SERVICE_ROLE or with a permission to decrypt the file key can add refinements.
        // This is to prevent malicious actors from adding refinements to files they don't have access to
        // or adding arbitrary permissions to the file.
        if (
            !hasRole(REFINEMENT_SERVICE_ROLE, msg.sender) &&
            !dataRefinerRegistry.isRefinementService(refinerId, _msgSender())
        ) {
            revert NoPermission();
        }

        // @dev _files is 1-indexed
        if (fileId > filesCount || fileId == 0) {
            revert FileNotFound();
        }

        File storage _file = _files[fileId];

        // @dev Refinement is only allowed to be added once per refiner with a non-empty URL.
        // This is to prevent refiners from changing the refinement URL or
        // adding empty URLs to bypass addFilePermission.
        if (bytes(url).length == 0) {
            revert InvalidUrl();
        }

        if (bytes(_file.refinements[refinerId]).length != 0) {
            emit RefinementUpdated(fileId, refinerId, url);
        } else {
            emit RefinementAdded(fileId, refinerId, url);
        }
        _file.refinements[refinerId] = url;

        // @dev Add permission for the account to access the refinement.
        // The permission for an account is not allowed to be changed once set,
        // to prevent previous refinements from being inaccessible.
        if (bytes(_file.permissions[account]).length == 0) {
            _file.permissions[account] = key;
            emit PermissionGranted(fileId, account);
        }
    }

    /// @inheritdoc IDataRegistry
    function fileRefinements(uint256 fileId, uint256 refinerId) external view override returns (string memory) {
        return _files[fileId].refinements[refinerId];
    }

    /**
     * @notice Adds a file to the registry
     *
     * @param url                               url of the file
     * @param ownerAddress                      address of the owner
     * @param schemaId                          id of the schema (0 if not applicable)
     */
    function _addFile(string memory url, address ownerAddress, uint256 schemaId) internal returns (uint256) {
        uint256 cachedFilesCount = ++filesCount;

        bytes32 urlHash = keccak256(abi.encodePacked(url));

        if (_urlHashToFileId[urlHash] != 0) {
            revert FileUrlAlreadyUsed();
        }

        if (schemaId > 0 && !dataRefinerRegistry.isValidSchemaId(schemaId)) {
            revert IDataRefinerRegistry.InvalidSchemaId(schemaId);
        }

        File storage file = _files[cachedFilesCount];

        file.ownerAddress = ownerAddress;
        file.url = url;
        file.addedAtBlock = block.number;
        file.schemaId = schemaId;

        _urlHashToFileId[urlHash] = cachedFilesCount;

        if (emitLegacyEvents) {
            emit FileAdded(cachedFilesCount, ownerAddress, url);
        }
        emit FileAddedV2(cachedFilesCount, ownerAddress, url, schemaId);

        return cachedFilesCount;
    }
}
