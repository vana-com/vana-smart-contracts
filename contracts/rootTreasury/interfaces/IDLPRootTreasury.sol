// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IDLPRoot} from "../../root/interfaces/IDLPRoot.sol";

interface IDLPRootTreasury {
    function version() external pure returns (uint256);
    function dlpRoot() external view returns (IDLPRoot);
    function updateDlpRoot(address dlpRootAddress) external;
    function transferVana(address payable to, uint256 value) external returns (bool);
}
