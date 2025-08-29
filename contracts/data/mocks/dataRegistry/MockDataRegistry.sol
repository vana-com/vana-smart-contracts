// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../../data/dataRegistry/interfaces/IDataRegistry.sol";
import "../../../data/dataRefinerRegistry/interfaces/IDataRefinerRegistry.sol";

contract MockDataRegistry is IDataRegistry {
    IDataRefinerRegistry public dataRefinerRegistry;
    mapping(uint256 => FileResponse) private _files;
    mapping(string => uint256) private _urlToFileId;
    mapping(uint256 => mapping(address => string)) private _filePermissions;
    uint256 public filesCount;

    function version() external pure override returns (uint256) {
        return 1;
    }

    function pause() external override {}
    function unpause() external override {}

    function files(uint256 fileId) external view override returns (FileResponse memory) {
        return _files[fileId];
    }

    function fileIdByUrl(string memory url) external view override returns (uint256) {
        return _urlToFileId[url];
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

    function filePermissions(uint256 fileId, address account) external view override returns (string memory) {
        return _filePermissions[fileId][account];
    }

    function addFile(string memory url) external override returns (uint256) {
        return _addFile(url, msg.sender);
    }

    function addFileWithSchema(string memory url, uint256) external override returns (uint256) {
        return _addFile(url, msg.sender);
    }

    function addFileWithPermissions(
        string memory url,
        address ownerAddress,
        Permission[] memory permissions
    ) external override returns (uint256) {
        uint256 fileId = _addFile(url, ownerAddress);
        
        // Add permissions
        for (uint256 i = 0; i < permissions.length; i++) {
            _filePermissions[fileId][permissions[i].account] = permissions[i].key;
        }
        
        return fileId;
    }

    function addFileWithPermissionsAndSchema(
        string memory url,
        address ownerAddress,
        Permission[] memory,
        uint256
    ) external override returns (uint256) {
        return _addFile(url, ownerAddress);
    }

    function addFileV3(AddFileRequest memory addFileData) external override returns (uint256) {
        if (addFileData.ownerShares.length == 0) {
            revert AtLeastOneOwnerRequired();
        }
        
        uint256 totalShares = 0;
        for (uint256 i = 0; i < addFileData.ownerShares.length; i++) {
            if (addFileData.ownerShares[i].ownerAddress == address(0)) {
                revert InvalidOwnerAddress();
            }
            if (addFileData.ownerShares[i].share == 0) {
                revert ShareMustBeGreaterThanZero();
            }
            totalShares += addFileData.ownerShares[i].share;
        }
        if (totalShares != 1e18) {
            revert TotalSharesMustEqual1e18();
        }
        
        uint256 fileId = _addFile(addFileData.url, address(0));
        
        for (uint256 i = 0; i < addFileData.permissions.length; i++) {
            _filePermissions[fileId][addFileData.permissions[i].account] = addFileData.permissions[i].key;
        }
        
        if (addFileData.schemaId > 0) {
            _files[fileId].schemaId = addFileData.schemaId;
        }
        
        return fileId;
    }

    function filesV3(uint256 fileId) external view override returns (FileResponseV3 memory) {
        FileResponse memory file = _files[fileId];
        OwnerShare[] memory ownerShares = new OwnerShare[](0);
        
        return FileResponseV3({
            id: file.id,
            url: file.url,
            ownerAddress: file.ownerAddress,
            schemaId: file.schemaId,
            addedAtBlock: file.addedAtBlock,
            ownerShares: ownerShares
        });
    }

    function addFilePermissionsAndSchema(
        uint256 fileId,
        Permission[] memory permissions,
        uint256 schemaId
    ) external override {
        // Update schema
        _files[fileId].schemaId = schemaId;
        
        // Add permissions
        for (uint256 i = 0; i < permissions.length; i++) {
            _filePermissions[fileId][permissions[i].account] = permissions[i].key;
        }
    }

    function addProof(uint256, Proof memory) external override {}

    function addFilePermission(uint256 fileId, address account, string memory key) external override {
        _filePermissions[fileId][account] = key;
    }

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

    // Internal function to add files
    function _addFile(string memory url, address ownerAddress) internal returns (uint256) {
        // Check if file already exists
        uint256 existingFileId = _urlToFileId[url];
        if (existingFileId != 0) {
            return existingFileId;
        }
        
        filesCount++;
        uint256 fileId = filesCount;
        
        _files[fileId] = FileResponse({
            id: fileId,
            url: url,
            ownerAddress: ownerAddress,
            addedAtBlock: block.number,
            schemaId: 0 // Default schema ID, can be updated later
        });
        
        _urlToFileId[url] = fileId;
        
        return fileId;
    }

    // Mock function to set file data for testing
    function setFile(uint256 fileId, address ownerAddress, string memory url) external {
        filesCount = fileId > filesCount ? fileId : filesCount;
        _files[fileId] = FileResponse({
            id: fileId,
            url: url,
            ownerAddress: ownerAddress,
            addedAtBlock: block.number,
            schemaId: 0 // Default schema ID, can be updated later
        });
        _urlToFileId[url] = fileId;
    }
}