// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IDataRefinerRegistry} from "../../dataRefinerRegistry/interfaces/IDataRefinerRegistry.sol";
import "./IQueryEngine.sol";

/**
 * @title Storage for QueryEngine
 * @notice For future upgrades, do not change QueryEngineStorageV1.
 * Create a new contract which implements QueryEngineStorageV1
 */
abstract contract QueryEngineStorageV1 is IQueryEngine {
    uint256 public override permissionsCount;

    IDataRefinerRegistry public override refinerRegistry;
    IComputeEngine public override computeEngine;
    /// @notice The address of the VANA treasury that receives (1 - dlpPaymentPercentage) of the payment
    address public override vanaTreasury;
    /// @notice The address of the treasury that holds the payment
    IDataAccessTreasury public override queryEngineTreasury;

    /// @notice The percentage of the payment that goes to the DLP, in 1e18
    uint256 public override dlpPaymentPercentage;

    mapping(uint256 dlpId => mapping(address token => uint256 amount)) internal _dlpPayments;

    /// @notice A mapping of permission ids to permissions
    mapping(uint256 permissionId => Permission permission) internal _permissions;

    mapping(uint256 refinerId => mapping(address grantee => EnumerableSet.UintSet permissionIds))
        internal _approvedPermissions;

    mapping(uint256 dlpId => string pubKey) public override dlpPubKeys;
}
