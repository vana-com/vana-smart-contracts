// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IDLPRoot} from "../../root/interfaces/IDLPRoot.sol";
import { IVeVANAVault } from "../../veVANA/interfaces/IVeVANAVault.sol";

interface IDLPRootTreasury {
    function version() external pure returns (uint256);
    function dlpRoot() external view returns (IDLPRoot);
    function updateDlpRoot(address dlpRootAddress) external;
    function veVANAVault() external view returns (IVeVANAVault);
    function updateVeVANAVault(address veVANAVaultAddress) external;
    function transferVana(address payable to, uint256 value) external;
    function transferVeVANA(address to, uint256 value) external returns (bool);
    function depositVana() external payable;
    function depositVeVANA(uint256 amount) external;
}
