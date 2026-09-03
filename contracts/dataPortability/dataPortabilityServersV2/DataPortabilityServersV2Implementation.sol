// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/DataPortabilityServersV2StorageV1.sol";

/**
 * @title DataPortabilityServersV2Implementation
 * @notice Gateway-compatible server registry. See `IDataPortabilityServersV2`
 *         for the full contract surface and design rationale.
 */
contract DataPortabilityServersV2Implementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ERC2771ContextUpgradeable,
    EIP712Upgradeable,
    DataPortabilityServersV2StorageV1
{
    using ECDSA for bytes32;

    string private constant SIGNING_DOMAIN = "Vana Data Portability";
    string private constant SIGNATURE_VERSION = "1";

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    bytes32 public constant override SERVER_REGISTRATION_TYPEHASH =
        keccak256(
            "ServerRegistration(address ownerAddress,address serverAddress,string publicKey,string serverUrl)"
        );

    bytes32 public constant override SERVER_DEREGISTRATION_TYPEHASH =
        keccak256(
            "ServerDeregistration(address ownerAddress,address serverAddress,bytes32 serverId,uint256 deadline)"
        );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    function initialize(address trustedForwarderAddress, address ownerAddress) external initializer {
        if (ownerAddress == address(0)) revert ZeroAddress();

        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __EIP712_init(SIGNING_DOMAIN, SIGNATURE_VERSION);

        _trustedForwarder = trustedForwarderAddress;

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ====================== ERC-2771 plumbing ======================

    function _msgSender()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address)
    {
        return ERC2771ContextUpgradeable._msgSender();
    }

    function _msgData()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (bytes calldata)
    {
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

    function trustedForwarder()
        public
        view
        virtual
        override(ERC2771ContextUpgradeable, IDataPortabilityServersV2)
        returns (address)
    {
        return _trustedForwarder;
    }

    // ====================== Admin ======================

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function updateTrustedForwarder(address trustedForwarderAddress)
        external
        override
        onlyRole(MAINTAINER_ROLE)
    {
        _trustedForwarder = trustedForwarderAddress;
    }

    // ====================== Pure / view helpers ======================

    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    function domainSeparator() public view override returns (bytes32) {
        return _domainSeparatorV4();
    }

    function computeServerId(
        address serverAddress,
        string calldata publicKey,
        string calldata serverUrl
    ) external view override returns (bytes32) {
        return _computeServerId(serverAddress, publicKey, serverUrl);
    }

    // ====================== Views ======================

    function getServer(bytes32 serverId) external view override returns (ServerInfo memory) {
        Server storage s = _servers[serverId];
        if (s.registeredAtBlock == 0) revert ServerNotFound(serverId);
        return _toServerInfo(serverId, s);
    }

    function getActiveServerByAddress(address serverAddress)
        external
        view
        override
        returns (ServerInfo memory)
    {
        bytes32 sId = activeServerId[serverAddress];
        if (sId == bytes32(0)) revert ServerNotFound(bytes32(0));
        Server storage s = _servers[sId];
        return _toServerInfo(sId, s);
    }

    function ownerServers(address ownerAddress)
        external
        view
        override
        returns (ServerInfo[] memory)
    {
        bytes32[] storage ids = _ownerToServerIds[ownerAddress];
        uint256 len = ids.length;
        ServerInfo[] memory result = new ServerInfo[](len);
        for (uint256 i = 0; i < len; ) {
            bytes32 sId = ids[i];
            result[i] = _toServerInfo(sId, _servers[sId]);
            unchecked {
                ++i;
            }
        }
        return result;
    }

    // ====================== Writes ======================

    function registerServerWithSignature(
        ServerRegistration calldata input,
        bytes calldata signature
    ) external override whenNotPaused returns (bytes32 serverId) {
        if (input.ownerAddress == address(0) || input.serverAddress == address(0)) revert ZeroAddress();
        if (bytes(input.publicKey).length == 0) revert EmptyPublicKey();
        if (bytes(input.serverUrl).length == 0) revert EmptyUrl();
        if (activeServerId[input.serverAddress] != bytes32(0)) {
            revert ServerAlreadyRegistered(input.serverAddress);
        }

        // Verify owner's signature.
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SERVER_REGISTRATION_TYPEHASH,
                    input.ownerAddress,
                    input.serverAddress,
                    keccak256(bytes(input.publicKey)),
                    keccak256(bytes(input.serverUrl))
                )
            )
        );
        address signer = ECDSA.recover(digest, signature);
        if (signer == address(0)) revert InvalidSignature();
        if (signer != input.ownerAddress) revert OwnerMismatch(input.ownerAddress, signer);

        serverId = _computeServerId(input.serverAddress, input.publicKey, input.serverUrl);

        // The same `(serverAddress, publicKey, serverUrl)` could in principle
        // collide with a previously revoked registration. That's allowed — it
        // would just resurrect the same id. Reject explicitly so callers know.
        // (In practice this means the owner is re-registering an identical
        // server after revoke, which they probably don't want.)
        if (_servers[serverId].registeredAtBlock != 0) {
            revert ServerAlreadyRegistered(input.serverAddress);
        }

        Server storage s = _servers[serverId];
        s.ownerAddress = input.ownerAddress;
        s.serverAddress = input.serverAddress;
        s.publicKey = input.publicKey;
        s.serverUrl = input.serverUrl;
        s.registeredAtBlock = block.number;
        // s.revokedAtBlock = 0 by default

        activeServerId[input.serverAddress] = serverId;
        _ownerToServerIds[input.ownerAddress].push(serverId);
        unchecked {
            ++serversCount;
        }

        emit ServerRegistered(
            serverId,
            input.ownerAddress,
            input.serverAddress,
            input.publicKey,
            input.serverUrl
        );
    }

    function deregisterServerWithSignature(
        ServerDeregistration calldata input,
        bytes calldata signature
    ) external override whenNotPaused {
        if (block.timestamp > input.deadline) revert DeadlineExpired(input.deadline, block.timestamp);

        // Verify owner's signature.
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SERVER_DEREGISTRATION_TYPEHASH,
                    input.ownerAddress,
                    input.serverAddress,
                    input.serverId,
                    input.deadline
                )
            )
        );
        address signer = ECDSA.recover(digest, signature);
        if (signer == address(0)) revert InvalidSignature();
        if (signer != input.ownerAddress) revert OwnerMismatch(input.ownerAddress, signer);

        // The signed `serverId` must match the currently active registration
        // for this server address. This prevents a replayed deregistration sig
        // from revoking a future re-registration that reuses the address.
        bytes32 activeId = activeServerId[input.serverAddress];
        if (activeId == bytes32(0)) revert ServerNotFound(input.serverId);
        if (activeId != input.serverId) revert StaleServerId(activeId, input.serverId);

        Server storage s = _servers[input.serverId];
        if (s.revokedAtBlock != 0) revert AlreadyRevoked(input.serverId);
        if (s.ownerAddress != input.ownerAddress) {
            revert NotServerOwner(input.serverId, input.ownerAddress, s.ownerAddress);
        }

        s.revokedAtBlock = block.number;
        // Free the address so it can be re-registered with a different
        // (publicKey, serverUrl) producing a fresh serverId.
        activeServerId[input.serverAddress] = bytes32(0);

        emit ServerDeregistered(input.serverId, input.ownerAddress, input.serverAddress);
    }

    // ====================== Internals ======================

    function _computeServerId(
        address serverAddress,
        string memory publicKey,
        string memory serverUrl
    ) internal view returns (bytes32) {
        return keccak256(abi.encode(_domainSeparatorV4(), serverAddress, publicKey, serverUrl));
    }

    function _toServerInfo(bytes32 serverId, Server storage s) internal view returns (ServerInfo memory) {
        return
            ServerInfo({
                id: serverId,
                ownerAddress: s.ownerAddress,
                serverAddress: s.serverAddress,
                publicKey: s.publicKey,
                serverUrl: s.serverUrl,
                registeredAtBlock: s.registeredAtBlock,
                revokedAtBlock: s.revokedAtBlock
            });
    }
}
