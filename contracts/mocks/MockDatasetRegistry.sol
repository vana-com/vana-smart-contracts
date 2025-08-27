// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../data/interfaces/IDatasetRegistry.sol";

contract MockDatasetRegistry is IDatasetRegistry {
    mapping(uint256 => DatasetInfo) private _datasets;
    uint256 private _nextDatasetId = 1;

    function addDataset(
        address ownerAddress,
        string memory name,
        string memory description,
        string memory metadata
    ) external returns (uint256) {
        uint256 datasetId = _nextDatasetId++;
        _datasets[datasetId] = DatasetInfo({
            id: datasetId,
            name: name,
            description: description,
            metadata: metadata,
            ownerAddress: ownerAddress,
            createdAt: block.timestamp
        });
        return datasetId;
    }

    function datasets(uint256 datasetId) external view override returns (DatasetInfo memory) {
        return _datasets[datasetId];
    }

    function setDatasetOwner(uint256 datasetId, address ownerAddress) external {
        _datasets[datasetId].ownerAddress = ownerAddress;
    }
}