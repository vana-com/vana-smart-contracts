// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/DataPortabilityServersStorageV1.sol";

contract DataPortabilityServersImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    MulticallUpgradeable,
    ERC2771ContextUpgradeable,
    EIP712Upgradeable,
    DataPortabilityServersStorageV1
{
    using ECDSA for bytes32;
    using EnumerableSet for EnumerableSet.UintSet;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    string private constant SIGNING_DOMAIN = "VanaDataPortabilityServers";
    string private constant SIGNATURE_VERSION = "1";

    bytes32 private constant TRUST_SERVER_TYPEHASH = keccak256("TrustServer(uint256 nonce,uint256 serverId)");
    bytes32 private constant UNTRUST_SERVER_TYPEHASH = keccak256("UntrustServer(uint256 nonce,uint256 serverId)");
    bytes32 private constant ADD_AND_TRUST_SERVER_TYPEHASH =
        keccak256(
            "AddAndTrustServer(uint256 nonce,address owner,address serverAddress,bytes publicKey,string serverUrl)"
        );

    error InvalidNonce(uint256 expectedNonce, uint256 providedNonce);
    error EmptyUrl();
    error ZeroAddress();
    error EmptyPublicKey();
    error ServerUrlMismatch(string existingUrl, string providedUrl);
    error ServerNotFound();
    error ServerAlreadyRegistered();
    error ServerNotTrusted();
    error ServerAlreadyTrusted();
    error ServerAlreadyUntrusted();
    error NotServerOwner(address serverOwner, address requestor);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    function initialize(address trustedForwarderAddress, address ownerAddress) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __EIP712_init(SIGNING_DOMAIN, SIGNATURE_VERSION);

        _trustedForwarder = trustedForwarderAddress;

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
        override(ERC2771ContextUpgradeable, IDataPortabilityServers)
        returns (address)
    {
        return _trustedForwarder;
    }

    function updateTrustedForwarder(address trustedForwarderAddress) external override onlyRole(MAINTAINER_ROLE) {
        _trustedForwarder = trustedForwarderAddress;
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function updateServer(uint256 serverId, string memory url) external override whenNotPaused {
        if (bytes(url).length == 0) {
            revert EmptyUrl();
        }

        if (serverId == 0 || serverId > serversCount) {
            revert ServerNotFound();
        }

        Server storage serverData = _servers[serverId];
        if (serverData.owner != _msgSender()) {
            revert NotServerOwner(serverData.owner, _msgSender());
        }

        serverData.url = url;

        emit ServerUpdated(serverId, url);
    }

    function _extractSignerFromTrustServer(
        TrustServerInput calldata trustServerInput,
        bytes calldata signature
    ) internal view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(TRUST_SERVER_TYPEHASH, trustServerInput.nonce, trustServerInput.serverId)
        );

        return _extractSigner(structHash, signature);
    }

    function _extractSignerFromUntrustServer(
        UntrustServerInput calldata untrustServerInput,
        bytes calldata signature
    ) internal view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(UNTRUST_SERVER_TYPEHASH, untrustServerInput.nonce, untrustServerInput.serverId)
        );

        return _extractSigner(structHash, signature);
    }

    function _extractSignerFromAddAndTrustServer(
        AddAndTrustServerInput calldata addAndTrustServerInput,
        bytes calldata signature
    ) internal view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(
                ADD_AND_TRUST_SERVER_TYPEHASH,
                addAndTrustServerInput.nonce,
                addAndTrustServerInput.owner,
                addAndTrustServerInput.serverAddress,
                keccak256(addAndTrustServerInput.publicKey),
                keccak256(bytes(addAndTrustServerInput.serverUrl))
            )
        );

        return _extractSigner(structHash, signature);
    }

    function _extractSigner(bytes32 structHash, bytes calldata signature) internal view returns (address) {
        bytes32 digest = _hashTypedDataV4(structHash);
        return digest.recover(signature);
    }

    function _addServer(AddServerInput memory addServerInput) internal returns (uint256 serverId) {
        if (bytes(addServerInput.publicKey).length == 0) {
            revert EmptyPublicKey();
        }

        if (bytes(addServerInput.serverUrl).length == 0) {
            revert EmptyUrl();
        }

        if (addServerInput.owner == address(0)) {
            revert ZeroAddress();
        }

        if (addServerInput.serverAddress == address(0)) {
            revert ZeroAddress();
        }

        serverId = serverAddressToId[addServerInput.serverAddress];

        if (serverId != 0) {
            revert ServerAlreadyRegistered();
        }
        serverId = ++serversCount;

        Server storage serverData = _servers[serverId];
        serverData.owner = addServerInput.owner;
        serverData.serverAddress = addServerInput.serverAddress;
        serverData.publicKey = addServerInput.publicKey;
        serverData.url = addServerInput.serverUrl;

        serverAddressToId[addServerInput.serverAddress] = serverId;

        emit ServerRegistered(
            serverId,
            addServerInput.owner,
            addServerInput.serverAddress,
            addServerInput.publicKey,
            addServerInput.serverUrl
        );

        return serverId;
    }

    function _trustServer(uint256 serverId, address signer) internal {
        if (serverId == 0 || serverId > serversCount) {
            revert ServerNotFound();
        }

        User storage userData = _users[signer];

        // Check if server is already trusted and active
        if (userData.trustedServerIds.contains(serverId)) {
            TrustedServer storage trustedServer = userData.trustedServers[serverId];
            if (block.number <= trustedServer.endBlock) {
                revert ServerAlreadyTrusted();
            }
        }

        userData.trustedServerIds.add(serverId);
        userData.trustedServers[serverId] = TrustedServer({startBlock: block.number, endBlock: type(uint256).max});

        emit ServerTrusted(signer, serverId);
    }

    function addServer(AddServerInput memory addServerInput) external override whenNotPaused {
        _addServer(addServerInput);
    }

    function trustServer(uint256 serverId) external override whenNotPaused {
        _trustServer(serverId, _msgSender());
    }

    function trustServerWithSignature(
        TrustServerInput calldata trustServerInput,
        bytes calldata signature
    ) external override whenNotPaused {
        address signer = _extractSignerFromTrustServer(trustServerInput, signature);

        if (trustServerInput.nonce != _users[signer].nonce) {
            revert InvalidNonce(_users[signer].nonce, trustServerInput.nonce);
        }

        ++_users[signer].nonce;

        _trustServer(trustServerInput.serverId, signer);
    }

    function addAndTrustServerWithSignature(
        AddAndTrustServerInput calldata addAndTrustServerInput,
        bytes calldata signature
    ) external override whenNotPaused {
        address signer = _extractSignerFromAddAndTrustServer(addAndTrustServerInput, signature);

        if (addAndTrustServerInput.nonce != _users[signer].nonce) {
            revert InvalidNonce(_users[signer].nonce, addAndTrustServerInput.nonce);
        }

        ++_users[signer].nonce;

        uint256 serverId = _addServer(
            AddServerInput({
                owner: addAndTrustServerInput.owner,
                serverAddress: addAndTrustServerInput.serverAddress,
                publicKey: addAndTrustServerInput.publicKey,
                serverUrl: addAndTrustServerInput.serverUrl
            })
        );

        _trustServer(serverId, signer);
    }

    function addAndTrustServer(AddServerInput memory addAndTrustServerInput) external override whenNotPaused {
        uint256 serverId = _addServer(
            AddServerInput({
                owner: addAndTrustServerInput.owner,
                serverAddress: addAndTrustServerInput.serverAddress,
                publicKey: addAndTrustServerInput.publicKey,
                serverUrl: addAndTrustServerInput.serverUrl
            })
        );

        _trustServer(serverId, _msgSender());
    }

    function _untrustServer(uint256 serverId, address signer) internal {
        if (serverId == 0) {
            revert ServerNotFound();
        }

        User storage userData = _users[signer];

        if (!userData.trustedServerIds.contains(serverId)) {
            revert ServerNotTrusted();
        }

        // Check if server is already untrusted (endBlock is in the past)
        TrustedServer storage trustedServer = userData.trustedServers[serverId];
        if (block.number > trustedServer.endBlock) {
            revert ServerAlreadyUntrusted();
        }

        // Set end block to current block to deactivate the server for this user
        trustedServer.endBlock = block.number;

        emit ServerUntrusted(signer, serverId);
    }

    function untrustServer(uint256 serverId) external override whenNotPaused {
        _untrustServer(serverId, _msgSender());
    }

    function untrustServerWithSignature(
        UntrustServerInput calldata untrustServerInput,
        bytes calldata signature
    ) external override whenNotPaused {
        address signer = _extractSignerFromUntrustServer(untrustServerInput, signature);

        if (untrustServerInput.nonce != _users[signer].nonce) {
            revert InvalidNonce(_users[signer].nonce, untrustServerInput.nonce);
        }

        ++_users[signer].nonce;

        _untrustServer(untrustServerInput.serverId, signer);
    }

    function userServerIdsValues(address userAddress) external view override returns (uint256[] memory) {
        return _users[userAddress].trustedServerIds.values();
    }

    function userServerIdsAt(address userAddress, uint256 serverIndex) external view override returns (uint256) {
        return _users[userAddress].trustedServerIds.at(serverIndex);
    }

    function userServerIdsLength(address userAddress) external view override returns (uint256) {
        return _users[userAddress].trustedServerIds.length();
    }

    function isActiveServer(uint256 serverId) external view override returns (bool) {
        if (serverId == 0 || serverId > serversCount) {
            return false;
        }
        return true; // Server is active if it exists
    }

    function isActiveServerForUser(address userAddress, uint256 serverId) external view returns (bool) {
        if (!_users[userAddress].trustedServerIds.contains(serverId)) {
            return false;
        }
        TrustedServer storage trustedServer = _users[userAddress].trustedServers[serverId];
        return block.number >= trustedServer.startBlock && block.number < trustedServer.endBlock;
    }

    function servers(uint256 serverId) external view override returns (ServerInfo memory) {
        Server storage serverData = _servers[serverId];
        return
            ServerInfo({
                id: serverId,
                owner: serverData.owner,
                serverAddress: serverData.serverAddress,
                publicKey: serverData.publicKey,
                url: serverData.url
            });
    }

    function serverByAddress(address serverAddress) external view override returns (ServerInfo memory) {
        uint256 serverId = serverAddressToId[serverAddress];
        Server storage serverData = _servers[serverId];
        return
            ServerInfo({
                id: serverId,
                owner: serverData.owner,
                serverAddress: serverData.serverAddress,
                publicKey: serverData.publicKey,
                url: serverData.url
            });
    }

    // User data access functions
    function userNonce(address userAddress) external view override returns (uint256) {
        return _users[userAddress].nonce;
    }

    function users(
        address userAddress
    ) external view override returns (uint256 nonce, uint256[] memory trustedServerIds) {
        User storage userData = _users[userAddress];
        return (userData.nonce, userData.trustedServerIds.values());
    }

    // External functions for nonce management (to be called by main contract)
    function setUserNonce(address userAddress, uint256 nonce) external override onlyRole(MAINTAINER_ROLE) {
        _users[userAddress].nonce = nonce;
    }
}
