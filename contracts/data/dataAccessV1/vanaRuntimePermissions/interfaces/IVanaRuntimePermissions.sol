// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDatasetRegistry} from "../../datasetRegistry/interfaces/IDatasetRegistry.sol";

interface IVanaRuntimePermissions {
    event PermissionAdded(
        uint256 indexed permissionId,
        uint256 indexed datasetId,
        string accessPredicate,
        address tokenAddress,
        uint256 pricePerFile
    );
    event GenericPermissionUpdated(
        uint256 indexed permissionId,
        uint256 indexed datasetId,
        address tokenAddress,
        uint256 pricePerFile
    );
    event RequestSent(uint256 indexed requestId, uint256 indexed permissionId, address indexed requestor);
    event AccessGranted(uint256 indexed requestId, uint256 indexed permissionId, address indexed requestor, string accessUrl);
    event VanaRuntimeAssigned(address indexed vanaRuntime, uint256 indexed requestId);
    event VanaRuntimeRevoked(address indexed vanaRuntime, uint256 indexed requestId);

    struct Permission {
        uint256 id;
        uint256 datasetId;
        bool isGeneric; // If true, the permission is generic to access to any file in the dataset.
        string accessPredicate; // A predicate to define access conditions
        address tokenAddress; // The address of the token used for payment
        uint256 pricePerFile;
        uint256 createdAt;
        uint256 updatedAt;
    }

    struct Request {
        uint256 id;
        uint256 permissionId;
        address requestor;
        uint256 requestedAt;
        address vanaRuntime; // The Vana Runtime assigned to the request
        uint256 accessGrantedAt;
        string accessUrl; // URL to access the data, if access is granted
    }
}
