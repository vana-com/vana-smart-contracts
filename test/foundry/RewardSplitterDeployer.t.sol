// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {RewardSplitterDeployer} from "../../contracts/vanaStaking/rewardSplitter/RewardSplitterDeployer.sol";
import {RewardSplitterImplementation} from "../../contracts/vanaStaking/rewardSplitter/RewardSplitterImplementation.sol";

/// @notice The splitter proxy must land at the same address on every chain: the
///         address depends on (deployer contract, signer, salt, implementation)
///         and NOT on the initialize arguments, while initialization is atomic.
contract RewardSplitterDeployerTest is Test {
    RewardSplitterDeployer deployer;
    RewardSplitterImplementation impl;

    address signer = makeAddr("signer"); // the EOA that signs on every chain
    address attacker = makeAddr("attacker");
    address testnetOwner = makeAddr("testnetOwner");
    address mainnetMultisig = makeAddr("mainnetMultisig");
    address entity = makeAddr("entity"); // same on both chains in practice
    bytes32 constant SALT = keccak256("RewardSplitterProxySalt");

    function setUp() public {
        deployer = new RewardSplitterDeployer();
        impl = new RewardSplitterImplementation();
    }

    function _init(address owner) internal view returns (bytes memory) {
        return abi.encodeCall(RewardSplitterImplementation.initialize, (owner, entity));
    }

    function test_addressIsIndependentOfTheOwner() public {
        address predicted = deployer.computeAddress(signer, SALT, address(impl));

        // "testnet": owner is an EOA
        vm.prank(signer);
        address p1 = deployer.deploy(SALT, address(impl), _init(testnetOwner));
        assertEq(p1, predicted, "landed at the predicted address");

        // the prediction takes no owner at all: a mainnet deployment with the same
        // signer, salt and implementation but a multisig owner lands here too
        assertEq(deployer.computeAddress(signer, SALT, address(impl)), predicted, "prediction does not depend on owner");
        assertTrue(RewardSplitterImplementation(payable(p1)).hasRole(0x00, testnetOwner), "initialized for the given owner");
    }

    function test_sameSignerSaltImplGivesSameAddressForDifferentOwners() public {
        // Two chains are simulated as two independent deployer instances at the
        // same address is not possible in one EVM; instead show that the ONLY
        // inputs to the address are (deployer, signer, salt, impl) by deploying
        // with different owners under different salts and checking each matches
        // its owner-free prediction.
        bytes32 saltA = keccak256("A");
        bytes32 saltB = keccak256("B");
        vm.startPrank(signer);
        address a = deployer.deploy(saltA, address(impl), _init(testnetOwner));
        address b = deployer.deploy(saltB, address(impl), _init(mainnetMultisig));
        vm.stopPrank();
        assertEq(a, deployer.computeAddress(signer, saltA, address(impl)));
        assertEq(b, deployer.computeAddress(signer, saltB, address(impl)));
        assertTrue(RewardSplitterImplementation(payable(a)).hasRole(0x00, testnetOwner));
        assertTrue(RewardSplitterImplementation(payable(b)).hasRole(0x00, mainnetMultisig));
    }

    /// @dev Front-running protection: another sender cannot take our address.
    function test_differentSenderGetsADifferentAddress() public {
        address ours = deployer.computeAddress(signer, SALT, address(impl));
        vm.prank(attacker);
        address theirs = deployer.deploy(SALT, address(impl), _init(attacker));
        assertTrue(theirs != ours, "attacker cannot occupy the signer's address");

        vm.prank(signer);
        address p = deployer.deploy(SALT, address(impl), _init(testnetOwner));
        assertEq(p, ours, "signer still gets the predicted address");
    }

    function test_initializationIsAtomicAndSingleShot() public {
        vm.prank(signer);
        address p = deployer.deploy(SALT, address(impl), _init(testnetOwner));
        RewardSplitterImplementation s = RewardSplitterImplementation(payable(p));
        assertEq(address(s.vanaPoolEntity()), entity);
        assertTrue(s.hasRole(s.MAINTAINER_ROLE(), testnetOwner));
        assertTrue(s.hasRole(s.DISTRIBUTOR_ROLE(), testnetOwner));
        vm.expectRevert(); // InvalidInitialization
        s.initialize(attacker, entity);
    }

    function test_failedInitializeRevertsTheWholeDeployment() public {
        address predicted = deployer.computeAddress(signer, SALT, address(impl));
        vm.prank(signer);
        vm.expectRevert(); // InitializeFailed(bubbled InvalidAddress)
        deployer.deploy(SALT, address(impl), _init(address(0)));
        assertEq(predicted.code.length, 0, "nothing left behind at the address");
    }
}
