// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./IDLPPerformance.sol";

abstract contract DLPPerformanceStorageV1 is IDLPPerformance {
    IDLPRegistry public override dlpRegistry;
    IVanaEpoch public override vanaEpoch;

    mapping(uint256 epochId => EpochPerformance) internal _epochPerformances;
}
