// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../../../dlpTemplates/dlp/interfaces/IDataLiquidityPool.sol";
import "../../dataAccessTreasury/DataAccessTreasuryUpgradeable.sol";
import "./interfaces/VanaRuntimePermissionsStorageV1.sol";

contract VanaRuntimePermissionsImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    DataAccessTreasuryUpgradeable,
    VanaRuntimePermissionsStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;
    using Address for address payable;
    using SafeERC20 for IERC20;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant PGE_ROLE = keccak256("PGE_ROLE");
    bytes32 public constant SECURITY_COUSELOR_ROLE = keccak256("SECURITY_COUSELOR_ROLE");

    error NotDatasetOwner();
    error ExistingGenericPermission(uint256 dlpId, uint256 permissionId);
    error GenericPermissionNotFound(uint256 dlpId);
    error PermissionNotFound(uint256 permissionId);
    error RequestNotFound(uint256 requestId);
    error VanaRuntimeAlreadyAssigned(address vanaRuntime, uint256 requestId);
    error VanaRuntimeAssignedToDifferentGrantor(address vanaRuntime, address existingGrantor, address newGrantor);

    modifier onlyDatasetOwner(uint256 datasetId) {
        if (datasetRegistry.datasets(datasetId).owner != msg.sender) {
            revert NotDatasetOwner();
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
        IDatasetRegistry initDatasetRegistry,
        DataAccessTreasuryProxyFactory initDataAccessTreasuryFactory
    ) external initializer {
        __UUPSUpgradeable_init();
        __Pausable_init();
        __AccessControl_init();
        __DataAccessTreasuryUpgradeable_init(ownerAddress, initDataAccessTreasuryFactory);

        datasetRegistry = initDatasetRegistry;

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    function pause() external onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    /**
     * @notice Upgrade the contract
     * This function is required by OpenZeppelin's UUPSUpgradeable
     *
     * @param newImplementation                  new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function updateDatasetRegistry(IDatasetRegistry newDatasetRegistry) external onlyRole(MAINTAINER_ROLE) {
        datasetRegistry = newDatasetRegistry;
    }

    function addGenericPermission(
        uint256 datasetId,
        address tokenAddress,
        uint256 pricePerFile
    ) external whenNotPaused onlyDatasetOwner(datasetId) {
        if (_datasetGenericPermissions[datasetId] != 0) {
            revert ExistingGenericPermission(datasetId, _datasetGenericPermissions[datasetId]);
        }

        uint256 permissionId = ++permissionsCount;
        _permissions[permissionId] = Permission({
            id: permissionId,
            datasetId: datasetId,
            isGeneric: true,
            accessPredicate: "",
            tokenAddress: tokenAddress,
            pricePerFile: pricePerFile,
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });
        _datasetGenericPermissions[datasetId] = permissionId;
        emit PermissionAdded(permissionId, datasetId, "", tokenAddress, pricePerFile);
    }

    function updateGenericPermission(
        uint256 datasetId,
        address tokenAddress,
        uint256 pricePerFile
    ) external whenNotPaused onlyDatasetOwner(datasetId) {
        uint256 permissionId = _datasetGenericPermissions[datasetId];
        if (permissionId == 0) {
            revert GenericPermissionNotFound(datasetId);
        }

        Permission storage permission = _permissions[permissionId];
        permission.tokenAddress = tokenAddress;
        permission.pricePerFile = pricePerFile;
        permission.updatedAt = block.timestamp;

        emit GenericPermissionUpdated(permissionId, datasetId, permission.tokenAddress, pricePerFile);
    }

    function sendRequest(uint256 permissionId) external payable whenNotPaused {
        Permission storage permission = _permissions[permissionId];
        if (permission.id == 0) {
            revert PermissionNotFound(permissionId);
        }

        // Deposit the access fee
        if (permission.pricePerFile > 0) {
            uint256 fileIdsCount = datasetRegistry.datasets(permission.datasetId).fileIdsCount;
            uint256 totalPrice = permission.pricePerFile * fileIdsCount;
            _deposit(msg.sender, permission.tokenAddress, totalPrice);
        }

        uint256 requestId = ++requestsCount;
        Request storage request = _requests[requestId];
        request.id = requestId;
        request.permissionId = permissionId;
        request.requestor = msg.sender;
        request.requestedAt = block.timestamp;

        _datasetPermissions[permission.datasetId].add(requestId);

        emit RequestSent(requestId, permissionId, msg.sender);
    }

    function assignVanaRuntime(
        address vanaRuntime,
        uint256 requestId
    ) external whenNotPaused onlyRole(SECURITY_COUSELOR_ROLE) {
        Request storage request = _requests[requestId];
        if (request.id == 0) {
            revert RequestNotFound(requestId);
        }
        if (request.vanaRuntime != address(0)) {
            return; // Vana Runtime already assigned
        }
        
        // Check if VanaRuntime is already assigned to a different grantor
        address existingGrantor = _vanaRuntimeToGrantor[vanaRuntime];
        if (existingGrantor != address(0) && existingGrantor != request.requestor) {
            revert VanaRuntimeAssignedToDifferentGrantor(vanaRuntime, existingGrantor, request.requestor);
        }
        
        // Check if VanaRuntime is already assigned to another request
        uint256 assignedRequestId = _vanaRuntimeToRequest[vanaRuntime];
        if (assignedRequestId != 0 && assignedRequestId != requestId) {
            revert VanaRuntimeAlreadyAssigned(vanaRuntime, assignedRequestId);
        }

        request.vanaRuntime = vanaRuntime;
        _vanaRuntimeToRequest[vanaRuntime] = requestId;
        _vanaRuntimeToGrantor[vanaRuntime] = request.requestor;
        emit VanaRuntimeAssigned(vanaRuntime, requestId);
    }

    /// @notice The Vana Runtime revokes its assignment after completing its task.
    function revokeVanaRuntime() external whenNotPaused {
        uint256 requestId = _vanaRuntimeToRequest[msg.sender];
        if (requestId == 0) {
            return; // No assignment found
        }

        delete _vanaRuntimeToRequest[msg.sender];
        emit VanaRuntimeRevoked(msg.sender, requestId);
    }

    /// @notice PGE checks if the address requesting access under a requestId is the Vana Runtime assigned to that requestId.
    function isVanaRuntimeAssigned(address vanaRuntime, uint256 requestId) external view returns (bool) {
        return _vanaRuntimeToRequest[vanaRuntime] == requestId;
    }

    function grantAccess(uint256 requestId, string memory accessUrl, uint256 accessFilesCount) external whenNotPaused onlyRole(PGE_ROLE) {
        Request storage request = _requests[requestId];
        if (request.id == 0) {
            revert RequestNotFound(requestId);
        }
        if (request.accessGrantedAt != 0) {
            return; // Access already granted
        }

        Permission storage permission = _permissions[request.permissionId];
        
        // Deduct from requestor's deposited balance
        if (permission.pricePerFile > 0) {
            address requestor = request.requestor;
            address token = permission.tokenAddress;

            uint256 price = permission.pricePerFile * accessFilesCount;
            
            if (_accountBalances[requestor][token] < price) {
                revert InsufficientBalance();
            }
            
            unchecked {
                _accountBalances[requestor][token] -= price;
            }
            
            // Note: The funds remain in the treasury, they're just deducted from the requestor's balance
            // The dataset owner or protocol can claim these funds through a separate mechanism
        }

        request.accessGrantedAt = block.timestamp;
        request.accessUrl = accessUrl;

        emit AccessGranted(requestId, request.permissionId, request.requestor, accessUrl);
    }
}
