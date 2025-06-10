// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./IDLPRegistry.sol";

abstract contract DLPRegistryStorageV1 is IDLPRegistry {
    IVanaEpoch public override vanaEpoch;
    ITreasury public override treasury;

    uint256 public override dlpRegistrationDepositAmount;

    uint256 public override dlpsCount;
    mapping(uint256 dlpId => Dlp dlp) internal _dlps;
    mapping(address dlpAddress => uint256 dlpId) public override dlpIds;
    mapping(string dlpName => uint256 dlpId) public override dlpNameToId;

    EnumerableSet.UintSet internal _eligibleDlpsList;
}
