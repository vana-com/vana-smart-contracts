// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../../../data/dataRegistry/interfaces/IDataRegistry.sol";

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
        address grantor;
        uint256 nonce;
        string grant;
        bytes signature;
        bool isActive;
        EnumerableSet.UintSet fileIds;
    }

    struct PermissionInfo {
        uint256 id;
        address grantor;
        uint256 nonce;
        string grant;
        bytes signature;
        bool isActive;
        uint256[] fileIds;
    }

    struct Server {
        string url;
    }

    struct PermissionInput {
        uint256 nonce;
        string grant;
        uint256[] fileIds;
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
