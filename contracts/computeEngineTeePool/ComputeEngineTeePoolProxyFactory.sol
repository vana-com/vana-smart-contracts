// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "hardhat/console.sol";

import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

contract ComputeEngineTeePoolProxyFactory is UpgradeableBeacon {
    constructor(address initImplementation, address initOwner) UpgradeableBeacon(initImplementation, initOwner) {}

    function createBeaconProxy(bytes memory data) external returns (address) {
        bytes32 SALT = keccak256(abi.encodePacked(msg.sender));
        BeaconProxy proxy = new BeaconProxy{salt: SALT}(address(this), data);
        return address(proxy);
    }

    function getProxyAddress(bytes memory data, address deployer) public view returns (address) {
        bytes memory initCode = abi.encodePacked(type(BeaconProxy).creationCode, abi.encode(address(this), data));
        bytes32 bytecodeHash = keccak256(initCode);
        bytes32 SALT = keccak256(abi.encodePacked(deployer));
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), SALT, bytecodeHash));
        return address(uint160(uint256(hash)));
    }
}
