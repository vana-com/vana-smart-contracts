// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title A generic interface for a TeePool contract
/// @notice A contract or interface that inherits this interface should
/// define its own TeeInfo and Job structs.
interface ITeePool {
    /// @notice Returns the version of the contract
    /// @return The version of the contract
    function version() external pure returns (uint256);

    /// @notice Pauses the contract
    function pause() external;

    /// @notice Unpauses the contract
    function unpause() external;
    
    /// @notice Returns the number of Tees
    /// @return The number of Tees
    function teesCount() external view returns (uint256);
    
    /// @notice Returns the list of Tee addresses
    /// @return The list of Tee addresses
    function teeList() external view returns (address[] memory);
    
    /// @notice Returns the number of active Tees
    /// @return The number of active Tees
    function activeTeesCount() external view returns (uint256);
    
    /// @notice Returns the list of active Tee addresses
    /// @return The list of active Tee addresses
    function activeTeeList() external view returns (address[] memory);
    
    /// @notice Checks if the given address is a Tee
    /// @param teeAddress The address to check
    /// @return True if the address is a Tee, false otherwise
    function isTee(address teeAddress) external view returns (bool);

    /// @notice Adds a Tee to the pool
    /// @param teeAddress The address of the Tee
    /// @param params The parameters for the Tee
    function addTee(address teeAddress, bytes calldata params) external;
    
    /// @notice Removes a Tee from the pool
    /// @param teeAddress The address of the Tee
    function removeTee(address teeAddress) external;

    /// @notice Submits a job to the pool
    /// @param params The parameters for the job
    /// @return The address of the Tee assigned to the job
    function submitJob(bytes calldata params) external returns (address);

    /// @notice Removes a job in the pool
    /// @param jobId The ID of the job to remove
    function removeJob(uint256 jobId) external;
}