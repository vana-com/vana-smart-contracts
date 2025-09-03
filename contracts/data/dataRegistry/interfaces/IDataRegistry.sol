// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../dataRefinerRegistry/interfaces/IDataRefinerRegistry.sol";

interface IDataRegistry {
    struct ProofData {
        uint256 score;
        uint256 dlpId;
        string metadata;
        string proofUrl;
        string instruction;
    }

    struct Proof {
        bytes signature;
        ProofData data;
    }

    struct File {
        address ownerAddress;
        string url;
        uint256 addedAtBlock;
        uint256 proofsCount;
        mapping(uint256 proofId => Proof proof) proofs;
        mapping(address account => string key) permissions;
        /// @dev refinements is a mapping of refinerId to an URL of the File's refinement against the refiner.
        mapping(uint256 refinerId => string url) refinements;
        uint256 schemaId; // New field to link to Schema
    }

    struct FileResponse {
        uint256 id;
        address ownerAddress;
        string url;
        uint256 schemaId;
        uint256 addedAtBlock;
    }

    struct Permission {
        address account;
        string key;
    }

    function version() external pure returns (uint256);
    function filesCount() external view returns (uint256);
    function files(uint256 index) external view returns (FileResponse memory);
    function fileIdByUrl(string memory url) external view returns (uint256);
    function fileProofs(uint256 fileId, uint256 index) external view returns (Proof memory);
    function filePermissions(uint256 fileId, address account) external view returns (string memory);
    function pause() external;
    function unpause() external;
    function addFile(string memory url) external returns (uint256);
    function addFileWithSchema(string memory url, uint256 schemaId) external returns (uint256);
    function addFileWithPermissions(
        string memory url,
        address ownerAddress,
        Permission[] memory permissions
    ) external returns (uint256);
    function addFileWithPermissionsAndSchema(
        string memory url,
        address ownerAddress,
        Permission[] memory permissions,
        uint256 schemaId
    ) external returns (uint256);
    function addFilePermissionsAndSchema(uint256 fileId, Permission[] memory permissions, uint256 schemaId) external;
    function addProof(uint256 fileId, Proof memory proof) external;
    function addFilePermission(uint256 fileId, address account, string memory key) external;

    function dataRefinerRegistry() external view returns (IDataRefinerRegistry);

    function updateDataRefinerRegistry(IDataRefinerRegistry newDataRefinerRegistry) external;

    /// @notice Adds a refinement to a file with the given fileId.
    /// @param fileId The ID of the file to add the refinement to.
    /// @param refinerId The ID of the refiner.
    /// @param url The URL of the refinement against the refiner.
    /// @param account The account to add the permission for.
    /// @param key The encryption key for the account.
    function addRefinementWithPermission(
        uint256 fileId,
        uint256 refinerId,
        string calldata url,
        address account,
        string calldata key
    ) external;

    /// @notice Returns the refinement URL of fileId against the refiner refinerId.
    /// @param fileId The ID of the file to get the refinement for.
    /// @param refinerId The ID of the refiner.
    /// @return The URL of the refinement against the refiner.
    function fileRefinements(uint256 fileId, uint256 refinerId) external view returns (string memory);
}
