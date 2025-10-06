// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/DataPortabilityPermissionsStorage.sol";

/**
 * @title DataPortabilityPermissionsImplementation
 * @notice Implementation contract for data portability permission management
 * @dev Implements IDataPortabilityPermissions interface with UUPS upgradeability
 * @custom:see IDataPortabilityPermissions For complete interface documentation
 */
contract DataPortabilityPermissionsImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ERC2771ContextUpgradeable,
    EIP712Upgradeable,
    DataPortabilityPermissionsStorage
{
    using ECDSA for bytes32;
    using EnumerableSet for EnumerableSet.UintSet;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    string private constant SIGNING_DOMAIN = "VanaDataPortabilityPermissions";
    string private constant SIGNATURE_VERSION = "1";

    bytes32 private constant PERMISSION_TYPEHASH =
        keccak256("Permission(uint256 nonce,uint256 granteeId,string grant,uint256[] fileIds)");
    bytes32 private constant REVOKE_PERMISSION_TYPEHASH =
        keccak256("RevokePermission(uint256 nonce,uint256 permissionId)");
    bytes32 private constant REVOKE_PERMISSION_FILES_TYPEHASH =
        keccak256("RevokePermissionFiles(uint256 nonce,uint256 permissionId,uint256[] fileIds)");
    bytes32 private constant SERVER_FILES_AND_PERMISSION_TYPEHASH =
        keccak256(
            "ServerFilesAndPermission(uint256 nonce,uint256 granteeId,string grant,string[] fileUrls,uint256[] schemaIds,address serverAddress,string serverUrl,string serverPublicKey,Permission[][] filePermissions)Permission(address account,string key)"
        );

    error InvalidNonce(uint256 expectedNonce, uint256 providedNonce);
    error InvalidSignature();
    error EmptyGrant();
    error ZeroAddress();
    error GranteeNotFound();
    error InactivePermission(uint256 permissionId);
    error NotPermissionGrantor(address permissionOwner, address requestor);
    error NotFileOwner(address fileOwner, address requestor);
    error InvalidPermissionsLength(uint256 filesLength, uint256 permissionsLength);
    error InvalidSchemaIdsLength(uint256 filesLength, uint256 schemaIdsLength);
    error FileNotInPermission(uint256 permissionId, uint256 fileId);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    function initialize(
        address trustedForwarderAddress,
        address ownerAddress,
        IDataRegistry dataRegistryAddress,
        IDataPortabilityServers serversContractAddr,
        IDataPortabilityGrantees granteesContractAddr
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __EIP712_init(SIGNING_DOMAIN, SIGNATURE_VERSION);

        _trustedForwarder = trustedForwarderAddress;
        dataRegistry = dataRegistryAddress;
        dataPortabilityServers = serversContractAddr;
        dataPortabilityGrantees = granteesContractAddr;

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

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

    function trustedForwarder()
        public
        view
        virtual
        override(ERC2771ContextUpgradeable, IDataPortabilityPermissions)
        returns (address)
    {
        return _trustedForwarder;
    }

    function version() external pure virtual override returns (uint256) {
        return 3;
    }

    function updateTrustedForwarder(address trustedForwarderAddress) external override onlyRole(MAINTAINER_ROLE) {
        _trustedForwarder = trustedForwarderAddress;
    }

    function updateDataRegistry(IDataRegistry newDataRegistry) external override onlyRole(MAINTAINER_ROLE) {
        if (address(newDataRegistry) == address(0)) {
            revert ZeroAddress();
        }
        dataRegistry = newDataRegistry;
    }

    function updateServersContract(
        IDataPortabilityServers newServersContract
    ) external override onlyRole(MAINTAINER_ROLE) {
        if (address(newServersContract) == address(0)) {
            revert ZeroAddress();
        }
        dataPortabilityServers = newServersContract;
    }

    function updateGranteesContract(
        IDataPortabilityGrantees newGranteesContract
    ) external override onlyRole(MAINTAINER_ROLE) {
        if (address(newGranteesContract) == address(0)) {
            revert ZeroAddress();
        }
        dataPortabilityGrantees = newGranteesContract;
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function _extractSignerFromPermission(
        PermissionInput calldata permissionInput,
        bytes calldata signature
    ) internal view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(
                PERMISSION_TYPEHASH,
                permissionInput.nonce,
                permissionInput.granteeId,
                keccak256(bytes(permissionInput.grant)),
                keccak256(abi.encodePacked(permissionInput.fileIds))
            )
        );

        return _extractSigner(structHash, signature);
    }

    function _extractSignerFromRevokePermission(
        RevokePermissionInput calldata revokePermissionInput,
        bytes calldata signature
    ) internal view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(REVOKE_PERMISSION_TYPEHASH, revokePermissionInput.nonce, revokePermissionInput.permissionId)
        );

        return _extractSigner(structHash, signature);
    }

    function _extractSignerFromRevokePermissionFiles(
        RevokePermissionFilesInput calldata revokePermissionFilesInput,
        bytes calldata signature
    ) internal view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(
                REVOKE_PERMISSION_FILES_TYPEHASH,
                revokePermissionFilesInput.nonce,
                revokePermissionFilesInput.permissionId,
                keccak256(abi.encodePacked(revokePermissionFilesInput.fileIds))
            )
        );

        return _extractSigner(structHash, signature);
    }

    /**
     * @notice Extracts signer from ServerFilesAndPermission EIP-712 signature
     * @dev Uses domain separator and type hash to verify signature authenticity
     * @param serverFilesAndPermissionInput The signed input data
     * @param signature The EIP-712 signature to verify
     * @return address The recovered signer address
     */
    function _extractSignerFromServerFilesAndPermission(
        ServerFilesAndPermissionInput calldata serverFilesAndPermissionInput,
        bytes calldata signature
    ) internal view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(
                SERVER_FILES_AND_PERMISSION_TYPEHASH,
                serverFilesAndPermissionInput.nonce,
                serverFilesAndPermissionInput.granteeId,
                keccak256(bytes(serverFilesAndPermissionInput.grant)),
                _hashStringArray(serverFilesAndPermissionInput.fileUrls),
                _hashUint256Array(serverFilesAndPermissionInput.schemaIds),
                serverFilesAndPermissionInput.serverAddress,
                keccak256(bytes(serverFilesAndPermissionInput.serverUrl)),
                keccak256(bytes(serverFilesAndPermissionInput.serverPublicKey)),
                _hashPermissionsArray(serverFilesAndPermissionInput.filePermissions)
            )
        );

        return _extractSigner(structHash, signature);
    }

    function _extractSigner(bytes32 structHash, bytes calldata signature) internal view returns (address) {
        bytes32 digest = _hashTypedDataV4(structHash);
        return digest.recover(signature);
    }

    /**
     * @notice Hashes an array of strings for EIP-712 signature verification
     * @dev Creates deterministic hash by hashing each string individually then packing results
     * @param stringArray Array of strings to hash
     * @return bytes32 Keccak256 hash of the packed individual string hashes
     */
    function _hashStringArray(string[] calldata stringArray) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](stringArray.length);
        for (uint256 i = 0; i < stringArray.length; ) {
            hashes[i] = keccak256(bytes(stringArray[i]));
            unchecked {
                ++i;
            }
        }
        return keccak256(abi.encodePacked(hashes));
    }

    /**
     * @notice Hashes an array of uint256 for EIP-712 signature verification
     * @dev Creates deterministic hash by packing the uint256 values
     * @param uintArray Array of uint256 to hash
     * @return bytes32 Keccak256 hash of the packed uint256 array
     */
    function _hashUint256Array(uint256[] calldata uintArray) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(uintArray));
    }

    // In DataPortabilityPermissionsImplementation contract

    // Define the typehash for the inner Permission struct
    bytes32 private constant INNER_PERMISSION_TYPEHASH = keccak256("Permission(address account,string key)"); // This typehash must match the JS side

    /**
     * @notice Hashes a 2D array of permissions for EIP-712 signature verification
     * @dev Creates deterministic hash by hashing each permission array then packing results
     * @param permissionsArray 2D array of permissions to hash
     * @return bytes32 Keccak256 hash of the packed permission array hashes
     */
    function _hashPermissionsArray(
        IDataRegistry.Permission[][] calldata permissionsArray
    ) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](permissionsArray.length);
        for (uint256 i = 0; i < permissionsArray.length; ) {
            bytes32[] memory permissionHashes = new bytes32[](permissionsArray[i].length);
            for (uint256 j = 0; j < permissionsArray[i].length; ) {
                // Correct EIP-712 struct hashing for each Permission
                permissionHashes[j] = keccak256(
                    abi.encode(
                        INNER_PERMISSION_TYPEHASH, // Include the typehash for the struct
                        permissionsArray[i][j].account,
                        keccak256(bytes(permissionsArray[i][j].key))
                    )
                );
                unchecked {
                    ++j;
                }
            }
            // This part (packing the hashes of inner arrays) is standard EIP-712 for arrays of structs
            hashes[i] = keccak256(abi.encodePacked(permissionHashes));
            unchecked {
                ++i;
            }
        }
        // This part (packing the hashes of outer arrays) is also standard EIP-712 for arrays of arrays
        return keccak256(abi.encodePacked(hashes));
    }

    /**
     * @notice Hashes a 2D array of permissions for EIP-712 signature verification
     * @dev Creates deterministic hash by hashing each permission array then packing results
     * @param permissionsArray 2D array of permissions to hash
     * @return bytes32 Keccak256 hash of the packed permission array hashes
     */
    function _hashPermissionsArray2(
        IDataRegistry.Permission[][] calldata permissionsArray
    ) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](permissionsArray.length);
        for (uint256 i = 0; i < permissionsArray.length; ) {
            bytes32[] memory permissionHashes = new bytes32[](permissionsArray[i].length);
            for (uint256 j = 0; j < permissionsArray[i].length; ) {
                permissionHashes[j] = keccak256(
                    abi.encode(permissionsArray[i][j].account, keccak256(bytes(permissionsArray[i][j].key)))
                );
                unchecked {
                    ++j;
                }
            }
            hashes[i] = keccak256(abi.encodePacked(permissionHashes));
            unchecked {
                ++i;
            }
        }
        return keccak256(abi.encodePacked(hashes));
    }

    function userPermissionIdsValues(address userAddress) external view override returns (uint256[] memory) {
        return _users[userAddress].permissionIds.values();
    }

    function userPermissionIdsAt(
        address userAddress,
        uint256 permissionIndex
    ) external view override returns (uint256) {
        return _users[userAddress].permissionIds.at(permissionIndex);
    }

    function userPermissionIdsLength(address userAddress) external view override returns (uint256) {
        return _users[userAddress].permissionIds.length();
    }

    function permissions(uint256 permissionId) external view override returns (PermissionInfo memory) {
        Permission storage permissionData = _permissions[permissionId];
        return
            PermissionInfo({
                id: permissionId,
                grantor: permissionData.grantor,
                nonce: permissionData.nonce,
                granteeId: permissionData.granteeId,
                grant: permissionData.grant,
                startBlock: permissionData.startBlock,
                endBlock: permissionData.endBlock,
                fileIds: permissionData.fileIds.values()
            });
    }

    /**
     * @notice Gets the permission details for a specific file in a permission
     * @dev Returns the PermissionFile struct with start and end block for a file's permission
     * @param permissionId The ID of the permission
     * @param fileId The file ID to get details for
     * @return PermissionFile struct containing startBlock and endBlock
     */
    function permissionFiles(
        uint256 permissionId,
        uint256 fileId
    ) external view override returns (PermissionFile memory) {
        return _permissions[permissionId].filePermissions[fileId];
    }

    function userNonce(address userAddress) external view override returns (uint256) {
        return _users[userAddress].nonce;
    }

    function addPermission(
        PermissionInput calldata permissionInput,
        bytes calldata signature
    ) external override whenNotPaused returns (uint256) {
        address signer = _extractSignerFromPermission(permissionInput, signature);
        User storage userData = _users[signer];

        if (permissionInput.nonce != userData.nonce) {
            revert InvalidNonce(userData.nonce, permissionInput.nonce);
        }

        ++userData.nonce;

        return _addPermission(permissionInput, signer);
    }

    function _addPermission(PermissionInput calldata permissionInput, address signer) internal returns (uint256) {
        // Validate file ownership
        uint256 fileIdsLength = permissionInput.fileIds.length;
        for (uint256 i = 0; i < fileIdsLength; ) {
            uint256 fileId = permissionInput.fileIds[i];
            address fileOwner = dataRegistry.files(fileId).ownerAddress;
            if (fileOwner != signer) {
                revert NotFileOwner(fileOwner, signer);
            }
            unchecked {
                ++i;
            }
        }

        return
            _createPermission(
                signer,
                permissionInput.nonce,
                permissionInput.granteeId,
                permissionInput.grant,
                permissionInput.fileIds
            );
    }

    /**
     * @notice Internal function to create permission with common logic
     * @dev Shared permission creation logic used by both direct and server-based flows
     *      Permission hash is based on (signer, granteeId, grant) without nonce or fileIds
     *      If a permission with the same hash exists:
     *      - If inactive (revoked), it will be reactivated and new files added
     *      - If active, new files are added to the existing permission
     *      If no permission exists, creates a new one with the specified files
     * @param signer The verified signer address
     * @param nonce The nonce for this permission
     * @param granteeId The ID of the grantee
     * @param grant The grant string
     * @param fileIds Array of file IDs to associate with the permission
     * @return uint256 The unique ID of the created, reactivated, or existing permission
     */
    function _createPermission(
        address signer,
        uint256 nonce,
        uint256 granteeId,
        string memory grant,
        uint256[] memory fileIds
    ) internal returns (uint256) {
        if (bytes(grant).length == 0) {
            revert EmptyGrant();
        }

        if (granteeId == 0 || granteeId > dataPortabilityGrantees.granteesCount()) {
            revert GranteeNotFound();
        }

        // Compute hash based on signer, granteeId, and grant (without nonce or fileIds)
        bytes32 permissionHash = keccak256(abi.encodePacked(signer, granteeId, grant));

        // Check if permission with same hash already exists
        uint256 permissionId = permissionHashToId[permissionHash];

        Permission storage permissionData;

        if (permissionId == 0) {
            // Create new permission
            permissionId = ++permissionsCount;

            permissionData = _permissions[permissionId];
            permissionData.grantor = signer;
            permissionData.nonce = nonce;
            permissionData.granteeId = granteeId;
            permissionData.grant = grant;
            permissionData.startBlock = block.number;
            permissionData.endBlock = type(uint256).max; // Default to no expiration

            // Emit permission creation event
            emit PermissionCreated(permissionId, signer, granteeId, grant, block.number);
        } else {
            permissionData = _permissions[permissionId];

            if (block.number < permissionData.startBlock || block.number > permissionData.endBlock) {
                // Permission is inactive, reactivate it
                permissionData.startBlock = block.number;
                permissionData.endBlock = type(uint256).max; // Reset to no expiration
            }
        }

        _users[signer].permissionIds.add(permissionId);
        dataPortabilityGrantees.addPermissionToGrantee(granteeId, permissionId);

        uint256 fileIdsLength = fileIds.length;
        for (uint256 i = 0; i < fileIdsLength; ) {
            uint256 fileId = fileIds[i];

            address fileOwner = dataRegistry.files(fileId).ownerAddress;
            if (fileOwner != signer) {
                revert NotFileOwner(fileOwner, signer);
            }

            // File is completely new to this permission
            permissionData.fileIds.add(fileId);
            _filePermissions[fileId].add(permissionId);
            permissionData.filePermissions[fileId].endBlock = type(uint256).max;

            if (permissionData.filePermissions[fileId].startBlock == 0) {
                permissionData.filePermissions[fileId].startBlock = block.number;
            }

            emit FileAddedToPermission(permissionId, fileId, permissionData.filePermissions[fileId].startBlock);

            unchecked {
                ++i;
            }
        }

        permissionHashToId[permissionHash] = permissionId;

        return permissionId;
    }

    function revokeFilePermission(uint256 permissionId, uint256 fileId) external override whenNotPaused {
        Permission storage permissionData = _permissions[permissionId];
        address signer = _msgSender();

        if (permissionData.grantor != signer) {
            revert NotPermissionGrantor(permissionData.grantor, signer);
        }

        if (block.number < permissionData.startBlock || block.number > permissionData.endBlock) {
            revert InactivePermission(permissionId);
        }

        if (!permissionData.fileIds.contains(fileId)) {
            revert FileNotInPermission(permissionId, fileId);
        }

        PermissionFile storage filePermission = permissionData.filePermissions[fileId];

        // Check if file permission is currently active
        if (block.number < filePermission.startBlock || block.number > filePermission.endBlock) {
            revert InactivePermission(permissionId);
        }

        // Revoke file by setting its endBlock to current block
        filePermission.endBlock = block.number;

        emit FileRemovedFromPermission(permissionId, fileId, block.number);
    }

    function revokePermissionFiles(
        RevokePermissionFilesInput calldata revokePermissionFilesInput,
        bytes calldata signature
    ) external override whenNotPaused {
        address signer = _extractSignerFromRevokePermissionFiles(revokePermissionFilesInput, signature);

        User storage userData = _users[signer];

        if (revokePermissionFilesInput.nonce != userData.nonce) {
            revert InvalidNonce(userData.nonce, revokePermissionFilesInput.nonce);
        }

        ++userData.nonce;

        Permission storage permissionData = _permissions[revokePermissionFilesInput.permissionId];

        if (permissionData.grantor != signer) {
            revert NotPermissionGrantor(permissionData.grantor, signer);
        }

        // Revoke each file
        uint256 fileIdsLength = revokePermissionFilesInput.fileIds.length;
        for (uint256 i = 0; i < fileIdsLength; ) {
            uint256 fileId = revokePermissionFilesInput.fileIds[i];

            if (!permissionData.fileIds.contains(fileId)) {
                revert FileNotInPermission(revokePermissionFilesInput.permissionId, fileId);
            }

            PermissionFile storage filePermission = permissionData.filePermissions[fileId];

            // Only revoke if endBlock is 0 or max (active)
            if (filePermission.endBlock == 0 || filePermission.endBlock == type(uint256).max) {
                filePermission.endBlock = block.number;
                emit FileRemovedFromPermission(revokePermissionFilesInput.permissionId, fileId, block.number);
            }

            unchecked {
                ++i;
            }
        }
    }

    /// @inheritdoc IDataPortabilityPermissions
    /// @dev Implementation combines three operations atomically:
    ///      1. Server registration via DataPortabilityServers.addAndTrustServerOnBehalf
    ///      2. File registration via DataRegistry.addFileWithPermissions (for new files)
    ///      3. Permission creation via internal _addPermissionFromServerFiles method
    function addServerFilesAndPermissions(
        ServerFilesAndPermissionInput calldata serverFilesAndPermissionInput,
        bytes calldata signature
    ) external override whenNotPaused returns (uint256) {
        address signer = _extractSignerFromServerFilesAndPermission(serverFilesAndPermissionInput, signature);
        User storage userData = _users[signer];

        if (serverFilesAndPermissionInput.nonce != userData.nonce) {
            revert InvalidNonce(userData.nonce, serverFilesAndPermissionInput.nonce);
        }

        ++userData.nonce;

        // Validate schemaIds array length matches fileUrls
        if (serverFilesAndPermissionInput.schemaIds.length != serverFilesAndPermissionInput.fileUrls.length) {
            revert InvalidSchemaIdsLength(
                serverFilesAndPermissionInput.fileUrls.length,
                serverFilesAndPermissionInput.schemaIds.length
            );
        }

        // Validate filePermissions array length matches fileUrls
        if (serverFilesAndPermissionInput.filePermissions.length != serverFilesAndPermissionInput.fileUrls.length) {
            revert InvalidPermissionsLength(
                serverFilesAndPermissionInput.fileUrls.length,
                serverFilesAndPermissionInput.filePermissions.length
            );
        }

        // 1. Check if server exists and handle accordingly
        uint256 serverId = dataPortabilityServers.serverAddressToId(serverFilesAndPermissionInput.serverAddress);

        if (serverId == 0) {
            // Server doesn't exist, add and trust it
            dataPortabilityServers.addAndTrustServerByManager(
                signer,
                IDataPortabilityServers.AddServerInput({
                    serverAddress: serverFilesAndPermissionInput.serverAddress,
                    publicKey: serverFilesAndPermissionInput.serverPublicKey,
                    serverUrl: serverFilesAndPermissionInput.serverUrl
                })
            );
        } else {
            dataPortabilityServers.trustServerByManager(signer, serverId);
        }

        // 2. Add files to DataRegistry with specific permissions for each file
        uint256[] memory fileIds = new uint256[](serverFilesAndPermissionInput.fileUrls.length);
        for (uint256 i = 0; i < serverFilesAndPermissionInput.fileUrls.length; ) {
            // Check if file already exists
            uint256 existingFileId = dataRegistry.fileIdByUrl(serverFilesAndPermissionInput.fileUrls[i]);
            if (existingFileId != 0) {
                // File exists, verify ownership
                if (dataRegistry.files(existingFileId).ownerAddress != signer) {
                    revert NotFileOwner(dataRegistry.files(existingFileId).ownerAddress, signer);
                }
                fileIds[i] = existingFileId;

                dataRegistry.addFilePermissionsAndSchema(
                    existingFileId,
                    serverFilesAndPermissionInput.filePermissions[i],
                    serverFilesAndPermissionInput.schemaIds[i]
                );
            } else {
                // Add new file with permissions and schema
                fileIds[i] = dataRegistry.addFileWithPermissionsAndSchema(
                    serverFilesAndPermissionInput.fileUrls[i],
                    signer,
                    serverFilesAndPermissionInput.filePermissions[i],
                    serverFilesAndPermissionInput.schemaIds[i]
                );
            }
            unchecked {
                ++i;
            }
        }

        // 3. Add permission directly using internal logic
        return _addPermissionFromServerFiles(serverFilesAndPermissionInput, fileIds, signer);
    }

    /**
     * @notice Internal function to create permission from server files operation
     * @dev Specialized permission creation for the combined server/files/permission flow
     * @param serverFilesAndPermissionInput The server files and permission input data
     * @param fileIds Array of file IDs to associate with the permission
     * @param signer The verified signer address
     * @return uint256 The unique ID of the created permission
     */
    function _addPermissionFromServerFiles(
        ServerFilesAndPermissionInput calldata serverFilesAndPermissionInput,
        uint256[] memory fileIds,
        address signer
    ) internal returns (uint256) {
        return
            _createPermission(
                signer,
                serverFilesAndPermissionInput.nonce,
                serverFilesAndPermissionInput.granteeId,
                serverFilesAndPermissionInput.grant,
                fileIds
            );
    }

    function filePermissionIds(uint256 fileId) external view override returns (uint256[] memory) {
        return _filePermissions[fileId].values();
    }

    function permissionFileIds(uint256 permissionId) external view override returns (uint256[] memory) {
        return _permissions[permissionId].fileIds.values();
    }

    function users(address userAddress) external view override returns (uint256 nonce, uint256[] memory permissionIds) {
        User storage userData = _users[userAddress];
        return (userData.nonce, userData.permissionIds.values());
    }

    function filePermissions(uint256 fileId) external view override returns (uint256[] memory) {
        return _filePermissions[fileId].values();
    }

    /**
     * @notice Checks if a permission already exists for the given parameters
     * @dev Computes the permission hash and looks it up in the registry
     *      Returns 0 if no permission exists, otherwise returns the permission ID
     *      Note: Permission hash is based on (grantor, granteeId, grant) without nonce or fileIds
     * @param grantor The address of the permission grantor
     * @param granteeId The ID of the grantee
     * @param grant The grant string (e.g., IPFS URI)
     * @return uint256 The permission ID if it exists, 0 otherwise
     */
    function existingPermissionId(
        address grantor,
        uint256 granteeId,
        string calldata grant
    ) external view override returns (uint256) {
        // Compute the permission hash using the same logic as _createPermission
        bytes32 permissionHash = keccak256(abi.encodePacked(grantor, granteeId, grant));

        // Return the permission ID (0 if doesn't exist)
        return permissionHashToId[permissionHash];
    }

    /**
     * @notice Checks if a specific file is included and active in a permission
     * @dev Returns true if the file ID exists in the permission and is currently active
     * @param permissionId The ID of the permission to check
     * @param fileId The file ID to check for
     * @return bool True if the file is in the permission and active, false otherwise
     */
    function existingPermissionFileId(uint256 permissionId, uint256 fileId) external view override returns (bool) {
        Permission storage permission = _permissions[permissionId];

        if (!permission.fileIds.contains(fileId)) {
            return false;
        }

        PermissionFile storage filePermission = permission.filePermissions[fileId];
        return block.number >= filePermission.startBlock && block.number <= filePermission.endBlock;
    }

    /**
     * @notice Migrates existing permissions to populate permission hashes retroactively
     * @dev This function is used to add hashes for permissions created before the new hash format was implemented
     *      Permission hash is now based on (grantor, granteeId, grant) without nonce or fileIds
     *      If duplicate permissions are found (both active), the later permission is "ghosted":
     *      - Removed from user's permission set
     *      - Removed from grantee's permission set
     *      - Permission data remains in storage but is no longer tracked
     * @param startPermissionId The starting permission ID for the batch (inclusive)
     * @param endPermissionId The ending permission ID for the batch (inclusive)
     * @custom:security Only callable by MAINTAINER_ROLE for one-time migration after upgrade
     */
    function migratePermissionHashes(
        uint256 startPermissionId,
        uint256 endPermissionId
    ) external onlyRole(MAINTAINER_ROLE) {
        require(startPermissionId > 0 && startPermissionId <= endPermissionId, "Invalid range");
        require(endPermissionId <= permissionsCount, "End ID exceeds total count");

        for (uint256 permissionId = startPermissionId; permissionId <= endPermissionId; ) {
            Permission storage permissionData = _permissions[permissionId];

            // Skip if permission has no grantor (invalid/deleted permission)
            if (permissionData.grantor == address(0)) {
                unchecked {
                    ++permissionId;
                }
                continue;
            }

            // Compute the permission hash using new format (grantor, granteeId, grant)
            bytes32 permissionHash = keccak256(
                abi.encodePacked(permissionData.grantor, permissionData.granteeId, permissionData.grant)
            );

            // Check if this hash already exists
            uint256 existingPermId = permissionHashToId[permissionHash];

            if (existingPermId != 0 && existingPermId != permissionId) {
                // Duplicate found - determine which one to keep
                Permission storage existingPermission = _permissions[existingPermId];

                // Check if both are active
                bool currentActive = block.number >= permissionData.startBlock &&
                    block.number <= permissionData.endBlock;
                bool existingActive = block.number >= existingPermission.startBlock &&
                    block.number <= existingPermission.endBlock;

                if (currentActive && existingActive) {
                    // Both active - ghost the later one (current)
                    // Remove from user's permission set
                    _users[permissionData.grantor].permissionIds.remove(permissionId);

                    // Remove from grantee's permission set
                    dataPortabilityGrantees.removePermissionFromGrantee(permissionData.granteeId, permissionId);

                    emit DuplicatePermissionGhosted(permissionId, existingPermId);
                } else if (!existingActive && currentActive) {
                    // Existing is inactive, current is active - replace the hash mapping
                    permissionHashToId[permissionHash] = permissionId;
                }
                // If current is inactive, leave the existing mapping as is
            } else if (existingPermId == 0) {
                // No duplicate - add the hash mapping
                permissionHashToId[permissionHash] = permissionId;
            }
            // If existingPermId == permissionId, hash already correctly mapped

            unchecked {
                ++permissionId;
            }
        }
    }
}
