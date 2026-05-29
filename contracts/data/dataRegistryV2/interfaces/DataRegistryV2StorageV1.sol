// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./IDataRegistryV2.sol";

/**
 * @title Storage for DataRegistryV2
 * @notice For future upgrades, do not change DataRegistryV2StorageV1. Create a new
 * contract which implements DataRegistryV2StorageV1.
 */
abstract contract DataRegistryV2StorageV1 is IDataRegistryV2 {
    /// @dev Storage shape (contains mappings — not directly returnable from views).
    struct DataPoint {
        address owner;
        Status status;
        uint64 currentVersion;
        uint64 createdAt;
        uint64 modifiedAt;
        string scope;
        uint256 totalAccesses;
        mapping(uint256 version => bytes32 dataCommitment) commitments;
        mapping(uint256 version => uint256 accessCount) accessesByVersion;
    }

    /// @dev Data points keyed by `keccak256(abi.encode(owner, scope))`.
    mapping(bytes32 id => DataPoint) internal _dataPoints;

    /// @dev All data point ids registered under a given scope (insertion-stable).
    mapping(bytes32 scopeHash => EnumerableSet.Bytes32Set) internal _dataPointsByScope;

    /// @dev DataPortabilityServersV2 reference used to authorize personal-server
    ///      signers on `recordDataAccess`. Set post-deploy via setter.
    IDataPortabilityServersV2 public override dataPortabilityServers;

    /// @dev Replay-protection set for `recordDataAccess` payloads. Caller-chosen
    ///      recordIds are marked used the first time they appear.
    mapping(bytes32 recordId => bool used) internal _usedRecordIds;
}
