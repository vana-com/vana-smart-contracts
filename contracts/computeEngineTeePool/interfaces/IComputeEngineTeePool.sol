// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./ITeePool.sol";

interface IComputeEngineTeePool is ITeePool {
    enum TeePoolType {
        None,
        Ephemeral,
        Persistent,
        Dedicated
    }

    enum HardwareType {
        None,
        Standard, // CPU only
        GPU
    }

    enum TeeStatus {
        None,
        Active,
        Removed
    }

    struct Tee {
        string url;
        TeeStatus status;
        EnumerableSet.UintSet jobIdsList;
        string publicKey;
    }

    struct TeeInfo {
        address teeAddress;
        string url;
        TeeStatus status;
        uint256 jobsCount;
        string publicKey;
    }

    /// @notice Returns the type of the Tee pool
    function teePoolType() external view returns (TeePoolType);

    // /// @notice Updates the type of the Tee pool
    // /// @param teePoolType The new type of the Tee pool
    // /// @dev Only callable by the TeePoolFactory contract to ensure consistency
    // function updateTeePoolType(TeePoolType teePoolType) external;

    /// @notice Returns the hardware type of the Tee pool
    function hardwareType() external view returns (HardwareType);

    // /// @notice Updates the hardware type of the Tee pool
    // /// @dev Only callable by the TeePoolFactory contract to ensure consistency
    // function updateHardwareType(HardwareType hardwareType) external;

    /// @notice Returns the maximum timeout for a job
    function maxTimeout() external view returns (uint80);

    /// @notice Updates the maximum timeout for a job
    /// @param maxTimeout The new maximum timeout for a job
    function updateMaxTimeout(uint80 maxTimeout) external;

    /// @notice Returns the ComputeEngine contract address
    function computeEngine() external view returns (address);

    /// @notice Updates the ComputeEngine contract address
    /// @param computeEngineAddress The new ComputeEngine contract address
    function updateComputeEngine(address computeEngineAddress) external;

    function teePoolFactory() external view returns (address);

    function updateTeePoolFactory(address teePoolFactoryAddress) external;

    /// @notice Returns the Tee info for the given address
    /// @param teeAddress The address of the Tee
    /// @return The Tee info
    function tees(address teeAddress) external view returns (TeeInfo memory);

    /// @notice Returns the Tee info for the Tee at the given index
    /// @param index The index of the Tee
    /// @return The Tee info
    function teeListAt(uint256 index) external view returns (TeeInfo memory);

    /// @notice Returns the Tee info for the active Tee at the given index
    /// @param index The index of the active Tee
    /// @return The Tee info
    function activeTeeListAt(uint256 index) external view returns (TeeInfo memory);
}
