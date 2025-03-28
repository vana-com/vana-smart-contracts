// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "hardhat/console.sol";

import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

contract ComputeEngineTeePoolFactoryBeacon is UpgradeableBeacon {
    bytes32 public constant SALT = keccak256("ComputeEngineTeePool");

    constructor(address _implementation, address _owner) UpgradeableBeacon(_implementation, _owner) {}

    function createBeaconProxy(bytes memory data) external returns (address) {
        BeaconProxy proxy = new BeaconProxy{salt: SALT}(address(this), data);
        return address(proxy);
    }

    function getProxyAddress(bytes memory data) public view returns (address) {
        bytes memory initCode = abi.encodePacked(type(BeaconProxy).creationCode, abi.encode(address(this), data));
        bytes32 bytecodeHash = keccak256(initCode);
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), SALT, bytecodeHash));
        return address(uint160(uint256(hash)));
    }
}
