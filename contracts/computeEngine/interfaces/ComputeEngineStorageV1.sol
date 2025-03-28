// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IComputeEngine.sol";

/**`
 * @title Storage for ComputeEngine
 * @notice For future upgrades, do not change ComputeEngineStorageV1.
 * Create a new contract which implements ComputeEngineStorageV1
 */
abstract contract ComputeEngineStorageV1 is IComputeEngine {
    uint256 public override jobsCount;
    IComputeInstructionRegistry public override instructionRegistry;
    mapping(uint256 jobId => Job job) internal _jobs;

    IComputeEngineTeePoolFactory public override teePoolFactory;

    address public override queryEngine;
    IDataAccessTreasury public override computeEngineTreasury;
    mapping(uint256 jobId => mapping(address provider => PaymentInfo paymentInfo)) internal _jobPayments;
    mapping(address account => mapping(address token => uint256 balance)) internal _accountBalances;
}
