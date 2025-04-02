// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "hardhat/console.sol";

import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

contract ComputeEngineTeePoolFactoryBeacon is UpgradeableBeacon {
    uint256 public nonce;

    constructor(address initImplementation, address initOwner) UpgradeableBeacon(initImplementation, initOwner) {}

    function createBeaconProxy(bytes memory data) external returns (address) {
        bytes32 SALT = keccak256(abi.encodePacked(msg.sender, nonce));
        ++nonce;
        BeaconProxy proxy = new BeaconProxy{salt: SALT}(address(this), data);
        return address(proxy);
    }

    function getProxyAddress(bytes memory data, address deployer, uint256 nonceAtDeploy) public view returns (address) {
        bytes memory initCode = abi.encodePacked(type(BeaconProxy).creationCode, abi.encode(address(this), data));
        bytes32 bytecodeHash = keccak256(initCode);
        bytes32 SALT = keccak256(abi.encodePacked(deployer, nonceAtDeploy));
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), SALT, bytecodeHash));
        return address(uint160(uint256(hash)));
    }
}
