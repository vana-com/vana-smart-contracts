// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IUniswapV3Factory
 * @notice Interface for Uniswap V3 Factory
 */
interface IUniswapV3Factory {
    /// @notice Returns the pool address for a given pair of tokens and a fee
    function getPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external view returns (address pool);

    /// @notice Creates a pool for the given two tokens and fee
    function createPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external returns (address pool);
}