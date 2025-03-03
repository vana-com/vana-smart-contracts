// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./IVeVANA.sol";

interface IVeVANAVault {
    function version() external pure returns (uint256);

    function token() external view returns (IVeVANA);

    function updateToken(address tokenAddress) external;

    function depositVANA() external payable;

    function withdrawVANA(uint256 amount) external;
}