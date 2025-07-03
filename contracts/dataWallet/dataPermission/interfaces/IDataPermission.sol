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
        address application;
        uint256[] files;
        string operation;
        string prompt;
    }

    struct PermissionInput {
        address application;
        uint256[] files;
        string operation;
        string prompt;
        uint256 nonce;
    }

    function version() external pure returns (uint256);
    function pause() external;
    function unpause() external;
}
