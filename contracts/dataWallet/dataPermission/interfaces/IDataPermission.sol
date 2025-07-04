// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

interface IDataPermission {
    struct User {
        uint256 nonce;
        EnumerableSet.UintSet permissionIds;
    }

    struct Application {
        EnumerableSet.UintSet permissionIds;
    }

    struct Permission {
        address user;
        uint256 nonce;
        string grant;
        bytes signature;
    }

    struct PermissionInput {
        uint256 nonce;
        string grant;
    }

    function version() external pure returns (uint256);
    function pause() external;
    function unpause() external;
}
