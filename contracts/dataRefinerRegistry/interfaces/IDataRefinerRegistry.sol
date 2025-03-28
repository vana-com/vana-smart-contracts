// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IDLPRootCoreReadOnly} from "../../rootCore/interfaces/IDLPRootCore.sol";

interface IDataRefinerRegistry {
    struct Refiner {
        uint256 dlpId;
        address owner;
        string name;
        string schemaDefinitionUrl;
        string refinementInstructionUrl;
        string publicKey;
    }

    /// @notice Returns the version of the contract.
    function version() external pure returns (uint256);
    
    /// @notice Pauses the contract.
    function pause() external;
    
    /// @notice Unpauses the contract.
    function unpause() external;

    /// @notice Returns the DLPRootCore contract address.
    function dlpRootCore() external view returns (IDLPRootCoreReadOnly);
    
    /// @notice Updates the DLPRootCore contract address.
    function updateDlpRootCore(address dlpRootCoreAddress) external;

    /// @notice Returns the number of refiners.
    function refinersCount() external view returns (uint256);
    
    /// @notice Returns the refiner with the given ID.
    /// @param refinerId The ID of the refiner.
    function refiners(uint256 refinerId) external view returns (Refiner memory);

    /// @notice Adds a refiner to the registry.
    /// @param dlpId The ID of the DLP.
    /// @param name The name of the refiner.
    /// @param schemaDefinitionUrl The URL of the schema definition.
    /// @param refinementInstructionUrl The URL of the refinement Docker image.
    /// @param publicKey The public key to encrypt the refined encryption key (REK).
    /// @return The ID of the refiner.
    function addRefiner(
        uint256 dlpId,
        string calldata name,
        string calldata schemaDefinitionUrl,
        string calldata refinementInstructionUrl,
        string calldata publicKey
    ) external returns (uint256);
}