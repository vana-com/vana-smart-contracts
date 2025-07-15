// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../../data/dataRegistry/interfaces/IDataRegistry.sol";

interface IDataPermissions {
    struct User {
        uint256 nonce;
        EnumerableSet.UintSet permissionIds;
        EnumerableSet.UintSet trustedServerIds;
        EnumerableSet.UintSet revokedPermissionIds;
    }

    struct Application {
        bytes publicKey;
        EnumerableSet.UintSet permissionIds;
    }

    struct ApplicationInfo {
        bytes publicKey;
        address derivedAddress;
        uint256[] permissionIds;
    }

    struct Permission {
        address grantor;
        uint256 nonce;
        uint256 applicationId;
        string grant;
        bytes signature;
        bool isActive;
        EnumerableSet.UintSet fileIds;
    }

    struct PermissionInfo {
        uint256 id;
        address grantor;
        uint256 nonce;
        uint256 applicationId;
        string grant;
        bytes signature;
        bool isActive;
        uint256[] fileIds;
    }

    struct Server {
        bytes publicKey;
        string url;
    }

    struct ServerInfo {
        bytes publicKey;
        address derivedAddress;
        string url;
    }

    struct PermissionInput {
        uint256 nonce;
        uint256 applicationId;
        string grant;
        uint256[] fileIds;
    }

    struct RevokePermissionInput {
        uint256 nonce;
        uint256 permissionId;
    }

    struct TrustServerInput {
        uint256 nonce;
        bytes serverPublicKey;
        string serverUrl;
    }

    struct UntrustServerInput {
        uint256 nonce;
        uint256 serverId;
    }

    struct RegisterApplicationInput {
        bytes publicKey;
    }

    struct RegisterServerInput {
        bytes publicKey;
        string url;
    }

    function version() external pure returns (uint256);
    function pause() external;
    function unpause() external;
}
