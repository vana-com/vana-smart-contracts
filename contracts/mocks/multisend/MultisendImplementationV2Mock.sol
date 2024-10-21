// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {MultisendImplementation} from "../../multisend/MultisendImplementation.sol";

contract MultisendImplementationV2Mock is MultisendImplementation {
    /**
     * @notice Upgrade the contract
     * This function is required by OpenZeppelin's UUPSUpgradeable
     *
     * @param newImplementation                  new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyOwner {}

    /**
     * @notice Tests the contract upgradeability
     */
    function test() external pure returns (string memory) {
        return "test";
    }
}
