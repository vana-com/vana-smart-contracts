// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../../computeEngineTeePool/interfaces/IComputeEngineTeePool.sol";
import "../../dataAccessPayment/interfaces/IPaymentExecutor.sol";
import "../../dataAccessTreasury/interfaces/IDataAccessTreasury.sol";
import "../../computeInstructionRegistry/interfaces/IComputeInstructionRegistry.sol";
import "../../computeEngineTeePoolFactory/interfaces/IComputeEngineTeePoolFactory.sol";

interface IComputeEngine is IPaymentExecutor {
    enum JobStatus {
        None,
        Registered, // The job is registered to the ComputeEngine contract
        Submitted, // The job is submitted to the appropriate TeePool contract and assigned to a Tee
        Running, // The job is running on the assigned Tee (the status is updated by the Tee)
        Completed,
        Failed,
        Canceled
    }

    struct Job {
        address ownerAddress;
        uint80 maxTimeout;
        bool gpuRequired;
        JobStatus status;
        address teeAddress;
        uint32 computeInstructionId;
        uint48 addedTimestamp;
        string statusMessage;
    }

    struct PaymentInfo {
        address payer;
        mapping(address token => uint256 amount) paidAmounts;
    }

    /// @notice Returns the version of the contract
    /// @return The version of the contract
    function version() external pure returns (uint256);

    /// @notice Pauses the contract
    function pause() external;

    /// @notice Unpauses the contract
    function unpause() external;

    /// @notice Returns the query engine
    /// @return The query engine
    function queryEngine() external view returns (address);

    /// @notice Updates the query engine
    /// @param queryEngineAddress The new query engine
    function updateQueryEngine(address queryEngineAddress) external;

    /// @notice Returns the compute engine treasury
    /// @return The compute engine treasury
    function computeEngineTreasury() external view returns (IDataAccessTreasury);

    /// @notice Updates the compute engine treasury
    /// @param computeEngineTreasuryAddress The new compute engine treasury
    function updateComputeEngineTreasury(IDataAccessTreasury computeEngineTreasuryAddress) external;

    function instructionRegistry() external view returns (IComputeInstructionRegistry);

    function updateInstructionRegistry(IComputeInstructionRegistry instructionRegistryAddress) external;

    function teePoolFactory() external view returns (IComputeEngineTeePoolFactory);

    function updateTeePoolFactory(IComputeEngineTeePoolFactory teePoolFactoryAddress) external;

    ////////////////////////
    ///// Job Registry /////
    ////////////////////////

    /// @notice Returns the number of jobs
    function jobsCount() external view returns (uint256);

    /// @notice Returns the job with the given ID
    /// @param jobId The ID of the job
    function jobs(uint256 jobId) external view returns (Job memory);

    /// @notice Submits a job to the ComputeEngine
    function submitJob(uint80 maxTimeout, bool gpuRequired, uint256 computeInstructionId) external payable;

    /// @notice Resubmits a job
    function resubmitJob(uint256 jobId) external;

    /// @notice Submits a job to the ComputeEngine and assigns it to a dedicated Tee
    /// @param maxTimeout The maximum timeout for the job
    /// @param gpuRequired True if the job requires GPU, false otherwise
    /// @param computeInstructionId The ID of the compute instruction
    /// @param teeAddress The address of the Tee to assign the job to
    function submitJobWithTee(
        uint256 maxTimeout,
        bool gpuRequired,
        uint256 computeInstructionId,
        address teeAddress
    ) external payable;

    /// @notice Resubmits a job with a dedicated Tee
    function resubmitJobWithTee(uint256 jobId, address teeAddress) external;

    /// @notice Cancels a job
    /// @param jobId The ID of the job to cancel
    function cancelJob(uint256 jobId) external;

    /// @notice Updates the status of a job
    /// @param jobId The ID of the job
    /// @param status The new status of the job
    /// @param statusMessage The status message
    /// @dev Only the Tee assigned to the job can update the status
    function updateJobStatus(uint256 jobId, JobStatus status, string calldata statusMessage) external;

    //////////////////////////
    ///// Wallet Balance /////
    //////////////////////////
    function deposit(address token, uint256 amount) external payable;

    function withdraw(address token, uint256 amount) external;

    function balanceOf(address account, address token) external view returns (uint256);
}
