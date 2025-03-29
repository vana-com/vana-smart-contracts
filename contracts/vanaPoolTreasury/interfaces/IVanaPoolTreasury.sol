// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IVanaPoolTreasury {
    function version() external pure returns (uint256);
    function vanaPool() external view returns (address);
    function updateVanaPool(address vanaPoolAddress) external;
    function transferVana(address payable to, uint256 value) external returns (bool);
}
