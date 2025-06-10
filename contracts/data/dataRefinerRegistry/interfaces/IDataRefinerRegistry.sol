// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IDLPRegistry} from "../../interfaces/IDLPRegistry.sol";

interface IDataRefinerRegistry {
    struct Refiner {
        uint256 dlpId;
        address owner;
        string name;
        string schemaDefinitionUrl;
        string refinementInstructionUrl;
        string publicKey; // Obsolete, kept for backward compatibility
    }

    struct RefinerInfo {
        uint256 dlpId;
        address owner;
        string name;
        string schemaDefinitionUrl;
        string refinementInstructionUrl;
    }

    /// @notice Returns the version of the contract.
    function version() external pure returns (uint256);

    /// @notice Pauses the contract.
    function pause() external;

    /// @notice Unpauses the contract.
    function unpause() external;

    /// @notice Returns the DLPRegistry contract address.
    function dlpRegistry() external view returns (IDLPRegistry);

    /// @notice Updates the DLPRegistry contract address.
    function updateDlpRegistry(address dlpRegistryAddress) external;

    /// @notice Returns the number of refiners.
    function refinersCount() external view returns (uint256);

    /// @notice Returns the refiner with the given ID.
    /// @param refinerId The ID of the refiner.
    function refiners(uint256 refinerId) external view returns (RefinerInfo memory);

    /// @notice Returns the refiner IDs for a given DLP ID.
    /// @param dlpId The ID of the DLP.
    /// @return An array of refiner IDs.
    function dlpRefiners(uint256 dlpId) external view returns (uint256[] memory);

    /// @notice Adds a refiner to the registry.
    /// @param dlpId The ID of the DLP.
    /// @param name The name of the refiner.
    /// @param schemaDefinitionUrl The URL of the schema definition.
    /// @param refinementInstructionUrl The URL of the refinement Docker image.
    /// @return The ID of the refiner.
    function addRefiner(
        uint256 dlpId,
        string calldata name,
        string calldata schemaDefinitionUrl,
        string calldata refinementInstructionUrl
    ) external returns (uint256);

    /// @notice Updates the owner of a refiner.
    /// @param refinerId The ID of the refiner.
    function updateRefinerOwner(uint256 refinerId) external;

    /// @notice Updates the owner of all refiners for a given DLP.
    /// @param dlpId The ID of the DLP.
    /// @dev This function is called when the DLP owner changes.
    function updateDlpRefinersOwner(uint256 dlpId) external;

    function addRefinementService(
        uint256 dlpId,
        address refinementService
    ) external;

    function removeRefinementService(
        uint256 dlpId,
        address refinementService
    ) external;

    function dlpRefinementServices(
        uint256 dlpId
    ) external view returns (address[] memory);

    function isRefinementService(
        uint256 refinerId,
        address refinementService
    ) external view returns (bool);
}
