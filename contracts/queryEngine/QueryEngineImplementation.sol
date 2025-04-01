// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDataRefinerRegistry} from "../dataRefinerRegistry/interfaces/IDataRefinerRegistry.sol";
import {IPaymentExecutor} from "../dataAccessPayment/interfaces/IPaymentExecutor.sol";
import {IDLPRootCoreReadOnly} from "../rootCore/interfaces/IDLPRootCore.sol";
import "../dataAccessTreasury/DataAccessTreasuryBeaconProxy.sol";
import "../dataAccessTreasury/DataAccessTreasuryImplementation.sol";
import "./interfaces/QueryEngineStorageV1.sol";

contract QueryEngineImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    QueryEngineStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;
    using Address for address payable;
    using SafeERC20 for IERC20;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant QUERY_ENGINE_ROLE = keccak256("QUERY_ENGINE_ROLE");

    address public constant VANA = address(0);

    uint256 public constant ONE_HUNDRED_PERCENT = 100e18;

    event PermissionAdded(
        uint256 indexed permissionId,
        address indexed grantee,
        uint256 indexed refinerId,
        string tableName,
        string columnName,
        uint256 price
    );

    event PermissionApprovalUpdated(uint256 indexed permissionId, bool approved);
    event PaymentReceived(address indexed token, uint256 amount, uint256 jobId, uint256 refinerId);
    event DlpPaymentClaimed(
        uint256 indexed dlpId,
        address indexed dlpTreasuryAddress,
        address indexed token,
        uint256 amount
    );
    error NotRefinerOwner();
    error PermissionNotFound();
    error PaymentNotReceived();
    error InvalidDlpPaymentPercentage();
    error InvalidDlpTreasuryAddress();
    error NotDlpOwner();
    error ColumnNameUnexpected();
    error RefinerNotFound();

    /// @notice Reverts if the caller is not the owner of the refiner
    /// @param refinerId The ID of the refiner
    modifier onlyRefinerOwner(uint256 refinerId) {
        if (refinerRegistry.refiners(refinerId).owner != msg.sender) {
            revert NotRefinerOwner();
        }
        _;
    }

    receive() external payable {}

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
        address refinerRegistryAddress,
        address dataAccessTreasuryFactory
    ) external initializer {
        __UUPSUpgradeable_init();
        __Pausable_init();
        __AccessControl_init();
        __ReentrancyGuard_init();

        refinerRegistry = IDataRefinerRegistry(refinerRegistryAddress);

        /// @dev Deploy a new data access treasury for the query engine via beacon proxy
        DataAccessTreasuryFactoryBeacon factoryBeacon = DataAccessTreasuryFactoryBeacon(dataAccessTreasuryFactory);
        address impl = factoryBeacon.implementation();
        address proxy = factoryBeacon.createBeaconProxy(
            abi.encodeCall(DataAccessTreasuryImplementation(payable(impl)).initialize, (ownerAddress, address(this)))
        );
        queryEngineTreasury = IDataAccessTreasury(proxy);

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(QUERY_ENGINE_ROLE, DEFAULT_ADMIN_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    /**
     * @notice Upgrades the contract
     * This function is required by OpenZeppelin's UUPSUpgradeable
     *
     * @param newImplementation New implementation
     */
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function updateRefinerRegistry(address refinerRegistryAddress) external override onlyRole(MAINTAINER_ROLE) {
        refinerRegistry = IDataRefinerRegistry(refinerRegistryAddress);
    }

    function updateComputeEngine(address computeEngineAddress) external override onlyRole(MAINTAINER_ROLE) {
        computeEngine = IComputeEngine(computeEngineAddress);
    }

    function updateDlpPaymentPercentage(uint256 _dlpPaymentPercentage) external override onlyRole(MAINTAINER_ROLE) {
        if (_dlpPaymentPercentage > ONE_HUNDRED_PERCENT) {
            revert InvalidDlpPaymentPercentage();
        }
        dlpPaymentPercentage = _dlpPaymentPercentage;
    }

    function updateVanaTreasury(address _vanaTreasury) external override onlyRole(MAINTAINER_ROLE) {
        vanaTreasury = _vanaTreasury;
    }

    function updateQueryEngineTreasury(
        IDataAccessTreasury _queryEngineTreasury
    ) external override onlyRole(MAINTAINER_ROLE) {
        queryEngineTreasury = _queryEngineTreasury;
    }

    /// @inheritdoc IQueryEngine
    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    /// @inheritdoc IQueryEngine
    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    /// @inheritdoc IQueryEngine
    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    ///////////////////////
    ///// Permissions /////
    ///////////////////////

    /// @inheritdoc IQueryEngine
    function permissions(uint256 permissionId) external view override returns (Permission memory) {
        return _permissions[permissionId];
    }

    /// @inheritdoc IQueryEngine
    function addPermission(
        address grantee,
        uint256 refinerId,
        string calldata tableName,
        string calldata columnName,
        uint256 price
    ) external override returns (uint256 permissionId) {
        return _addPermission(grantee, refinerId, tableName, columnName, price);
    }

    /// @inheritdoc IQueryEngine
    function addGenericPermission(
        uint256 refinerId,
        string calldata tableName,
        string calldata columnName,
        uint256 price
    ) external override returns (uint256 permissionId) {
        return _addPermission(address(0), refinerId, tableName, columnName, price);
    }

    /// @notice Adds a permission to the contract
    /// @param grantee The address of the grantee. If the address is 0, the permission is granted to everyone
    /// @param refinerId The id of the refiner
    /// @param tableName The name of the table
    /// @param columnName The name of the column
    /// @param price The price of data access under the permission
    /// @return permissionId The id of the permission
    function _addPermission(
        address grantee,
        uint256 refinerId,
        string calldata tableName,
        string calldata columnName,
        uint256 price
    ) internal onlyRefinerOwner(refinerId) whenNotPaused returns (uint256 permissionId) {
        if (bytes(tableName).length == 0 && bytes(columnName).length > 0) {
            revert ColumnNameUnexpected();
        }

        permissionId = ++permissionsCount;

        Permission storage permission = _permissions[permissionId];
        permission.grantee = grantee;
        permission.refinerId = refinerId;
        permission.tableName = tableName;
        permission.columnName = columnName;
        permission.approved = true;
        permission.price = price;

        _approvedPermissions[refinerId][grantee].add(permissionId);

        emit PermissionAdded(permissionId, grantee, refinerId, tableName, columnName, price);
    }

    /// @inheritdoc IQueryEngine
    function updatePermissionApproval(uint256 permissionId, bool approved) external override {
        // Validate 1-indexed permissionId
        if (permissionId == 0 || permissionId > permissionsCount) {
            revert PermissionNotFound();
        }

        Permission storage permission = _permissions[permissionId];

        // Check ownership
        uint256 refinerId = permission.refinerId;
        if (refinerRegistry.refiners(refinerId).owner != msg.sender) {
            revert NotRefinerOwner();
        }

        // Early return if no state change needed
        if (permission.approved == approved) {
            return;
        }
        // Update storage
        permission.approved = approved;

        // Update approved permissions set
        EnumerableSet.UintSet storage approvedSet = _approvedPermissions[refinerId][permission.grantee];
        if (approved) {
            approvedSet.add(permissionId);
        } else {
            approvedSet.remove(permissionId);
        }

        emit PermissionApprovalUpdated(permissionId, approved);
    }

    /// @inheritdoc IQueryEngine
    function getPermissions(uint256 refinerId, address grantee) external view returns (PermissionInfo[] memory) {
        // Get permission sets from storage
        EnumerableSet.UintSet storage specificPermissionIds = _approvedPermissions[refinerId][grantee];
        EnumerableSet.UintSet storage genericPermissionIds = _approvedPermissions[refinerId][address(0)];

        // Calculate total length with overflow checks
        uint256 genericLength = genericPermissionIds.length();
        uint256 specificLength = (grantee != address(0)) ? specificPermissionIds.length() : 0;
        uint256 totalLength = genericLength + specificLength;

        // Create result array
        PermissionInfo[] memory grantedPermissions = new PermissionInfo[](totalLength);

        // Populate result array
        uint256 index;

        // Add generic permissions
        for (uint256 i = 0; i < genericLength; ) {
            uint256 permissionId = genericPermissionIds.at(i);
            Permission storage permission = _permissions[permissionId];
            grantedPermissions[index] = PermissionInfo({
                permissionId: permissionId,
                grantee: permission.grantee,
                approved: permission.approved,
                refinerId: permission.refinerId,
                tableName: permission.tableName,
                columnName: permission.columnName,
                price: permission.price
            });
            unchecked {
                ++i;
                ++index;
            }
        }

        // Add specific permissions
        for (uint256 i = 0; i < specificLength; ) {
            uint256 permissionId = specificPermissionIds.at(i);
            Permission memory permission = _permissions[permissionId];
            grantedPermissions[index] = PermissionInfo({
                permissionId: permissionId,
                grantee: permission.grantee,
                approved: permission.approved,
                refinerId: permission.refinerId,
                tableName: permission.tableName,
                columnName: permission.columnName,
                price: permission.price
            });
            unchecked {
                ++i;
                ++index;
            }
        }

        return grantedPermissions;
    }

    ///////////////////////
    ///// Payments ////////
    ///////////////////////

    function requestPaymentInVana(
        uint256 amount,
        uint256 jobId,
        uint256 refinerId
    ) external onlyRole(QUERY_ENGINE_ROLE) nonReentrant {
        bytes memory metadata = abi.encode(jobId, refinerId);
        _requestPayment(VANA, amount, metadata);
    }

    function requestPayment(
        address token,
        uint256 amount,
        bytes memory metadata
    ) external onlyRole(QUERY_ENGINE_ROLE) nonReentrant {
        _requestPayment(token, amount, metadata);
    }

    function _requestPayment(address token, uint256 amount, bytes memory metadata) internal {
        (uint256 jobId, uint256 refinerId) = abi.decode(metadata, (uint256, uint256));

        uint256 dlpId = refinerRegistry.refiners(refinerId).dlpId;
        if (dlpId == 0) {
            revert RefinerNotFound();
        }

        bool isVana = token == VANA;
        // Store initial balance for verification
        uint256 initialBalance = isVana ? address(this).balance : IERC20(token).balanceOf(address(this));

        // Request payment from compute engine
        IPaymentExecutor(computeEngine).executePaymentRequest(token, amount, abi.encode(jobId));

        // Verify payment was received
        uint256 finalBalance = isVana ? address(this).balance : IERC20(token).balanceOf(address(this));
        uint256 receivedAmount = finalBalance - initialBalance;

        if (receivedAmount < amount) {
            revert PaymentNotReceived();
        }

        emit PaymentReceived(token, receivedAmount, jobId, refinerId);

        uint256 dlpPaymentAmount = (amount * dlpPaymentPercentage) / ONE_HUNDRED_PERCENT;
        uint256 vanaPaymentAmount = receivedAmount - dlpPaymentAmount;

        /// @dev Transfer the DLP payment portion to the treasury to be distributed to the DLP treasury
        if (isVana) {
            payable(address(queryEngineTreasury)).sendValue(dlpPaymentAmount);
            payable(vanaTreasury).sendValue(vanaPaymentAmount);
        } else {
            IERC20(token).safeTransfer(address(queryEngineTreasury), dlpPaymentAmount);
            IERC20(token).safeTransfer(vanaTreasury, vanaPaymentAmount);
        }

        /// @dev Store the payment for the DLP treasury to be claimed by the DLP later.
        /// @dev This prevents errors when transferring funds to the DLP treasury disrupts the payment flow.
        _dlpPayments[dlpId][token] += dlpPaymentAmount;
    }

    function claimDlpPayment(uint256 dlpId, address token) external whenNotPaused nonReentrant {
        IDLPRootCoreReadOnly.DlpInfo memory dlp = refinerRegistry.dlpRootCore().dlps(dlpId);
        if (dlp.ownerAddress != msg.sender) {
            revert NotDlpOwner();
        }
        address dlpTreasuryAddress = dlp.treasuryAddress;
        if (dlpTreasuryAddress == address(0)) {
            revert InvalidDlpTreasuryAddress();
        }

        uint256 amount = _dlpPayments[dlpId][token];
        _dlpPayments[dlpId][token] = 0;

        emit DlpPaymentClaimed(dlpId, dlpTreasuryAddress, token, amount);

        queryEngineTreasury.transfer(dlpTreasuryAddress, token, amount);
    }

    function balanceOf(uint256 dlpId, address token) external view returns (uint256) {
        return _dlpPayments[dlpId][token];
    }
}
