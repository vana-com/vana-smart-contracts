// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/DataPortabilityServersV2StorageV2.sol";

/**
 * @title DataPortabilityServersV2Implementation
 * @notice Gateway-compatible server registry. See `IDataPortabilityServersV2`
 *         for the full contract surface and design rationale.
 * @dev    No ERC-2771: registration and deregistration authenticate the
 *         EIP-712 signer, so a relayer already submits them on the owner's
 *         behalf, and every role-gated call authenticates the direct
 *         msg.sender. A rotatable trusted forwarder let MAINTAINER_ROLE
 *         append an admin's address to calldata and act as DEFAULT_ADMIN_ROLE
 *         (Hashlock 6th audit, M-01).
 */
contract DataPortabilityServersV2Implementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    EIP712Upgradeable,
    DataPortabilityServersV2StorageV2
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

    bytes32 public constant override SERVER_PROOF_TYPEHASH =
        keccak256(
            "ServerProof(address ownerAddress,address serverAddress,string publicKey,string serverUrl)"
        );

    bytes32 public constant override SERVER_SELF_DEREGISTRATION_TYPEHASH =
        keccak256(
            "ServerSelfDeregistration(address serverAddress,bytes32 serverId,uint256 registeredAtBlock,uint256 deadline)"
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
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    // ====================== Admin ======================

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function setRequireServerProof(bool required) external override onlyRole(MAINTAINER_ROLE) {
        requireServerProof = required;
        emit RequireServerProofUpdated(required);
    }

    // ====================== Pure / view helpers ======================

    function version() external pure virtual override returns (uint256) {
        return 2;
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
        // Skip ids the owner no longer holds: a reclaimed squat stays in the
        // squatter's list but now belongs to the operator.
        uint256 count;
        for (uint256 i = 0; i < len; ) {
            if (_servers[ids[i]].ownerAddress == ownerAddress) {
                unchecked {
                    ++count;
                }
            }
            unchecked {
                ++i;
            }
        }
        ServerInfo[] memory result = new ServerInfo[](count);
        uint256 j;
        for (uint256 i = 0; i < len; ) {
            bytes32 sId = ids[i];
            Server storage s = _servers[sId];
            if (s.ownerAddress == ownerAddress) {
                result[j] = _toServerInfo(sId, s);
                unchecked {
                    ++j;
                }
            }
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
        // An owner signature alone proves nothing about the server key, so it
        // lets anyone claim any serverAddress. Closed once relayers send proofs.
        if (requireServerProof) revert ServerProofRequired();
        _validateRegistration(input);
        _verifyOwnerSignature(input, signature);
        return _register(input, false);
    }

    function registerServerWithProof(
        ServerRegistration calldata input,
        bytes calldata ownerSignature,
        bytes calldata serverSignature
    ) external override whenNotPaused returns (bytes32 serverId) {
        _validateRegistration(input);
        _verifyOwnerSignature(input, ownerSignature);

        // Verify the server key's proof of possession.
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SERVER_PROOF_TYPEHASH,
                    input.ownerAddress,
                    input.serverAddress,
                    keccak256(bytes(input.publicKey)),
                    keccak256(bytes(input.serverUrl))
                )
            )
        );
        address signer = ECDSA.recover(digest, serverSignature);
        if (signer != input.serverAddress) revert ServerMismatch(input.serverAddress, signer);

        return _register(input, true);
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

    function deregisterServerByServer(
        ServerSelfDeregistration calldata input,
        bytes calldata signature
    ) external override {
        if (block.timestamp > input.deadline) revert DeadlineExpired(input.deadline, block.timestamp);

        // Verify the server key's signature.
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SERVER_SELF_DEREGISTRATION_TYPEHASH,
                    input.serverAddress,
                    input.serverId,
                    input.registeredAtBlock,
                    input.deadline
                )
            )
        );
        address signer = ECDSA.recover(digest, signature);
        if (signer != input.serverAddress) revert ServerMismatch(input.serverAddress, signer);

        // Bound to the active registration, so the signature cannot revoke a
        // later re-registration of the same address.
        bytes32 activeId = activeServerId[input.serverAddress];
        if (activeId == bytes32(0)) revert ServerNotFound(input.serverId);
        if (activeId != input.serverId) revert StaleServerId(activeId, input.serverId);

        // A reclaimed record reuses its serverId, so also bind to the
        // registration instance: an eviction signature for the squat cannot
        // revoke the operator's reclaimed record.
        Server storage s = _servers[input.serverId];
        if (s.registeredAtBlock != input.registeredAtBlock) {
            revert StaleRegistration(s.registeredAtBlock, input.registeredAtBlock);
        }
        s.revokedAtBlock = block.number;
        activeServerId[input.serverAddress] = bytes32(0);
        // The server never consented to an unproven record, so let a proven
        // registration reuse its tuple.
        if (!_provenServerIds[input.serverId]) _reclaimableServerIds[input.serverId] = true;

        emit ServerDeregistered(input.serverId, s.ownerAddress, input.serverAddress);
    }

    // ====================== Internals ======================

    function _validateRegistration(ServerRegistration calldata input) internal view {
        if (input.ownerAddress == address(0) || input.serverAddress == address(0)) revert ZeroAddress();
        if (bytes(input.publicKey).length == 0) revert EmptyPublicKey();
        if (bytes(input.serverUrl).length == 0) revert EmptyUrl();
        if (activeServerId[input.serverAddress] != bytes32(0)) {
            revert ServerAlreadyRegistered(input.serverAddress);
        }
    }

    function _verifyOwnerSignature(ServerRegistration calldata input, bytes calldata signature) internal view {
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
    }

    function _register(ServerRegistration calldata input, bool proven) internal returns (bytes32 serverId) {
        serverId = _computeServerId(input.serverAddress, input.publicKey, input.serverUrl);

        // The same `(serverAddress, publicKey, serverUrl)` produces the same id
        // as a previously revoked registration. Reject it, so a replayed
        // signature cannot resurrect a revoked server. The one exception is an
        // unproven record the server key itself revoked, reused with a proof
        // by a different owner (the squat case). The owner must differ, so the
        // previous owner's unused deregistration signatures, which bind to the
        // id and not the instance, fail `NotServerOwner` on the reused record.
        Server storage s = _servers[serverId];
        if (s.registeredAtBlock != 0) {
            if (!proven || !_reclaimableServerIds[serverId] || s.ownerAddress == input.ownerAddress) {
                revert ServerAlreadyRegistered(input.serverAddress);
            }
            delete _reclaimableServerIds[serverId];
        }

        s.ownerAddress = input.ownerAddress;
        s.serverAddress = input.serverAddress;
        s.publicKey = input.publicKey;
        s.serverUrl = input.serverUrl;
        s.registeredAtBlock = block.number;
        s.revokedAtBlock = 0;
        if (proven) _provenServerIds[serverId] = true;

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
