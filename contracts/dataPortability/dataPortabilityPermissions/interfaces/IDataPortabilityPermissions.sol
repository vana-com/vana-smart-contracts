// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../../../data/dataRegistry/interfaces/IDataRegistry.sol";
import "../../dataPortabilityServers/interfaces/IDataPortabilityServers.sol";
import "../../dataPortabilityGrantees/interfaces/IDataPortabilityGrantees.sol";

interface IDataPortabilityPermissions {
    struct User {
        uint256 nonce;
        EnumerableSet.UintSet permissionIds;
    }

    struct Permission {
        address grantor;
        uint256 nonce;
        uint256 granteeId;
        string grant;
        bytes signature;
        uint256 startBlock;
        uint256 endBlock;
        EnumerableSet.UintSet fileIds;
    }

    struct PermissionInfo {
        uint256 id;
        address grantor;
        uint256 nonce;
        uint256 granteeId;
        string grant;
        bytes signature;
        uint256 startBlock;
        uint256 endBlock;
        uint256[] fileIds;
    }

    struct PermissionInput {
        uint256 nonce;
        uint256 granteeId;
        string grant;
        uint256[] fileIds;
    }

    struct RevokePermissionInput {
        uint256 nonce;
        uint256 permissionId;
    }

    // Events
    event PermissionAdded(
        uint256 indexed permissionId,
        address indexed user,
        uint256 indexed granteeId,
        string grant,
        uint256[] fileIds
    );
    event PermissionRevoked(uint256 indexed permissionId);

    // Core functions
    function version() external pure returns (uint256);
    function pause() external;
    function unpause() external;

    // Public storage getters
    function trustedForwarder() external view returns (address);
    function permissionsCount() external view returns (uint256);
    function dataRegistry() external view returns (IDataRegistry);
    function dataPortabilityServers() external view returns (IDataPortabilityServers);
    function dataPortabilityGrantees() external view returns (IDataPortabilityGrantees);
    function users(address userAddress) external view returns (uint256 nonce, uint256[] memory permissionIds);
    function permissions(uint256 permissionId) external view returns (PermissionInfo memory);
    function filePermissions(uint256 fileId) external view returns (uint256[] memory);

    // Data Registry
    function updateDataRegistry(IDataRegistry newDataRegistry) external;

    // Trusted Forwarder
    function updateTrustedForwarder(address trustedForwarderAddress) external;

    // External contract references
    function updateServersContract(IDataPortabilityServers newServersContract) external;
    function updateGranteesContract(IDataPortabilityGrantees newGranteesContract) external;

    // Permission management
    function addPermission(PermissionInput calldata permission, bytes calldata signature) external returns (uint256);
    function isActivePermission(uint256 permissionId) external view returns (bool);
    function revokePermission(uint256 permissionId) external;
    function revokePermissionWithSignature(
        RevokePermissionInput calldata revokePermissionInput,
        bytes calldata signature
    ) external;
    function permissionFileIds(uint256 permissionId) external view returns (uint256[] memory);
    function filePermissionIds(uint256 fileId) external view returns (uint256[] memory);

    // User management
    function userNonce(address user) external view returns (uint256);
    function userPermissionIdsValues(address user) external view returns (uint256[] memory);
    function userPermissionIdsAt(address user, uint256 permissionIndex) external view returns (uint256);
    function userPermissionIdsLength(address user) external view returns (uint256);
}
