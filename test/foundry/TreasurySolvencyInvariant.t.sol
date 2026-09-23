// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {VanaPoolStakingImplementation} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingImplementation.sol";
import {VanaPoolStakingProxy} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingProxy.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {VanaPoolEntityProxy} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityProxy.sol";
import {VanaPoolTreasuryImplementation} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryImplementation.sol";
import {VanaPoolTreasuryProxy} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryProxy.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @dev Drives random value-moving operations against the pool so the solvency
///      invariant is checked after each. All calls are try/catch so expected
///      reverts (bonding, floor, insufficient) don't abort the run.
contract SolvencyHandler is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    uint256 public numEntities;
    address[] internal actors;

    constructor(VanaPoolStakingImplementation s, VanaPoolEntityImplementation e, uint256 n, address[] memory a) {
        staking = s;
        entity = e;
        numEntities = n;
        actors = a;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }
    function _entity(uint256 seed) internal view returns (uint256) {
        return (seed % numEntities) + 1;
    }

    function stake(uint256 aSeed, uint256 eSeed, uint256 amount) public {
        address actor = _actor(aSeed);
        amount = bound(amount, 1e15, 1_000 ether);
        vm.deal(actor, amount);
        vm.prank(actor);
        try staking.stake{value: amount}(_entity(eSeed), actor, 0) {} catch {}
    }

    function unstake(uint256 aSeed, uint256 eSeed, uint256 shareSeed) public {
        address actor = _actor(aSeed);
        uint256 id = _entity(eSeed);
        uint256 shares = staking.stakerEntities(actor, id).shares;
        if (shares == 0) return;
        vm.prank(actor);
        try staking.unstake(id, bound(shareSeed, 1, shares), 0) {} catch {}
    }

    function addRewards(uint256 eSeed, uint256 amount) public {
        amount = bound(amount, 1e15, 1_000 ether);
        vm.deal(address(this), amount);
        try entity.addRewards{value: amount}(_entity(eSeed)) {} catch {}
    }

    function processRewards(uint256 eSeed) public {
        try entity.processRewards(_entity(eSeed)) {} catch {}
    }

    function warp(uint256 dt) public {
        vm.warp(block.timestamp + bound(dt, 1, 30 days));
    }
}

/// @notice Invariant: the shared treasury always covers the sum of every entity's
///         booked pools (active + locked + accrued commission + splitter track).
///         Violated the moment the treasury-drain finding is triggered.
contract TreasurySolvencyInvariantTest is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    VanaPoolTreasuryImplementation treasury;
    SolvencyHandler handler;

    address owner = makeAddr("owner");

    uint256 constant N = 3;

    function setUp() public {
        vm.warp(1_000_000);

        VanaPoolStakingImplementation si = new VanaPoolStakingImplementation();
        VanaPoolEntityImplementation ei = new VanaPoolEntityImplementation();
        VanaPoolTreasuryImplementation ti = new VanaPoolTreasuryImplementation();

        staking = VanaPoolStakingImplementation(
            payable(
                new VanaPoolStakingProxy(
                    address(si),
                    abi.encodeCall(VanaPoolStakingImplementation.initialize, (address(0), owner, 1e15))
                )
            )
        );
        entity = VanaPoolEntityImplementation(
            payable(
                new VanaPoolEntityProxy(
                    address(ei),
                    abi.encodeCall(VanaPoolEntityImplementation.initialize, (owner, address(staking), 1 ether, 6e18))
                )
            )
        );
        treasury = VanaPoolTreasuryImplementation(
            payable(
                new VanaPoolTreasuryProxy(
                    address(ti),
                    abi.encodeCall(VanaPoolTreasuryImplementation.initialize, (owner, address(staking)))
                )
            )
        );

        vm.startPrank(owner);
        staking.updateVanaPoolEntity(address(entity));
        staking.updateVanaPoolTreasury(address(treasury));
        staking.updateBondingPeriod(3 days); // exercise the bonding branch + cap
        vm.stopPrank();

        // create N entities with distinct owners
        vm.deal(owner, 100 ether);
        for (uint256 i = 0; i < N; i++) {
            address entOwner = address(uint160(0xE0 + i));
            vm.prank(owner);
            entity.createEntity{value: 1 ether}(
                IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: entOwner, name: string(abi.encodePacked("pool-", vm.toString(i)))})
            );
        }

        address[] memory actors = new address[](4);
        actors[0] = makeAddr("alice");
        actors[1] = makeAddr("bob");
        actors[2] = makeAddr("carol");
        actors[3] = makeAddr("dave");

        handler = new SolvencyHandler(staking, entity, N, actors);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 30
    function invariant_treasuryCoversAllPools() public view {
        uint256 backing;
        for (uint256 i = 1; i <= N; i++) {
            IVanaPoolEntity.EntityInfo memory e = entity.entities(i);
            backing += e.activeRewardPool + e.lockedRewardPool;
            backing += entity.entityAccruedCommission(i);
            backing += entity.entityStakerLockedRewardPool(i);
        }
        assertGe(address(treasury).balance, backing, "treasury must cover every entity's booked pools");
    }
}
