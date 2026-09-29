// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IVanaPoolTreasury {
    function version() external pure returns (uint256);
    function SPENDER_ROLE() external view returns (bytes32);
    function vanaPool() external view returns (address);
    function vanaPoolEntity() external view returns (address);
    function updateVanaPool(address vanaPoolAddress) external;
    function updateVanaPoolEntity(address vanaPoolEntityAddress) external;
    function transferVana(address payable to, uint256 value) external returns (bool);
}
