// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {DepositContractSeeded} from "../../contracts/chain/l1Deposit/DepositContractSeeded.sol";
import {IDeposit} from "../../contracts/chain/l1Deposit/interfaces/IDeposit.sol";
import {ERC165} from "../../contracts/chain/l1Deposit/interfaces/ERC165.sol";

/// @notice Shared fixtures and helpers.
///
/// NOTE ON CHEATCODES: `_depositDataRoot` calls the sha256 precompile, which
/// counts as an external call and would consume a pending `vm.prank` /
/// `vm.expectRevert`. Always compute roots BEFORE arming a cheatcode.
abstract contract DepositSeededBase is Test {
    uint constant TREE_DEPTH = 32;

    /// @dev Deposit root of the canonical empty tree (count = 0).
    bytes32 constant EMPTY_TREE_ROOT =
        0xd70a234731285c6804c2a4f56711ddb8c82c99740f207854891028af34e27e5e;

    address owner = makeAddr("owner");
    address depositor = makeAddr("depositor");

    bytes wc; // withdrawal credentials, 32 bytes
    bytes sig; // BLS signature placeholder, 96 bytes

    function setUp() public virtual {
        wc = _filled(32, 0x22);
        sig = _filled(96, 0x33);
        vm.deal(depositor, 1_000_000 ether);
    }

    // ---------- deployment helpers ----------

    function _deployEmpty() internal returns (DepositContractSeeded) {
        bytes32[TREE_DEPTH] memory branch;
        return new DepositContractSeeded(0, branch, 1 ether, owner, false, new bytes[](0));
    }

    function _deploySeeded(
        uint256 count,
        bytes32[TREE_DEPTH] memory branch
    ) internal returns (DepositContractSeeded) {
        return new DepositContractSeeded(count, branch, 1 ether, owner, false, new bytes[](0));
    }

    // ---------- data helpers ----------

    function _filled(uint len, bytes1 b) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint i = 0; i < len; i++) out[i] = b;
    }

    /// @dev Derive a unique 48-byte pubkey from a seed.
    function _pubkey(uint256 seed) internal pure returns (bytes memory) {
        return bytes.concat(
            keccak256(abi.encode("pk", seed)),
            bytes16(keccak256(abi.encode("pk2", seed)))
        );
    }

    function _le64(uint64 v) internal pure returns (bytes memory ret) {
        ret = new bytes(8);
        bytes8 b = bytes8(v);
        for (uint i = 0; i < 8; i++) ret[i] = b[7 - i];
    }

    /// @dev Mirror of the contract's SSZ DepositData hash-tree-root.
    function _depositDataRoot(
        bytes memory pubkey,
        bytes memory withdrawalCredentials,
        bytes memory signature,
        uint256 valueWei
    ) internal view returns (bytes32) {
        bytes memory amount = _le64(uint64(valueWei / 1 gwei));
        bytes32 pubkeyRoot = sha256(abi.encodePacked(pubkey, bytes16(0)));
        bytes memory sigFirst64 = new bytes(64);
        bytes memory sigLast32 = new bytes(32);
        for (uint i = 0; i < 64; i++) sigFirst64[i] = signature[i];
        for (uint i = 0; i < 32; i++) sigLast32[i] = signature[64 + i];
        bytes32 sigRoot = sha256(
            abi.encodePacked(
                sha256(abi.encodePacked(sigFirst64)),
                sha256(abi.encodePacked(sigLast32, bytes32(0)))
            )
        );
        return sha256(
            abi.encodePacked(
                sha256(abi.encodePacked(pubkeyRoot, withdrawalCredentials)),
                sha256(abi.encodePacked(amount, bytes24(0), sigRoot))
            )
        );
    }

    /// @dev Valid deposit of `valueWei` for pubkey derived from `seed`.
    function _deposit(DepositContractSeeded d, uint256 seed, uint256 valueWei) internal {
        bytes memory pk = _pubkey(seed);
        bytes32 root = _depositDataRoot(pk, wc, sig, valueWei);
        vm.prank(depositor);
        d.deposit{value: valueWei}(pk, wc, sig, root);
    }

    function _count(DepositContractSeeded d) internal view returns (uint64 n) {
        bytes memory le = d.get_deposit_count();
        for (uint i = 0; i < 8; i++) n |= uint64(uint8(le[i])) << uint64(8 * i);
    }

    function _snapshotBranch(
        DepositContractSeeded d
    ) internal view returns (bytes32[TREE_DEPTH] memory branch) {
        for (uint i = 0; i < TREE_DEPTH; i++) branch[i] = d.get_branch(i);
    }

    function _oneKey(bytes memory pk) internal pure returns (bytes[] memory a) {
        a = new bytes[](1);
        a[0] = pk;
    }
}

// ---------------------------------------------------------------------------
// Constructor / seeding
// ---------------------------------------------------------------------------

contract ConstructorTest is DepositSeededBase {
    function test_emptyDeploymentMatchesCanonicalEmptyRoot() public {
        DepositContractSeeded d = _deployEmpty();
        assertEq(d.get_deposit_root(), EMPTY_TREE_ROOT);
        assertEq(_count(d), 0);
    }

    function test_storesConstructorArguments() public {
        bytes32[TREE_DEPTH] memory branch;
        branch[0] = bytes32(uint256(0xAA));
        branch[5] = bytes32(uint256(0xBB));
        bytes memory pk = _pubkey(1);

        DepositContractSeeded d =
            new DepositContractSeeded(7, branch, 3 ether, owner, true, _oneKey(pk));

        assertEq(d.owner(), owner);
        assertEq(d.minDepositAmount(), 3 ether);
        assertTrue(d.restricted());
        assertTrue(d.validators(pk));
        assertEq(_count(d), 7);
        for (uint i = 0; i < TREE_DEPTH; i++) assertEq(d.get_branch(i), branch[i]);
    }

    function test_zeroOwnerReverts() public {
        bytes32[TREE_DEPTH] memory branch;
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0))
        );
        new DepositContractSeeded(0, branch, 1 ether, address(0), false, new bytes[](0));
    }

    function test_supportsInterface() public {
        DepositContractSeeded d = _deployEmpty();
        assertTrue(d.supportsInterface(type(ERC165).interfaceId));
        assertTrue(d.supportsInterface(type(IDeposit).interfaceId));
        // must match the canonical deposit contract's advertised id
        assertEq(type(IDeposit).interfaceId, bytes4(0x85640907));
        assertFalse(d.supportsInterface(bytes4(0xffffffff)));
    }
}

contract SeedingTest is DepositSeededBase {
    /// @dev The core property: seeding a new contract with (count, branch)
    ///      read from a live contract reproduces its deposit root exactly,
    ///      and the two contracts stay in lockstep on subsequent deposits.
    function test_seedReproducesRootAndStaysInLockstep() public {
        DepositContractSeeded source = _deployEmpty();
        for (uint i = 0; i < 5; i++) _deposit(source, i, (i + 1) * 1 ether);

        DepositContractSeeded seeded =
            _deploySeeded(_count(source), _snapshotBranch(source));

        assertEq(seeded.get_deposit_root(), source.get_deposit_root(), "seeded root");
        assertEq(seeded.get_deposit_count(), source.get_deposit_count(), "seeded count");

        // identical next deposits keep the trees identical
        for (uint i = 5; i < 8; i++) {
            _deposit(source, i, 2 ether);
            _deposit(seeded, i, 2 ether);
            assertEq(seeded.get_deposit_root(), source.get_deposit_root(), "post-seed root");
        }
    }

    /// @dev Seeding the count alone (zero branch) yields the WRONG root —
    ///      the failure mode the contract exists to prevent.
    function test_countAloneDoesNotReproduceRoot() public {
        DepositContractSeeded source = _deployEmpty();
        for (uint i = 0; i < 3; i++) _deposit(source, i, 1 ether);

        bytes32[TREE_DEPTH] memory emptyBranch;
        DepositContractSeeded countOnly = _deploySeeded(_count(source), emptyBranch);

        assertTrue(countOnly.get_deposit_root() != source.get_deposit_root());
        assertEq(countOnly.get_deposit_count(), source.get_deposit_count());
    }

    /// @dev Event index continuity: a contract seeded at count N emits its
    ///      first DepositEvent with index N, not 0.
    function test_firstEventIndexContinuesFromSeed() public {
        DepositContractSeeded source = _deployEmpty();
        for (uint i = 0; i < 4; i++) _deposit(source, i, 1 ether);

        DepositContractSeeded seeded =
            _deploySeeded(_count(source), _snapshotBranch(source));

        bytes memory pk = _pubkey(99);
        bytes32 root = _depositDataRoot(pk, wc, sig, 1 ether);
        vm.expectEmit();
        emit IDeposit.DepositEvent(pk, wc, _le64(1e9), sig, _le64(4));
        vm.prank(depositor);
        seeded.deposit{value: 1 ether}(pk, wc, sig, root);
    }

    function testFuzz_seedReproducesRoot(uint8 rawN, uint64 salt) public {
        uint n = bound(rawN, 1, 8);
        DepositContractSeeded source = _deployEmpty();
        for (uint i = 0; i < n; i++) {
            uint amountGwei = bound(
                uint256(keccak256(abi.encode(salt, i))), 1e9, 100e9
            );
            _deposit(source, uint256(salt) + i, amountGwei * 1 gwei);
        }

        DepositContractSeeded seeded =
            _deploySeeded(_count(source), _snapshotBranch(source));
        assertEq(seeded.get_deposit_root(), source.get_deposit_root());

        _deposit(source, uint256(salt) + n, 1 ether);
        _deposit(seeded, uint256(salt) + n, 1 ether);
        assertEq(seeded.get_deposit_root(), source.get_deposit_root());
    }
}

// ---------------------------------------------------------------------------
// deposit() validation
// ---------------------------------------------------------------------------

contract DepositValidationTest is DepositSeededBase {
    DepositContractSeeded d;

    function setUp() public override {
        super.setUp();
        d = _deployEmpty();
    }

    function test_validDepositUpdatesState() public {
        bytes32 rootBefore = d.get_deposit_root();
        _deposit(d, 1, 1 ether);
        assertEq(_count(d), 1);
        assertTrue(d.get_deposit_root() != rootBefore);
        assertEq(address(d).balance, 1 ether);
    }

    function test_emitsDepositEvent() public {
        bytes memory pk = _pubkey(1);
        bytes32 root = _depositDataRoot(pk, wc, sig, 5 ether);
        vm.expectEmit();
        emit IDeposit.DepositEvent(pk, wc, _le64(5e9), sig, _le64(0));
        vm.prank(depositor);
        d.deposit{value: 5 ether}(pk, wc, sig, root);
    }

    function test_rejectsBadPubkeyLength() public {
        vm.prank(depositor);
        vm.expectRevert("DepositContract: invalid pubkey length");
        d.deposit{value: 1 ether}(_filled(47, 0x11), wc, sig, bytes32(0));
    }

    function test_rejectsBadWithdrawalCredentialsLength() public {
        vm.prank(depositor);
        vm.expectRevert("DepositContract: invalid withdrawal_credentials length");
        d.deposit{value: 1 ether}(_pubkey(1), _filled(31, 0x22), sig, bytes32(0));
    }

    function test_rejectsBadSignatureLength() public {
        vm.prank(depositor);
        vm.expectRevert("DepositContract: invalid signature length");
        d.deposit{value: 1 ether}(_pubkey(1), wc, _filled(95, 0x33), bytes32(0));
    }

    function test_rejectsValueBelowMinimum() public {
        vm.prank(depositor);
        vm.expectRevert("DepositContract: deposit value too low");
        d.deposit{value: 1 ether - 1 gwei}(_pubkey(1), wc, sig, bytes32(0));
    }

    function test_rejectsNonGweiMultiple() public {
        vm.prank(depositor);
        vm.expectRevert("DepositContract: deposit value not multiple of gwei");
        d.deposit{value: 1 ether + 1}(_pubkey(1), wc, sig, bytes32(0));
    }

    function test_rejectsValueAboveUint64Gwei() public {
        uint256 tooHigh = (uint256(type(uint64).max) + 1) * 1 gwei;
        vm.deal(depositor, tooHigh);
        vm.prank(depositor);
        vm.expectRevert("DepositContract: deposit value too high");
        d.deposit{value: tooHigh}(_pubkey(1), wc, sig, bytes32(0));
    }

    function test_rejectsWrongDepositDataRoot() public {
        bytes memory pk = _pubkey(1);
        bytes32 wrongRoot = _depositDataRoot(pk, wc, sig, 2 ether); // root for a different amount
        vm.prank(depositor);
        vm.expectRevert(
            "DepositContract: reconstructed DepositData does not match supplied deposit_data_root"
        );
        d.deposit{value: 1 ether}(pk, wc, sig, wrongRoot);
    }

    function testFuzz_acceptsAnyValidAmount(uint256 rawGwei) public {
        uint256 amountGwei = bound(rawGwei, 1e9, 1_000_000e9);
        _deposit(d, 42, amountGwei * 1 gwei);
        assertEq(_count(d), 1);
    }
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

contract OwnershipTest is DepositSeededBase {
    DepositContractSeeded d;
    address newOwner = makeAddr("newOwner");

    function setUp() public override {
        super.setUp();
        d = _deployEmpty();
    }

    function test_twoStepTransfer() public {
        vm.prank(owner);
        d.transferOwnership(newOwner);
        assertEq(d.owner(), owner, "unchanged until accepted");
        assertEq(d.pendingOwner(), newOwner);

        vm.prank(newOwner);
        d.acceptOwnership();
        assertEq(d.owner(), newOwner);
        assertEq(d.pendingOwner(), address(0));
    }

    function test_onlyPendingOwnerCanAccept() public {
        vm.prank(owner);
        d.transferOwnership(newOwner);
        vm.prank(depositor);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, depositor)
        );
        d.acceptOwnership();
    }

    function test_renounceLeavesNoOwnerAndFreezesAdmin() public {
        vm.prank(owner);
        d.renounceOwnership();
        assertEq(d.owner(), address(0));

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner)
        );
        d.updateMinDepositAmount(2 ether);
    }

    function test_renounceClearsPendingTransfer() public {
        vm.startPrank(owner);
        d.transferOwnership(newOwner);
        d.renounceOwnership();
        vm.stopPrank();
        assertEq(d.pendingOwner(), address(0));

        vm.prank(newOwner);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, newOwner)
        );
        d.acceptOwnership();
    }

    function test_depositsUnaffectedByRenounce() public {
        vm.prank(owner);
        d.renounceOwnership();
        _deposit(d, 1, 1 ether);
        assertEq(_count(d), 1);
    }
}

// ---------------------------------------------------------------------------
// minDepositAmount
// ---------------------------------------------------------------------------

contract MinDepositAmountTest is DepositSeededBase {
    DepositContractSeeded d;

    function setUp() public override {
        super.setUp();
        d = _deployEmpty();
    }

    function test_ownerCanUpdate_withEvent() public {
        vm.expectEmit();
        emit DepositContractSeeded.MinDepositAmountUpdated(5 ether);
        vm.prank(owner);
        d.updateMinDepositAmount(5 ether);
        assertEq(d.minDepositAmount(), 5 ether);
    }

    function test_nonOwnerCannotUpdate() public {
        vm.prank(depositor);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, depositor)
        );
        d.updateMinDepositAmount(5 ether);
    }

    function test_boundaryIsInclusive() public {
        vm.prank(owner);
        d.updateMinDepositAmount(2 ether);

        _deposit(d, 1, 2 ether); // exactly the minimum passes

        bytes memory pk = _pubkey(2);
        bytes32 root = _depositDataRoot(pk, wc, sig, 2 ether - 1 gwei);
        vm.prank(depositor);
        vm.expectRevert("DepositContract: deposit value too low");
        d.deposit{value: 2 ether - 1 gwei}(pk, wc, sig, root);
    }

    function test_updateAppliesToSubsequentDepositsOnly() public {
        _deposit(d, 1, 1 ether);
        vm.prank(owner);
        d.updateMinDepositAmount(10 ether);

        bytes memory pk = _pubkey(2);
        bytes32 root = _depositDataRoot(pk, wc, sig, 1 ether);
        vm.prank(depositor);
        vm.expectRevert("DepositContract: deposit value too low");
        d.deposit{value: 1 ether}(pk, wc, sig, root);
        assertEq(_count(d), 1, "earlier deposit unaffected");
    }
}

// ---------------------------------------------------------------------------
// Restricted mode
// ---------------------------------------------------------------------------

contract RestrictedModeTest is DepositSeededBase {
    DepositContractSeeded d;
    bytes pkAllowed;
    bytes pkOther;

    function setUp() public override {
        super.setUp();
        d = _deployEmpty();
        pkAllowed = _pubkey(1);
        pkOther = _pubkey(2);
    }

    function _depositKey(bytes memory pk) internal {
        bytes32 root = _depositDataRoot(pk, wc, sig, 1 ether);
        vm.prank(depositor);
        d.deposit{value: 1 ether}(pk, wc, sig, root);
    }

    function _expectNotAllowed(bytes memory pk) internal {
        bytes32 root = _depositDataRoot(pk, wc, sig, 1 ether);
        vm.prank(depositor);
        vm.expectRevert("DepositContract: publicKey not allowed");
        d.deposit{value: 1 ether}(pk, wc, sig, root);
    }

    function test_openByDefault() public {
        assertFalse(d.restricted());
        _depositKey(pkOther); // unlisted key deposits fine
    }

    function test_restrictedBlocksUnlistedKey() public {
        vm.prank(owner);
        d.updateRestricted(true);
        _expectNotAllowed(pkOther);
    }

    function test_restrictedPermitsAllowedKeyOnly() public {
        vm.startPrank(owner);
        d.updateRestricted(true);
        d.addAllowedValidators(_oneKey(pkAllowed));
        vm.stopPrank();

        _depositKey(pkAllowed);
        _expectNotAllowed(pkOther);
    }

    function test_allowedKeyMayDepositRepeatedly() public {
        vm.startPrank(owner);
        d.updateRestricted(true);
        d.addAllowedValidators(_oneKey(pkAllowed));
        vm.stopPrank();

        _depositKey(pkAllowed);
        _depositKey(pkAllowed);
        assertEq(_count(d), 2);
    }

    function test_removeRevokesAccess() public {
        vm.startPrank(owner);
        d.updateRestricted(true);
        d.addAllowedValidators(_oneKey(pkAllowed));
        d.removeAllowedValidators(_oneKey(pkAllowed));
        vm.stopPrank();

        assertFalse(d.validators(pkAllowed));
        _expectNotAllowed(pkAllowed);
    }

    function test_allowlistIgnoredWhileOpen() public {
        vm.prank(owner);
        d.addAllowedValidators(_oneKey(pkAllowed));
        _depositKey(pkOther); // unlisted, mode open
    }

    function test_disablingRestrictionReopensDeposits() public {
        vm.startPrank(owner);
        d.updateRestricted(true);
        d.updateRestricted(false);
        vm.stopPrank();
        _depositKey(pkOther);
    }

    function test_batchAddRemove_withEvents() public {
        bytes[] memory keys = new bytes[](2);
        keys[0] = pkAllowed;
        keys[1] = pkOther;

        vm.expectEmit();
        emit DepositContractSeeded.AllowedValidatorsAdded(pkAllowed);
        vm.expectEmit();
        emit DepositContractSeeded.AllowedValidatorsAdded(pkOther);
        vm.prank(owner);
        d.addAllowedValidators(keys);
        assertTrue(d.validators(pkAllowed));
        assertTrue(d.validators(pkOther));

        vm.expectEmit();
        emit DepositContractSeeded.AllowedValidatorsRemoved(pkAllowed);
        vm.expectEmit();
        emit DepositContractSeeded.AllowedValidatorsRemoved(pkOther);
        vm.prank(owner);
        d.removeAllowedValidators(keys);
        assertFalse(d.validators(pkAllowed));
        assertFalse(d.validators(pkOther));
    }

    function test_updateRestrictedEmitsEvent() public {
        vm.expectEmit();
        emit DepositContractSeeded.RestrictedUpdated(true);
        vm.prank(owner);
        d.updateRestricted(true);
    }

    function test_controlsAreOwnerOnly() public {
        vm.startPrank(depositor);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, depositor)
        );
        d.updateRestricted(true);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, depositor)
        );
        d.addAllowedValidators(_oneKey(pkAllowed));
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, depositor)
        );
        d.removeAllowedValidators(_oneKey(pkAllowed));
        vm.stopPrank();
    }

    function test_deployAlreadyRestrictedWithSeedList() public {
        bytes32[TREE_DEPTH] memory branch;
        DepositContractSeeded r =
            new DepositContractSeeded(0, branch, 1 ether, owner, true, _oneKey(pkAllowed));
        assertTrue(r.restricted());
        assertTrue(r.validators(pkAllowed));
        assertFalse(r.validators(pkOther));
    }
}

// ---------------------------------------------------------------------------
// Vana mainnet seed snapshot
// ---------------------------------------------------------------------------

/// @notice Seeds the contract with the real, final state of the original Vana
///         mainnet deposit contract and checks the root is reproduced exactly.
///
///         Source: proxy 0x17BbE91c315Bf14f38F6D35052a827cadfFe184e (chain 1480).
///         That contract was disabled at block 9,475,269 by upgrading it to a
///         revert-all implementation (0xabc8637b553635654539b19d6cb53d64d4274325),
///         so its storage is frozen forever and these hard-coded values are
///         stable: `branch` read via eth_getStorageAt slots 0..31, count from
///         slot 32, and the expected root/count from an archive call at block
///         9,475,268 -- the last block the old implementation answered.
contract MainnetSeedTest is DepositSeededBase {
    address constant MAINNET_DEPOSIT_CONTRACT = 0x17BbE91c315Bf14f38F6D35052a827cadfFe184e;
    uint256 constant MAINNET_DEPOSIT_COUNT = 32;
    bytes32 constant MAINNET_DEPOSIT_ROOT =
        0x60dff8f6a92d68799e7653acdcefa253a1c2603b4dd071d8265491b465172401;

    function _mainnetBranch() internal pure returns (bytes32[TREE_DEPTH] memory branch) {
        // count = 32 = 0b100000, so only branch[5] feeds the root; slots 0..4
        // hold stale values from earlier deposits and are copied for fidelity.
        branch[0] = 0xf0092552cdb7afcba0eb4e5cfed7fefed2ce6382824cd5b0df010651c1696432;
        branch[1] = 0xe30a60e758e63fec18949b8acf3fe2b19f8245397e67218bd9f5ff752a26a960;
        branch[2] = 0x88ff06e39ba53cd7fdfd337cc4005c3656833cf88cea7821231e412c954f74f7;
        branch[3] = 0x941faed977cc7348cd7f286e8bfdf223404c649bfa5c70b15e7bfd3e8f567d14;
        branch[4] = 0x8d72689445263059145597c22f9709ae40f79254492fbb527f98ceef94517fb4;
        branch[5] = 0x623286af5249c193c954b552e1b1b8894896945d6878a4d0f2d982fa99c1cae0;
        // branch[6..31] are zero on mainnet
    }

    function _deployMainnetSeeded() internal returns (DepositContractSeeded) {
        return new DepositContractSeeded(
            MAINNET_DEPOSIT_COUNT, _mainnetBranch(), 1 ether, owner, false, new bytes[](0)
        );
    }

    function test_reproducesMainnetRootAndCount() public {
        DepositContractSeeded d = _deployMainnetSeeded();
        assertEq(d.get_deposit_root(), MAINNET_DEPOSIT_ROOT, "mainnet root");
        assertEq(d.get_deposit_count(), _le64(32), "mainnet count");
        for (uint i = 0; i < TREE_DEPTH; i++) {
            assertEq(d.get_branch(i), _mainnetBranch()[i], "branch slot");
        }
    }

    function test_depositsContinueFromMainnetState() public {
        DepositContractSeeded d = _deployMainnetSeeded();

        // the first post-migration deposit must be indexed 32, not 0
        bytes memory pk = _pubkey(1);
        bytes32 root = _depositDataRoot(pk, wc, sig, 35_000 ether);
        vm.expectEmit();
        emit IDeposit.DepositEvent(pk, wc, _le64(35_000e9), sig, _le64(32));
        vm.prank(depositor);
        d.deposit{value: 35_000 ether}(pk, wc, sig, root);

        assertEq(_count(d), 33);
        assertTrue(d.get_deposit_root() != MAINNET_DEPOSIT_ROOT, "root advanced");
    }
}
