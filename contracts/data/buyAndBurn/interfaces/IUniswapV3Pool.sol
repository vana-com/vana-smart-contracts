// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title IUniswapV3Pool
 * @notice Interface for Uniswap V3 Pool
 */
interface IUniswapV3Pool {
    /// @notice The first of the two tokens of the pool, sorted by address
    function token0() external view returns (address);

    /// @notice The second of the two tokens of the pool, sorted by address
    function token1() external view returns (address);

    /// @notice The pool's fee in hundredths of a bip, i.e. 1e-6
    function fee() external view returns (uint24);

    /// @notice The pool tick spacing
    function tickSpacing() external view returns (int24);

    /// @notice The currently in range liquidity available to the pool
    function liquidity() external view returns (uint128);

    /// @notice The 0th storage slot in the pool stores many values
    function slot0()
    external
    view
    returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    );

    /// @notice Returns the cumulative tick and liquidity as of each timestamp
    function observe(uint32[] calldata secondsAgos)
    external
    view
    returns (
        int56[] memory tickCumulatives,
        uint160[] memory secondsPerLiquidityCumulativeX128s
    );
}
