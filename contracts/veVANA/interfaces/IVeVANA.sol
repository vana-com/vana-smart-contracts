// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IVeVANA is IERC20 {
    function depositVANA() external payable;

    function withdrawVANA(uint256 amount) external;

    function renounceOwnership() external;

    function delegate(address delegatee) external;

    function delegates(address account) external returns (address);
}