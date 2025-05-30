// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IComputeInstructionRegistry.sol";
/**
 * @title Storage for ComputeInstructionRegistry
 * @notice For future upgrades, do not change ComputeInstructionRegistryStorageV1.
 * Create a new contract which implements ComputeInstructionRegistryStorageV1.
 */
abstract contract ComputeInstructionRegistryStorageV1 is IComputeInstructionRegistry {
    IDLPRegistry public override dlpRegistry;
    uint256 public override instructionsCount;

    mapping(uint256 instructionId => ComputeInstruction) internal _instructions;
}
