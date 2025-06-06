// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../../computeEngineTeePool/ComputeEngineTeePoolProxyFactory.sol";
import "../../computeEngineTeePool/interfaces/IComputeEngineTeePool.sol";

interface IComputeEngineTeePoolFactory {
    /// @notice Returns the version of the contract
    /// @return The version of the contract
    function version() external pure returns (uint256);

    /// @notice Pauses the contract
    function pause() external;

    /// @notice Unpauses the contract
    function unpause() external;

    function teePoolProxyFactory() external view returns (ComputeEngineTeePoolProxyFactory);

    function updateTeePoolProxyFactory(ComputeEngineTeePoolProxyFactory _teePoolProxyFactory) external;

    function computeEngine() external view returns (address);

    function updateComputeEngine(address _computeEngine) external;

    function ephemeralTimeout() external view returns (uint80);

    function persistentTimeout() external view returns (uint80);

    function updateEphemeralTimeout(uint80 timeout) external;

    function updatePersistentTimeout(uint80 timeout) external;

    function teePools(
        IComputeEngineTeePool.TeePoolType teePoolType,
        IComputeEngineTeePool.HardwareType hardwareType
    ) external view returns (IComputeEngineTeePool);

    function getTeePoolAddress(uint80 maxTimeout, bool gpuRequired) external view returns (IComputeEngineTeePool);

    function createTeePool(
        IComputeEngineTeePool.TeePoolType teePoolType,
        IComputeEngineTeePool.HardwareType hardwareType
    ) external returns (address);
}
