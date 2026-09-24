// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {VanaPoolStakingImplementation} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingImplementation.sol";
import {VanaPoolStakingProxy} from "../../contracts/vanaStaking/vanaPoolStaking/VanaPoolStakingProxy.sol";
import {VanaPoolEntityImplementation} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityImplementation.sol";
import {VanaPoolEntityProxy} from "../../contracts/vanaStaking/vanaPoolEntity/VanaPoolEntityProxy.sol";
import {VanaPoolTreasuryImplementation} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryImplementation.sol";
import {VanaPoolTreasuryProxy} from "../../contracts/vanaStaking/vanaPoolTreasury/VanaPoolTreasuryProxy.sol";
import {IVanaPoolEntity} from "../../contracts/vanaStaking/vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/// @dev Drives random value-moving operations against the pool so the solvency
///      invariant is checked after each. All calls are try/catch so expected
///      reverts (bonding, floor, cap, insufficient, wrong model) don't abort
///      the run. The actor pool includes the entity owners, so the registrant
///      floor and the ownership-transfer path are exercised, not just plain
///      stakers.
contract SolvencyHandler is Test {
    VanaPoolStakingImplementation staking;
    VanaPoolEntityImplementation entity;
    uint256 public numEntities;
    address[] internal actors;

    // Successful (non-reverting) protocol calls for the actions added after
    // #82's review. Every call is try/catch, so the fuzzer's own revert count
    // is always 0; these show the actions actually exercise the protocol.
    uint256 public okRedelegate;
    uint256 public okDistribute;
    uint256 public okTransfer;

    // VanaPoolStaking storage: 9 bondingPeriod (V2), 10 entityRegistrant,
    // 11 entityRegistrationShares (V3). Proven in the constructor.
    uint256 constant SLOT_BONDING = 9;
    uint256 constant SLOT_REGISTRANT = 10;
    uint256 constant SLOT_REG_SHARES = 11;

    constructor(VanaPoolStakingImplementation s, VanaPoolEntityImplementation e, uint256 n, address[] memory a) {
        staking = s;
        entity = e;
        numEntities = n;
        actors = a;
        // forgetRegistration writes raw slots; fail loudly if the layout moved.
        require(uint256(vm.load(address(staking), bytes32(SLOT_BONDING))) == staking.bondingPeriod(), "slot map");
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }
    function _entity(uint256 seed) internal view returns (uint256) {
        return (seed % numEntities) + 1;
    }
    function _owner(uint256 id) internal view returns (address) {
        return entity.entities(id).ownerAddress; // live: follows ownership transfers
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

    /// @dev Redelegate-out was the path with no floor check before #82; the
    ///      destination mint is also where the price cap applies.
    function redelegate(uint256 aSeed, uint256 fromSeed, uint256 toSeed, uint256 shareSeed) public {
        address actor = _actor(aSeed);
        uint256 from = _entity(fromSeed);
        uint256 to = _entity(toSeed);
        uint256 shares = staking.stakerEntities(actor, from).shares;
        if (shares == 0) return;
        vm.prank(actor);
        try staking.redelegate(from, to, bound(shareSeed, 1, shares), 0) {
            okRedelegate++;
        } catch {}
    }

    function addRewards(uint256 eSeed, uint256 amount) public {
        amount = bound(amount, 1e15, 1_000 ether);
        vm.deal(address(this), amount);
        try entity.addRewards{value: amount}(_entity(eSeed)) {} catch {}
    }

    /// @dev The finding's "park" step: an owner books value into a STREAM
    ///      entity without minting shares. Reverts (caught) on APY entities.
    function distributeRewards(uint256 eSeed, uint256 amount, uint256 startSeed, uint256 durSeed) public {
        uint256 id = _entity(eSeed);
        address owner = _owner(id);
        amount = bound(amount, 1e15, 1_000 ether);
        uint64 start = uint64(block.timestamp + bound(startSeed, 0, 7 days));
        uint32 duration = uint32(bound(durSeed, 0, 30 days));
        vm.deal(owner, amount);
        vm.prank(owner);
        try entity.distributeRewards{value: amount}(id, amount, start, duration) {
            okDistribute++;
        } catch {}
    }

    /// @dev Ownership transfer was the other bypass of the old owner-bound
    ///      floor. The registrant stays in the actor pool and keeps trying to
    ///      unstake / redelegate its seed afterwards.
    function transferOwnership(uint256 eSeed, uint256 newOwnerSeed) public {
        uint256 id = _entity(eSeed);
        address owner = _owner(id);
        string memory name = entity.entities(id).name;
        vm.prank(owner);
        try entity.updateEntity(id, IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: _actor(newOwnerSeed), name: name})) {
            okTransfer++;
        } catch {}
    }

    /// @dev Simulate a pre-upgrade (legacy) entity by clearing its registration
    ///      record. Drain-to-dust then becomes reachable; the price cap alone
    ///      must keep the treasury solvent.
    function forgetRegistration(uint256 eSeed) public {
        uint256 id = _entity(eSeed);
        vm.store(address(staking), keccak256(abi.encode(id, SLOT_REGISTRANT)), bytes32(0));
        vm.store(address(staking), keccak256(abi.encode(id, SLOT_REG_SHARES)), bytes32(0));
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

        // N entities with distinct owners, alternating APY / STREAM so the
        // owner-scheduled park path (distributeRewards) has a real target.
        address[] memory entOwners = new address[](N);
        vm.deal(owner, 100 ether);
        for (uint256 i = 0; i < N; i++) {
            entOwners[i] = address(uint160(0xE0 + i));
            IVanaPoolEntity.RewardModel model = i % 2 == 0
                ? IVanaPoolEntity.RewardModel.APY
                : IVanaPoolEntity.RewardModel.STREAM;
            vm.prank(owner);
            entity.createEntity{value: 1 ether}(
                IVanaPoolEntity.EntityRegistrationInfo({ownerAddress: entOwners[i], name: string(abi.encodePacked("pool-", vm.toString(i)))}),
                model
            );
        }

        // plain stakers + the entity owners (registrants), so the floor and the
        // ownership-transfer path are driven from the seed-holding side too
        address[] memory actors = new address[](4 + N);
        actors[0] = makeAddr("alice");
        actors[1] = makeAddr("bob");
        actors[2] = makeAddr("carol");
        actors[3] = makeAddr("dave");
        for (uint256 i = 0; i < N; i++) {
            actors[4 + i] = entOwners[i];
        }

        handler = new SolvencyHandler(staking, entity, N, actors);
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
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

    /// @dev Runs once per sequence. Visible with -vv; shows the post-#82
    ///      actions succeed against the protocol rather than only being called.
    function afterInvariant() public view {
        console.log("ok redelegate / distribute / transfer:", handler.okRedelegate(), handler.okDistribute(), handler.okTransfer());
    }
}
