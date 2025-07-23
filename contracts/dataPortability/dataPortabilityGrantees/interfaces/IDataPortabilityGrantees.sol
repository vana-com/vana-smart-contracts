// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

interface IDataPortabilityGrantees {
    struct Grantee {
        address owner;
        address granteeAddress;
        string publicKey;
        EnumerableSet.UintSet permissionIds;
    }

    struct GranteeInfo {
        address owner;
        address granteeAddress;
        string publicKey;
        uint256[] permissionIds;
    }

    // Events
    event GranteeRegistered(
        uint256 indexed granteeId,
        address indexed owner,
        address indexed granteeAddress,
        string publicKey
    );

    // Public storage getters
    function trustedForwarder() external view returns (address);
    function granteesCount() external view returns (uint256);
    function granteeAddressToId(address granteeAddress) external view returns (uint256);
    function grantees(uint256 granteeId) external view returns (GranteeInfo memory);
    function granteePermissions(uint256 granteeId) external view returns (uint256[] memory);
    
    // Grantee management functions
    function registerGrantee(
        address owner,
        address granteeAddress,
        string memory publicKey
    ) external returns (uint256);

    // View functions
    function granteeInfo(uint256 granteeId) external view returns (GranteeInfo memory);
    function granteeByAddress(address granteeAddress) external view returns (GranteeInfo memory);
    function granteePermissionIds(uint256 granteeId) external view returns (uint256[] memory);

    // Permission management functions (to be called by main contract)
    function addPermissionToGrantee(uint256 granteeId, uint256 permissionId) external;
    function removePermissionFromGrantee(uint256 granteeId, uint256 permissionId) external;
    
    // Admin functions
    function updateTrustedForwarder(address trustedForwarderAddress) external;
    function pause() external;
    function unpause() external;
}