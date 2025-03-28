// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IComputeEngineTeePoolFactory.sol";

/**`
 * @title Storage for ComputeEngineTeePoolFactory
 * @notice For future upgrades, do not change ComputeEngineTeePoolFactoryStorageV1.
 * Create a new contract which implements ComputeEngineTeePoolFactoryStorageV1.
 */
abstract contract ComputeEngineTeePoolFactoryStorageV1 is IComputeEngineTeePoolFactory {
    uint80 public override ephemeralTimeout;
    uint80 public override persistentTimeout;
    ComputeEngineTeePoolFactoryBeacon public override teePoolFactoryBeacon;
    address public override computeEngine;
    mapping(bytes32 teePoolTypeId => IComputeEngineTeePool teePool) internal _teePools;
}
