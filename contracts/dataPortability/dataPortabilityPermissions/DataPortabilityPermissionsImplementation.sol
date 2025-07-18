// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/DataPortabilityPermissionsStorage.sol";

contract DataPortabilityPermissionsImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    MulticallUpgradeable,
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

    error InvalidNonce(uint256 expectedNonce, uint256 providedNonce);
    error GrantAlreadyUsed();
    error InvalidSignature();
    error EmptyGrant();
    error ZeroAddress();
    error GranteeNotFound();
    error InactivePermission(uint256 permissionId);
    error NotPermissionGrantor(address permissionOwner, address requestor);
    error NotFileOwner(address fileOwner, address requestor);

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

    function _extractSigner(bytes32 structHash, bytes calldata signature) internal view returns (address) {
        bytes32 digest = _hashTypedDataV4(structHash);
        return digest.recover(signature);
    }

    function userPermissionIdsValues(address userAddress) external view override returns (uint256[] memory) {
        return _users[userAddress].permissionIds.values();
    }

    function userPermissionIdsAt(address userAddress, uint256 permissionIndex) external view override returns (uint256) {
        return _users[userAddress].permissionIds.at(permissionIndex);
    }

    function userPermissionIdsLength(address userAddress) external view override returns (uint256) {
        return _users[userAddress].permissionIds.length();
    }

    function userRevokedPermissionIdsValues(address userAddress) external view override returns (uint256[] memory) {
        return _users[userAddress].revokedPermissionIds.values();
    }

    function userRevokedPermissionIdsAt(
        address userAddress,
        uint256 permissionIndex
    ) external view override returns (uint256) {
        return _users[userAddress].revokedPermissionIds.at(permissionIndex);
    }

    function userRevokedPermissionIdsLength(address userAddress) external view override returns (uint256) {
        return _users[userAddress].revokedPermissionIds.length();
    }

    function permission(uint256 permissionId) external view override returns (PermissionInfo memory) {
        Permission storage permissionData = _permissions[permissionId];
        return
            PermissionInfo({
                id: permissionId,
                grantor: permissionData.grantor,
                nonce: permissionData.nonce,
                granteeId: permissionData.granteeId,
                grant: permissionData.grant,
                signature: permissionData.signature,
                startBlock: permissionData.startBlock,
                endBlock: permissionData.endBlock,
                fileIds: permissionData.fileIds.values()
            });
    }

    function userNonce(address userAddress) external view override returns (uint256) {
        return _users[userAddress].nonce;
    }

    function permissionIdByGrant(string memory grant) external view override returns (uint256) {
        return grantHashToPermissionId[keccak256(abi.encodePacked(grant))];
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

        return _addPermission(permissionInput, signature, signer);
    }

    function _addPermission(
        PermissionInput calldata permissionInput,
        bytes calldata signature,
        address signer
    ) internal returns (uint256) {
        if (bytes(permissionInput.grant).length == 0) {
            revert EmptyGrant();
        }

        if (permissionInput.granteeId == 0 || permissionInput.granteeId > dataPortabilityGrantees.granteesCount()) {
            revert GranteeNotFound();
        }

        bytes32 grantHash = keccak256(abi.encodePacked(permissionInput.grant));
        if (grantHashToPermissionId[grantHash] != 0) {
            revert GrantAlreadyUsed();
        }

        uint256 permissionId = ++permissionsCount;

        Permission storage permissionData = _permissions[permissionId];
        permissionData.grantor = signer;
        permissionData.nonce = permissionInput.nonce;
        permissionData.granteeId = permissionInput.granteeId;
        permissionData.grant = permissionInput.grant;
        permissionData.signature = signature;
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

        grantHashToPermissionId[grantHash] = permissionId;

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

    function isActivePermission(uint256 permissionId) external view override returns (bool) {
        Permission storage permissionData = _permissions[permissionId];
        return block.number >= permissionData.startBlock && block.number < permissionData.endBlock;
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

        userData.revokedPermissionIds.add(permissionId);

        dataPortabilityGrantees.removePermissionFromGrantee(permissionData.granteeId, permissionId);

        emit PermissionRevoked(permissionId);
    }

    function filePermissionIds(uint256 fileId) external view override returns (uint256[] memory) {
        return _filePermissions[fileId].values();
    }

    function permissionFileIds(uint256 permissionId) external view override returns (uint256[] memory) {
        return _permissions[permissionId].fileIds.values();
    }

    function user(
        address userAddress
    )
        external
        view
        override
        returns (uint256 nonce, uint256[] memory permissionIds, uint256[] memory revokedPermissionIds)
    {
        User storage userData = _users[userAddress];
        return (userData.nonce, userData.permissionIds.values(), userData.revokedPermissionIds.values());
    }

    function filePermissions(uint256 fileId) external view override returns (uint256[] memory) {
        return _filePermissions[fileId].values();
    }
}
