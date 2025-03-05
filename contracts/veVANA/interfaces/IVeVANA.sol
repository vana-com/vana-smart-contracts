// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVeVANA is IERC20 {
    function version() external pure returns (uint256);

    function depositVANA() external payable;

    function withdrawVANA(uint256 amount) external;
}