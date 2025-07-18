// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../../../data/dataRegistry/interfaces/IDataRegistry.sol";

interface IDataPortabilityServers {
    struct User {
        uint256 nonce;
        mapping(uint256 serverId => TrustedServer trustedServer) trustedServers;
        EnumerableSet.UintSet trustedServerIds;
    }

    struct Server {
        address owner;
        address serverAddress;
        bytes publicKey;
        string url;
    }

    struct TrustedServer {
        uint256 startBlock;
        uint256 endBlock;
    }

    struct ServerInfo {
        uint256 id;
        address owner;
        address serverAddress;
        bytes publicKey;
        string url;
    }

    struct TrustedServerInfo {
        address user;
        address owner;
        address serverAddress;
        bytes publicKey;
        string url;
        uint256 startBlock;
        uint256 endBlock;
    }

    struct AndServerInput {
        address owner;
        address serverAddress;
        bytes publicKey;
        string serverUrl;
    }

    struct AddAndTrustServerInput {
        uint256 nonce;
        address owner;
        address serverAddress;
        bytes publicKey;
        string serverUrl;
    }

    struct TrustServerInput {
        uint256 nonce;
        uint256 serverId;
    }

    struct UntrustServerInput {
        uint256 nonce;
        uint256 serverId;
    }

    // Events
    event ServerRegistered(
        uint256 indexed serverId,
        address indexed owner,
        address indexed serverAddress,
        bytes publicKey,
        string url
    );
    event ServerUpdated(uint256 indexed serverId, string url);
    event ServerTrusted(address indexed user, uint256 indexed serverId);
    event ServerUntrusted(address indexed user, uint256 indexed serverId);

    // Server management functions
    function addServer(AndServerInput memory addServerInput) external;
    function updateServer(uint256 serverId, string memory url) external;
    function trustServer(uint256 serverId) external;
    function trustServerWithSignature(TrustServerInput calldata trustServerInput, bytes calldata signature) external;
    function addAndTrustServer(AndServerInput memory addAndTrustServerInput) external;
    function addAndTrustServerWithSignature(
        AddAndTrustServerInput calldata addAndTrustServerInput,
        bytes calldata signature
    ) external;
    function untrustServer(uint256 serverId) external;
    function untrustServerWithSignature(
        UntrustServerInput calldata untrustServerInput,
        bytes calldata signature
    ) external;

    // View functions
    function isActiveServer(uint256 serverId) external view returns (bool);
    function isActiveServerForUser(address userAddress, uint256 serverId) external view returns (bool);
    function serverByAddress(address serverAddress) external view returns (ServerInfo memory);
    function userServerIdsValues(address user) external view returns (uint256[] memory);
    function userServerIdsAt(address user, uint256 serverIndex) external view returns (uint256);
    function userServerIdsLength(address user) external view returns (uint256);

    // Public storage getters
    function trustedForwarder() external view returns (address);
    function serversCount() external view returns (uint256);
    function serverAddressToId(address serverAddress) external view returns (uint256);
    function server(uint256 serverId) external view returns (ServerInfo memory);
    function user(address userAddress) external view returns (uint256 nonce, uint256[] memory trustedServerIds);

    // User management functions
    function userNonce(address user) external view returns (uint256);
    function setUserNonce(address user, uint256 nonce) external;

    // Admin functions
    function updateTrustedForwarder(address trustedForwarderAddress) external;
    function pause() external;
    function unpause() external;
}
