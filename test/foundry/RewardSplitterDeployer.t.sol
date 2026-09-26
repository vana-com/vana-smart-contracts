// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {RewardSplitterDeployer} from "../../contracts/vanaStaking/rewardSplitter/RewardSplitterDeployer.sol";
import {RewardSplitterImplementation} from "../../contracts/vanaStaking/rewardSplitter/RewardSplitterImplementation.sol";

/// @dev Stands in for the VanaPoolEntity: only its MAINTAINER_ROLE matters here.
contract EntityStub is AccessControl {
    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    constructor(address[] memory maintainers) {
        for (uint256 i = 0; i < maintainers.length; i++) _grantRole(MAINTAINER_ROLE, maintainers[i]);
    }
}

/// @notice The splitter proxy must land at the same address on every chain,
///         whoever signs: the address depends on (deployer, salt, entity,
///         implementation) only -- not on the signer, not on the owner -- and
///         only an entity maintainer can deploy, so nobody can occupy it first.
contract RewardSplitterDeployerTest is Test {
    RewardSplitterDeployer deployer;
    RewardSplitterImplementation impl;
    EntityStub entity;

    address mokshaMaintainer = makeAddr("mokshaMaintainer");
    address mainnetMaintainer = makeAddr("mainnetMaintainer");
    address attacker = makeAddr("attacker");
    address testnetOwner = makeAddr("testnetOwner");
    address mainnetMultisig = makeAddr("mainnetMultisig");
    bytes32 constant SALT = keccak256("RewardSplitterProxySalt");

    function setUp() public {
        deployer = new RewardSplitterDeployer();
        impl = new RewardSplitterImplementation();
        address[] memory m = new address[](2);
        m[0] = mokshaMaintainer; m[1] = mainnetMaintainer;
        entity = new EntityStub(m);
    }

    function test_addressIndependentOfSignerAndOwner_landsAtPrediction() public {
        address predicted = deployer.computeAddress(SALT, address(impl), address(entity));

        // "Moksha": one maintainer signs, EOA owner
        uint256 snap = vm.snapshotState();
        vm.prank(mokshaMaintainer);
        address p1 = deployer.deploy(SALT, address(impl), address(entity), testnetOwner);
        assertEq(p1, predicted, "Moksha lands at the prediction");
        assertTrue(RewardSplitterImplementation(payable(p1)).hasRole(0x00, testnetOwner), "owner = testnet EOA");
        vm.revertToState(snap);

        // "mainnet": a DIFFERENT maintainer signs, multisig owner, same salt/impl/entity
        vm.prank(mainnetMaintainer);
        address p2 = deployer.deploy(SALT, address(impl), address(entity), mainnetMultisig);
        assertEq(p2, predicted, "mainnet lands at the same address with a different signer and owner");
        assertTrue(RewardSplitterImplementation(payable(p2)).hasRole(0x00, mainnetMultisig), "owner = multisig");
    }

    function test_onlyAnEntityMaintainerCanDeploy() public {
        vm.prank(attacker);
        vm.expectRevert(RewardSplitterDeployer.NotEntityMaintainer.selector);
        deployer.deploy(SALT, address(impl), address(entity), attacker);
        // the address is still free for the maintainer
        vm.prank(mokshaMaintainer);
        assertEq(deployer.deploy(SALT, address(impl), address(entity), testnetOwner), deployer.computeAddress(SALT, address(impl), address(entity)));
    }

    function test_addressIsBoundToTheEntity() public {
        address[] memory m = new address[](1); m[0] = mokshaMaintainer;
        EntityStub other = new EntityStub(m);
        assertTrue(
            deployer.computeAddress(SALT, address(impl), address(entity)) != deployer.computeAddress(SALT, address(impl), address(other)),
            "a different entity yields a different address"
        );
    }

    function test_initializationIsAtomicAndSingleShot() public {
        vm.prank(mokshaMaintainer);
        address p = deployer.deploy(SALT, address(impl), address(entity), testnetOwner);
        RewardSplitterImplementation s = RewardSplitterImplementation(payable(p));
        assertEq(address(s.vanaPoolEntity()), address(entity));
        assertTrue(s.hasRole(s.MAINTAINER_ROLE(), testnetOwner));
        assertTrue(s.hasRole(s.DISTRIBUTOR_ROLE(), testnetOwner));
        vm.expectRevert(); // InvalidInitialization
        s.initialize(attacker, address(entity));
    }

    function test_failedInitializeRevertsTheWholeDeployment() public {
        address predicted = deployer.computeAddress(SALT, address(impl), address(entity));
        vm.prank(mokshaMaintainer);
        vm.expectRevert(); // InitializeFailed(bubbled InvalidAddress)
        deployer.deploy(SALT, address(impl), address(entity), address(0));
        assertEq(predicted.code.length, 0, "nothing left behind");
    }
}
