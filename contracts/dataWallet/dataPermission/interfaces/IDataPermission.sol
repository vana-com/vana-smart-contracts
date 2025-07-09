// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

interface IDataPermission {
    struct User {
        uint256 nonce;
        EnumerableSet.UintSet permissionIds;
        EnumerableSet.AddressSet trustedServerIds;
        EnumerableSet.UintSet revokedPermissionIds;
    }

    struct Application {
        EnumerableSet.UintSet permissionIds;
    }

    struct Permission {
        address user;
        uint256 nonce;
        string grant;
        bytes signature;
        bool isActive;
    }

    struct Server {
        string url;
    }

    struct PermissionInput {
        uint256 nonce;
        string grant;
    }

    struct RevokePermissionInput {
        uint256 nonce;
        uint256 permissionId;
    }

    struct TrustServerInput {
        uint256 nonce;
        address serverId;
        string serverUrl;
    }

    struct UntrustServerInput {
        uint256 nonce;
        address serverId;
    }

    function version() external pure returns (uint256);
    function pause() external;
    function unpause() external;
}
