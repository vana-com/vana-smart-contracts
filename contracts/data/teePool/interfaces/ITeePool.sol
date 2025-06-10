// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IDataRegistry} from "../../dataRegistry/interfaces/IDataRegistry.sol";

interface ITeePool {
    enum TeeStatus {
        None,
        Active,
        Removed
    }

    enum JobStatus {
        None,
        Submitted,
        Completed,
        Canceled
    }

    struct Job {
        uint256 fileId;
        uint256 bidAmount;
        JobStatus status;
        uint256 addedTimestamp;
        address ownerAddress;
        address teeAddress;
    }

    struct Tee {
        TeeStatus status;
        string url;
        uint256 amount;
        uint256 withdrawnAmount;
        EnumerableSet.UintSet jobIdsList;
        string publicKey;
    }

    function version() external pure returns (uint256);
    function dataRegistry() external view returns (IDataRegistry);
    function cancelDelay() external view returns (uint256);
    function jobsCount() external view returns (uint256);
    function jobs(uint256 jobId) external view returns (Job memory);
    struct TeeInfo {
        address teeAddress;
        string url;
        TeeStatus status;
        uint256 amount;
        uint256 withdrawnAmount;
        uint256 jobsCount;
        string publicKey;
    }
    function tees(address teeAddress) external view returns (TeeInfo memory);
    function teesCount() external view returns (uint256);
    function teeList() external view returns (address[] memory);
    function teeListAt(uint256 index) external view returns (TeeInfo memory);
    function activeTeesCount() external view returns (uint256);
    function activeTeeList() external view returns (address[] memory);
    function activeTeeListAt(uint256 index) external view returns (TeeInfo memory);
    function isTee(address teeAddress) external view returns (bool);
    function teeFee() external view returns (uint256);
    function teeJobIdsPaginated(
        address teeAddress,
        uint256 start,
        uint256 limit
    ) external view returns (uint256[] memory);
    function fileJobIds(uint256 fileId) external view returns (uint256[] memory);

    function pause() external;
    function unpause() external;
    function updateDataRegistry(IDataRegistry dataRegistry) external;
    function updateTeeFee(uint256 newTeeFee) external;
    function updateCancelDelay(uint256 newCancelDelay) external;
    function addTee(address teeAddress, string calldata url, string calldata publicKey) external;
    function removeTee(address teeAddress) external;
    function requestContributionProof(uint256 fileId) external payable;
    function submitJob(uint256 fileId) external payable;
    function cancelJob(uint256 jobId) external;
    function addProof(uint256 fileId, IDataRegistry.Proof memory proof) external;
}
