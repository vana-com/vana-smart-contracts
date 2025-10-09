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
        return 2;
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
        if (bytes(permissionInput.grant).length == 0) {
            revert EmptyGrant();
        }

        if (permissionInput.granteeId == 0 || permissionInput.granteeId > dataPortabilityGrantees.granteesCount()) {
            revert GranteeNotFound();
        }

        uint256 permissionId = ++permissionsCount;

        Permission storage permissionData = _permissions[permissionId];
        permissionData.grantor = signer;
        permissionData.nonce = permissionInput.nonce;
        permissionData.granteeId = permissionInput.granteeId;
        permissionData.grant = permissionInput.grant;
        permissionData.startBlock = block.number;
        permissionData.endBlock = type(uint256).max; // Default to no expiration

        uint256 fileIdsLength = permissionInput.fileIds.length;
        for (uint256 i = 0; i < fileIdsLength; ) {
            uint256 fileId = permissionInput.fileIds[i];
            address fileOwner = dataRegistry.files(fileId).ownerAddress;
            if (fileOwner != signer) {
                revert NotFileOwner(fileOwner, signer);
            }
            permissionData.fileIds.add(fileId);
            _filePermissions[fileId].add(permissionId);
            unchecked {
                ++i;
            }
        }

        _users[signer].permissionIds.add(permissionId);

        dataPortabilityGrantees.addPermissionToGrantee(permissionInput.granteeId, permissionId);

        emit PermissionAdded(
            permissionId,
            signer,
            permissionInput.granteeId,
            permissionInput.grant,
            permissionInput.fileIds
        );

        return permissionId;
    }

    function revokePermission(uint256 permissionId) external override whenNotPaused {
        _revokePermission(permissionId, _msgSender());
    }

    function revokePermissionWithSignature(
        RevokePermissionInput calldata revokePermissionInput,
        bytes calldata signature
    ) external override whenNotPaused {
        address signer = _extractSignerFromRevokePermission(revokePermissionInput, signature);

        User storage userData = _users[signer];

        if (revokePermissionInput.nonce != userData.nonce) {
            revert InvalidNonce(userData.nonce, revokePermissionInput.nonce);
        }

        ++userData.nonce;

        _revokePermission(revokePermissionInput.permissionId, signer);
    }

    function _revokePermission(uint256 permissionId, address signer) internal {
        Permission storage permissionData = _permissions[permissionId];
        if (permissionData.grantor != signer) {
            revert NotPermissionGrantor(permissionData.grantor, signer);
        }

        if (block.number < permissionData.startBlock || block.number > permissionData.endBlock) {
            revert InactivePermission(permissionId);
        }

        permissionData.endBlock = block.number; // Set end block to current block to revoke

        User storage userData = _users[signer];
        if (!userData.permissionIds.remove(permissionId)) {
            revert InactivePermission(permissionId);
        }

        dataPortabilityGrantees.removePermissionFromGrantee(permissionData.granteeId, permissionId);

        emit PermissionRevoked(permissionId);
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
        if (bytes(serverFilesAndPermissionInput.grant).length == 0) {
            revert EmptyGrant();
        }

        if (
            serverFilesAndPermissionInput.granteeId == 0 ||
            serverFilesAndPermissionInput.granteeId > dataPortabilityGrantees.granteesCount()
        ) {
            revert GranteeNotFound();
        }

        uint256 permissionId = ++permissionsCount;

        Permission storage permissionData = _permissions[permissionId];
        permissionData.grantor = signer;
        permissionData.nonce = serverFilesAndPermissionInput.nonce;
        permissionData.granteeId = serverFilesAndPermissionInput.granteeId;
        permissionData.grant = serverFilesAndPermissionInput.grant;
        permissionData.startBlock = block.number;
        permissionData.endBlock = type(uint256).max; // Default to no expiration

        for (uint256 i = 0; i < fileIds.length; ) {
            permissionData.fileIds.add(fileIds[i]);
            _filePermissions[fileIds[i]].add(permissionId);
            unchecked {
                ++i;
            }
        }

        _users[signer].permissionIds.add(permissionId);

        dataPortabilityGrantees.addPermissionToGrantee(serverFilesAndPermissionInput.granteeId, permissionId);

        emit PermissionAdded(
            permissionId,
            signer,
            serverFilesAndPermissionInput.granteeId,
            serverFilesAndPermissionInput.grant,
            fileIds
        );

        return permissionId;
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
}
