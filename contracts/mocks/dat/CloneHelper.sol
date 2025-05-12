// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/proxy/Clones.sol";

contract CloneHelper {
    bytes32 public constant SALT = keccak256("DAT");

    function clone(address implementation) external returns (address instance) {
        return Clones.cloneDeterministic(implementation, SALT);
    }

    function predictDeterministicAddress(address implementation) external view returns (address instance) {
        return Clones.predictDeterministicAddress(implementation, SALT, address(this));
    }
}
