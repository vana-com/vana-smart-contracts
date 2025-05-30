// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {IDLPRegistry} from "../../interfaces/IDLPRegistry.sol";

/// @title A simple mock for DLPRegistry
/// @dev This contract is used for testing purposes only
contract DLPRegistryMock {
    mapping(uint256 => IDLPRegistry.DlpInfo dlp) private _dlps;
    uint256 public dlpsCount;

    error NotDlpOwner();
    modifier onlyDlpOwner(uint256 dlpId) {
        if (_dlps[dlpId].ownerAddress != msg.sender) {
            revert NotDlpOwner();
        }
        _;
    }

    function registerDlp() external {
        uint256 dlpId = ++dlpsCount;
        IDLPRegistry.DlpInfo storage dlp = _dlps[dlpId];
        dlp.id = dlpId;
        dlp.ownerAddress = msg.sender;
    }

    function updateDlpTreasuryAddress(uint256 dlpId, address newTreasuryAddress) external onlyDlpOwner(dlpId) {
        _dlps[dlpId].treasuryAddress = newTreasuryAddress;
    }

    function dlps(uint256 dlpId) public view returns (IDLPRegistry.DlpInfo memory) {
        return _dlps[dlpId];
    }
}
