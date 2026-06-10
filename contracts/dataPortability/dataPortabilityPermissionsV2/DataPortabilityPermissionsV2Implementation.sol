// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/DataPortabilityPermissionsV2StorageV1.sol";

/**
 * @title DataPortabilityPermissionsV2Implementation
 * @notice New-shape permission registry. UUPS upgradeable. Permissions are
 *         immutable after creation; expiry is enforced via `expiresAt`.
 */
contract DataPortabilityPermissionsV2Implementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    EIP712Upgradeable,
    DataPortabilityPermissionsV2StorageV1
{
    using ECDSA for bytes32;

    string private constant SIGNING_DOMAIN = "Vana Data Portability";
    string private constant SIGNATURE_VERSION = "1";

    bytes32 public constant override GRANT_REGISTRATION_TYPEHASH =
        keccak256(
            "GrantRegistration(address grantorAddress,bytes32 granteeId,string[] scopes,uint256 grantVersion,uint256 expiresAt)"
        );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address ownerAddress) external initializer {
        if (ownerAddress == address(0)) revert ZeroAddress();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __EIP712_init(SIGNING_DOMAIN, SIGNATURE_VERSION);

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    // ====================== Admin ======================

    function pause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setDataPortabilityServers(address newDataPortabilityServers)
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (newDataPortabilityServers == address(0)) revert ZeroAddress();
        address previous = address(dataPortabilityServers);
        dataPortabilityServers = IDataPortabilityServersV2(newDataPortabilityServers);
        emit DataPortabilityServersUpdated(previous, newDataPortabilityServers);
    }

    // ====================== Views ======================

    function permissions(bytes32 id) external view override returns (Permission memory) {
        return _permissions[id];
    }

    function isActive(bytes32 id) external view override returns (bool) {
        Permission storage p = _permissions[id];
        if (p.grantorAddress == address(0)) return false;
        if (p.expiresAt == 0) return true;
        return block.timestamp <= p.expiresAt;
    }

    function domainSeparator() public view override returns (bytes32) {
        return _domainSeparatorV4();
    }

    function grantId(address grantorAddress, bytes32 granteeId) public view override returns (bytes32) {
        return _computeGrantId(grantorAddress, granteeId);
    }

    // ====================== Registration ======================

    function addPermission(AddPermissionInput calldata input)
        external
        override
        whenNotPaused
        returns (bytes32)
    {
        if (input.grantorAddress != msg.sender) revert GrantorMismatch(input.grantorAddress, msg.sender);
        return _addPermission(input);
    }

    function addPermissionWithSignature(AddPermissionInput calldata input, bytes calldata signature)
        external
        override
        whenNotPaused
        returns (bytes32)
    {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    GRANT_REGISTRATION_TYPEHASH,
                    input.grantorAddress,
                    input.granteeId,
                    _hashScopes(input.scopes),
                    input.grantVersion,
                    input.expiresAt
                )
            )
        );

        address signer = ECDSA.recover(digest, signature);
        if (signer == address(0)) revert InvalidSignature();

        // Two accepted authorities, in order:
        //   1. Grantor self-signed — original V2 behavior.
        //   2. Delegate — a personal server currently registered to the grantor
        //      in `dataPortabilityServers`. Same trust model as
        //      DataRegistryV2.recordDataAccess: revocation in the servers
        //      registry immediately removes signing authority.
        // If the servers registry is unset, only path 1 is accepted; behavior
        // matches the pre-upgrade contract exactly.
        bool isGrantor = signer == input.grantorAddress;
        bool isDelegate = !isGrantor
            && address(dataPortabilityServers) != address(0)
            && _isTrustedServer(input.grantorAddress, signer);
        if (!isGrantor && !isDelegate) revert GrantorMismatch(input.grantorAddress, signer);

        // No nonce check here — `grantVersion` monotonicity in `_addPermission`
        // gives replay + rollback protection per (grantor, grantee) slot.
        bytes32 id = _addPermission(input);
        if (isDelegate) emit PermissionSignedByDelegate(id, input.grantorAddress, signer);
        return id;
    }

    // ====================== Internals ======================

    function _addPermission(AddPermissionInput calldata input) internal returns (bytes32) {
        if (input.grantorAddress == address(0)) revert ZeroAddress();
        if (input.granteeId == bytes32(0)) revert ZeroGranteeId();
        if (input.scopes.length == 0) revert EmptyScopes();
        // expiresAt == 0 is allowed and means perpetual.

        bytes32 id = _computeGrantId(input.grantorAddress, input.granteeId);
        Permission storage p = _permissions[id];

        // `grantVersion` acts as a per-grant monotonic nonce: every update must
        // be strictly larger than the stored value. First write has stored = 0,
        // so any input >= 1 passes. Prevents replay and rollback in one check.
        if (input.grantVersion <= p.grantVersion) {
            revert InvalidGrantVersion(p.grantVersion, input.grantVersion);
        }

        p.grantorAddress = input.grantorAddress;
        p.granteeId = input.granteeId;
        p.grantVersion = input.grantVersion;
        p.expiresAt = input.expiresAt;

        // Upsert: reset the existing scopes array before writing the new entries.
        delete p.scopes;
        uint256 sLen = input.scopes.length;
        for (uint256 i = 0; i < sLen; ) {
            p.scopes.push(input.scopes[i]);
            unchecked {
                ++i;
            }
        }

        emit PermissionSet(
            id,
            input.grantorAddress,
            input.granteeId,
            input.scopes,
            input.grantVersion,
            input.expiresAt
        );
        return id;
    }

    function _computeGrantId(address grantorAddress, bytes32 granteeId) internal view returns (bytes32) {
        return keccak256(abi.encode(domainSeparator(), grantorAddress, granteeId));
    }

    /// @dev Mirrors DataRegistryV2._isTrustedServer: a personal server is
    ///      currently trusted by `ownerAddress` iff it has an active (non-
    ///      revoked) registration whose stored owner matches. In V2 a server
    ///      address has at most one active owner at a time.
    function _isTrustedServer(address ownerAddress, address server) internal view returns (bool) {
        bytes32 sId = dataPortabilityServers.activeServerId(server);
        if (sId == bytes32(0)) return false;
        IDataPortabilityServersV2.ServerInfo memory info = dataPortabilityServers.getServer(sId);
        return info.ownerAddress == ownerAddress;
    }

    /// @dev Canonical EIP-712 hash of a `string[]`: hash each string, then
    ///      keccak256 the concatenation of those hashes.
    function _hashScopes(string[] calldata scopes) internal pure returns (bytes32) {
        uint256 len = scopes.length;
        bytes32[] memory hashes = new bytes32[](len);
        for (uint256 i = 0; i < len; ) {
            hashes[i] = keccak256(bytes(scopes[i]));
            unchecked {
                ++i;
            }
        }
        return keccak256(abi.encodePacked(hashes));
    }
}
