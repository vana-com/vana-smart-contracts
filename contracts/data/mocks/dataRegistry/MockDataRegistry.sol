// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../../data/dataRegistry/interfaces/IDataRegistry.sol";
import "../../../data/dataRefinerRegistry/interfaces/IDataRefinerRegistry.sol";

contract MockDataRegistry is IDataRegistry {
    IDataRefinerRegistry public dataRefinerRegistry;
    mapping(uint256 => FileResponse) private _files;
    uint256 public filesCount;

    function version() external pure override returns (uint256) {
        return 1;
    }

    function pause() external override {}
    function unpause() external override {}

    function files(uint256 fileId) external view override returns (FileResponse memory) {
        return _files[fileId];
    }

    function fileIdByUrl(string memory) external pure override returns (uint256) {
        return 0;
    }

    function fileProofs(uint256, uint256) external pure override returns (Proof memory) {
        return Proof({
            signature: "",
            data: ProofData({
                score: 0,
                dlpId: 0,
                metadata: "",
                proofUrl: "",
                instruction: ""
            })
        });
    }

    function filePermissions(uint256, address) external pure override returns (string memory) {
        return "";
    }

    function addFile(string memory) external pure override returns (uint256) {
        return 0;
    }

    function addFileWithSchema(string memory, uint256) external pure override returns (uint256) {
        return 0;
    }

    function addFileWithPermissions(
        string memory,
        address,
        Permission[] memory
    ) external pure override returns (uint256) {
        return 0;
    }

    function addFileWithPermissionsAndSchema(
        string memory,
        address,
        Permission[] memory,
        uint256
    ) external pure override returns (uint256) {
        return 0;
    }

    function addProof(uint256, Proof memory) external override {}

    function addFilePermission(uint256, address, string memory) external override {}

    function addRefinementWithPermission(
        uint256,
        uint256,
        string calldata,
        address,
        string calldata
    ) external override {}

    function fileRefinements(uint256, uint256) external pure override returns (string memory) {
        return "";
    }

    function updateDataRefinerRegistry(IDataRefinerRegistry newDataRefinerRegistry) external override {
        dataRefinerRegistry = newDataRefinerRegistry;
    }

    // Mock function to set file data for testing
    function setFile(uint256 fileId, address ownerAddress, string memory url) external {
        filesCount = fileId > filesCount ? fileId : filesCount;
        _files[fileId] = FileResponse({
            id: fileId,
            url: url,
            ownerAddress: ownerAddress,
            addedAtBlock: block.number
        });
    }
}