// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../dataAccessPayment/interfaces/IPaymentRequestor.sol";
import {IDataRefinerRegistry} from "../../dataRefinerRegistry/interfaces/IDataRefinerRegistry.sol";
import {IComputeEngine} from "../../computeEngine/interfaces/IComputeEngine.sol";
import {IDataAccessTreasury} from "../../dataAccessTreasury/interfaces/IDataAccessTreasury.sol";

interface IQueryEngine is IPaymentRequestor {
    /// @notice Permission struct for a single permission
    /// @param grantee The address of the grantee
    /// @param refinerId The id of the refiner/schema
    /// @param tableName The name of the table
    /// @param columnName The name of the column
    /// @param approved Whether the permission has been approved
    /// @param price The price of data access under the permission
    struct Permission {
        address grantee;
        bool approved;
        uint256 refinerId;
        string tableName;
        string columnName;
        uint256 price;
    }

    struct PermissionInfo {
        uint256 permissionId;
        address grantee;
        bool approved;
        uint256 refinerId;
        string tableName;
        string columnName;
        uint256 price;
    }

    /// @notice Pauses the contract
    function pause() external;

    /// @notice Unpauses the contract
    function unpause() external;

    /// @notice Returns the version of the contract
    function version() external pure returns (uint256);

    /// @notice Returns the refiner registry address
    /// @return refinerRegistry The address of the refiner registry
    function refinerRegistry() external view returns (IDataRefinerRegistry);

    /// @notice Updates the refiner registry address
    /// @param refinerRegistryAddress The address of the new refiner registry
    function updateRefinerRegistry(address refinerRegistryAddress) external;

    function computeEngine() external view returns (IComputeEngine);

    function updateComputeEngine(address computeEngineAddress) external;

    function dlpPaymentPercentage() external view returns (uint256);

    function updateDlpPaymentPercentage(uint256 dlpPaymentPercentage) external;

    function vanaTreasury() external view returns (address);

    function updateVanaTreasury(address vanaTreasury) external;

    function queryEngineTreasury() external view returns (IDataAccessTreasury);

    function updateQueryEngineTreasury(IDataAccessTreasury queryEngineTreasury) external;

    /// @notice Returns the permission for a given permission id
    /// @param permissionId The id of the permission
    /// @return permission The permission
    function permissions(uint256 permissionId) external view returns (Permission memory);

    /// @notice Returns the number of permissions in the contract
    /// @return permissionCount The number of permissions
    function permissionsCount() external view returns (uint256);

    /// @notice Returns the permissions for a grantee against a refiner
    /// @param refinerId The id of the refiner
    /// @param grantee The address of the grantee
    /// @return permissions The permissions
    function getPermissions(uint256 refinerId, address grantee) external view returns (PermissionInfo[] memory);

    /// @notice Adds a permission to the contract
    /// @param grantee The address of the grantee
    /// @param refinerId The id of the refiner
    /// @param tableName The name of the table
    /// @param columnName The name of the column
    /// @param price The price of data access under the permission
    /// @return permissionId The id of the permission
    function addPermission(
        address grantee,
        uint256 refinerId,
        string calldata tableName,
        string calldata columnName,
        uint256 price
    ) external returns (uint256 permissionId);

    /// @notice Adds a generic permission that is granted to everyone
    /// @param refinerId The id of the refiner
    /// @param tableName The name of the table
    /// @param columnName The name of the column
    /// @param price The price of data access under the permission
    /// @return permissionId The id of the permission
    function addGenericPermission(
        uint256 refinerId,
        string calldata tableName,
        string calldata columnName,
        uint256 price
    ) external returns (uint256 permissionId);

    /// @notice Updates the approval status of a permission
    /// @param permissionId The id of the permission
    /// @param approved The new approval status
    function updatePermissionApproval(uint256 permissionId, bool approved) external;

    function dlpPubKeys(uint256 dlpId) external view returns (string memory);
    function updateDlpPubKey(uint256 dlpId, string calldata pubKey) external;
}
