// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IDLPRootCoreReadOnly} from "../../rootCore/interfaces/IDLPRootCore.sol";

interface IComputeInstructionRegistry {
    struct ComputeInstruction {
        bytes32 hash;
        address owner;
        string url;
        mapping(uint256 dlpId => bool approved) dlpApprovals;
    }

    struct ComputeInstructionInfo {
        bytes32 hash;
        address owner;
        string url;
    }

    /// @notice Pauses the contract
    function pause() external;

    /// @notice Unpauses the contract
    function unpause() external;

    /// @notice Returns the version of the contract
    function version() external pure returns (uint256);

    /// @notice Returns the DLPRootCore contract address.
    function dlpRootCore() external view returns (IDLPRootCoreReadOnly);

    /// @notice Updates the DLPRootCore contract address.
    /// @param dlpRootCoreAddress The address of the new DLPRootCore contract
    function updateDlpRootCore(address dlpRootCoreAddress) external;

    /// @notice Returns the number of compute instructions in the contract
    /// @return The number of compute instructions
    function instructionsCount() external view returns (uint256);

    /// @notice Returns the compute instruction for a given instruction ID
    /// @param instructionId The ID of the compute instruction
    /// @return The compute instruction info
    function instructions(uint256 instructionId) external view returns (ComputeInstructionInfo memory);

    /// @notice Returns the compute instruction's approval with the given ID
    /// @param instructionId The ID of the compute instruction
    /// @param refinerId The ID of the refiner
    /// @return Whether the compute instruction has been approved against the refiner
    function isApproved(uint256 instructionId, uint256 refinerId) external view returns (bool);

    /// @notice Adds a compute instruction to the registry
    /// @param hash The hash of the compute instruction
    /// @param url The URL of the compute instruction
    /// @return The ID of the compute instruction
    function addComputeInstruction(bytes32 hash, string calldata url) external returns (uint256);

    /// @notice Updates the compute instruction's approval with the given ID
    /// @param instructionId The ID of the compute instruction
    /// @param dlpId The ID of the DLP
    /// @param approved Whether the compute instruction has been approved against the refiner
    function updateComputeInstruction(uint256 instructionId, uint256 dlpId, bool approved) external;
}
