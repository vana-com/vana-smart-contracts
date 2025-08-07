// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDLPRegistry} from "../../../interfaces/IDLPRegistry.sol";

interface IVanaRuntimePermissions {
    event PermissionAdded(uint256 indexed permissionId, uint256 indexed dlpId, string criteria);

    struct Permission {
        uint256 id;
        uint256 dlpId; // If dlpId is 0, it means the permission not tied to a specific DLP.
        bool isGeneric; // If true, the permission is generic to access to any file in the DLP.
        string conditions;
        address tokenAddress; // The address of the token used for payment
        uint256 pricePerAccess;
        uint256 createdAt;
        uint256 updatedAt;
    }

    struct Request {
        uint256 id;
        uint256 permissionId;
        address requestor;
        uint256 requestedAt;
    }
}
