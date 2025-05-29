// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IComputeEngineTeePool.sol";

/**
 * @title Storage for ComputeEngineTeePool
 * @notice For future upgrades, do not change ComputeEngineTeePoolStorageV1.
 * Create a new contract which implements ComputeEngineTeePoolStorageV1.
 */
abstract contract ComputeEngineTeePoolStorageV1 is IComputeEngineTeePool {
    /// @dev Packed storage layout to save on storage slots
    TeePoolType public override teePoolType; // 1 byte
    HardwareType public override hardwareType; // 1 byte
    uint80 public override maxTimeout; // 10 bytes
    address public override computeEngine; // 20 bytes

    EnumerableSet.AddressSet internal _teeList;
    EnumerableSet.AddressSet internal _activeTeeList;
    mapping(address teeAddress => Tee tee) internal _tees;

    uint256 internal _jobsCount;
    /// @dev Jobs are managed by the ComputeEngine contract, which is the job registry.
    /// The TeePool contract only keeps track of the Tee assigned to each job.
    mapping(uint256 => address) internal _jobTee;

    address public override teePoolFactory;
}
