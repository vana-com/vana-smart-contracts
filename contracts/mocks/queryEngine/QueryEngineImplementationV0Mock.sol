// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {QueryEngineImplementation} from "../../queryEngine/QueryEngineImplementation.sol";

contract QueryEngineImplementationV0Mock is QueryEngineImplementation {
    /**
     * @notice Upgrade the contract
     * This function is required by OpenZeppelin's UUPSUpgradeable
     *
     * @param newImplementation                  new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /**
     * return the version of the contract
     */
    function version() external pure virtual override returns (uint256) {
        return 0;
    }

    /**
     * @notice Tests the contract upgradeability
     */
    function test() external pure returns (string memory) {
        return "test";
    }
}
