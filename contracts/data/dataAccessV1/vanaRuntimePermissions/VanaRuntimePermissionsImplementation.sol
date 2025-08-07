// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../../dlpTemplates/dlp/interfaces/IDataLiquidityPool.sol";
import "./interfaces/VanaRuntimePermissionsStorageV1.sol";

contract VanaRuntimePermissionsImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    VanaRuntimePermissionsStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;
    using Address for address payable;
    using SafeERC20 for IERC20;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    address public constant VANA = address(0);

    error NotDlpOwner();
    error ExistingGenericPermission(uint256 dlpId, uint256 permissionId);
    error GenericPermissionNotFound(uint256 dlpId);
    error PermissionNotFound(uint256 permissionId);

    modifier onlyDlpOwner(uint256 dlpId) {
        if (dlpRegistry.dlps(dlpId).ownerAddress != msg.sender) {
            revert NotDlpOwner();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract
     *
     * @param ownerAddress Address of the owner
     */
    function initialize(
        address ownerAddress,
        IDLPRegistry initDlpRegistry
    ) external initializer {
        __UUPSUpgradeable_init();
        __Pausable_init();
        __AccessControl_init();

        dlpRegistry = initDlpRegistry;

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    /**
     * @notice Upgrade the contract
     * This function is required by OpenZeppelin's UUPSUpgradeable
     *
     * @param newImplementation                  new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function updateDlpRegistry(IDLPRegistry newDlpRegistry) external onlyRole(MAINTAINER_ROLE) {
        dlpRegistry = newDlpRegistry;
    }

    function addGenericPermission(uint256 dlpId, address tokenAddress, uint256 pricePerAccess) external onlyDlpOwner(dlpId) {
        if (_dlpGenericPermissions[dlpId] != 0) {
            revert ExistingGenericPermission(dlpId, _dlpGenericPermissions[dlpId]);
        }

        uint256 permissionId = ++permissionsCount;
        _permissions[permissionId] = Permission({
            id: permissionId,
            dlpId: dlpId,
            isGeneric: true,
            conditions: "",
            tokenAddress: tokenAddress,
            pricePerAccess: pricePerAccess,
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });
        _dlpGenericPermissions[dlpId] = permissionId;
        emit PermissionAdded(permissionId, dlpId, "");
    }

    function updateGenericPermission(
        uint256 dlpId,
        uint256 pricePerAccess
    ) external onlyDlpOwner(dlpId) {
        uint256 permissionId = _dlpGenericPermissions[dlpId];
        if (permissionId == 0) {
            revert GenericPermissionNotFound(dlpId);
        }

        Permission storage permission = _permissions[permissionId];
        permission.pricePerAccess = pricePerAccess;
        permission.updatedAt = block.timestamp;

        emit PermissionAdded(permissionId, dlpId, "");
    }

    function sendRequest(uint256 permissionId) public {
        Permission storage permission = _permissions[permissionId];
        if (permission.id == 0) {
            revert PermissionNotFound(permissionId);
        }

        uint256 requestId = ++requestsCount;
        _requests[requestId] = Request({
            id: requestId,
            permissionId: permissionId,
            requestor: msg.sender,
            requestedAt: block.timestamp
        });
        _dlpPermissions[permission.dlpId].add(requestId);
    }

    function sendGenericRequestByDlp(uint256 dlpId) external {
        uint256 permissionId = _dlpGenericPermissions[dlpId];
        if (permissionId == 0) {
            revert GenericPermissionNotFound(dlpId);
        }
        sendRequest(permissionId);
    }

    function _checkFileDlp(uint256 fileId, uint256 dlpId) internal view returns (bool) {
        IDLPRegistry.DlpInfo memory dlpInfo = dlpRegistry.dlps(dlpId);
        if (dlpInfo.dlpAddress == address(0)) {
            return false; // DLP not found
        }
        IDataLiquidityPool dlp = IDataLiquidityPool(dlpInfo.dlpAddress);
        return dlp.files(fileId).timestamp != 0; // Check if file exists in the DLP
    }

    function _checkPermission(uint256 fileId, uint256 requestId) internal view returns (bool) {
        Request storage request = _requests[requestId];
        if (request.id == 0 || request.permissionId == 0) {
            return false; // Invalid request
        }

        Permission storage permission = _permissions[request.permissionId];
        uint256 dlpId = permission.dlpId;
        if (dlpId == 0) {
            return false; // The permission not tied to a specific DLP
        }
        if (!_checkFileDlp(fileId, dlpId)) {
            return false; // File not found in the DLP
        }
        // If the permission is generic, it allows access to any file in the DLP
        return permission.isGeneric;
    }

    function checkPermissionWithPayment(
        uint256 fileId,
        uint256 requestId
    ) external payable returns (bool) {
        if (!_checkPermission(fileId, requestId)) {
            return false; // Permission check failed
        }

        Request storage request = _requests[requestId];
        Permission storage permission = _permissions[request.permissionId];

        // Check if the payment is sufficient
        if (permission.tokenAddress == VANA) {
            require(msg.value >= permission.pricePerAccess, "Insufficient payment");
        } else {
            IERC20 token = IERC20(permission.tokenAddress);
            require(token.transferFrom(msg.sender, address(this), permission.pricePerAccess), "Payment transfer failed");
        }
        // Process the payment logic here (e.g., transfer to DLP owner)
        // ...

        return true; // Permission granted with payment
    }
}