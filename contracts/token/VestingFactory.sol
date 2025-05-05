// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/* ─── OpenZeppelin ─── */
import {AccessControl}       from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard}     from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/* ─── Wallet templates ─── */
import {LinearVestingWallet}  from "./vestingWallet/LinearVestingWallet.sol";
import {CliffVestingWallet}   from "./vestingWallet/CliffVestingWallet.sol";
import {NoVestingWallet} from "./vestingWallet/NoVestingWallet.sol";


/* ─── DAT token interface (mint only) ─── */
interface IDAT {
    function mint(address to, uint256 amount) external;
    function MINTER_ROLE() external view returns (bytes32);
}


/**
 * @title  VestingFactory
 * @notice Sole minter of DAT; deploys vesting wallets and seeds them.
 */
contract VestingFactory is AccessControl, ReentrancyGuard {
    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");
    IDAT    public immutable token;
    uint64 public constant MIN_LINEAR_DURATION = 30 days;
    uint64 public constant MIN_CLIFF_DURATION  = 30 days;

    event VestingCreated(
        address indexed wallet,
        address indexed beneficiary,
        uint256 amount,
        string  scheduleType
    );

    error DurationTooShort(uint64 provided, uint64 minimum);
    error CliffTooLong(uint64 cliff, uint64 total);

    constructor(IDAT dat) {
        token = dat;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(CREATOR_ROLE,       msg.sender);
    }

    /* ---------- linear schedule ---------- */
    function createLinearVesting(
        address beneficiary,
        uint256 amount,
        uint64  start,
        uint64  duration
    ) external onlyRole(CREATOR_ROLE) nonReentrant returns (address wallet) {
        if (duration < MIN_LINEAR_DURATION) {
            revert DurationTooShort(duration, MIN_LINEAR_DURATION);
        }

        wallet = address(new LinearVestingWallet(beneficiary, start, duration));
        token.mint(wallet, amount);
        emit VestingCreated(wallet, beneficiary, amount, "LINEAR");
    }


    /* ---------- cliff  + linear schedule ---------- */
    function createCliffVesting(
        address beneficiary,
        uint256 amount,
        uint64  start,
        uint64  cliffDuration,
        uint64  totalDuration
    ) external onlyRole(CREATOR_ROLE) nonReentrant returns (address wallet) {
        if (cliffDuration < MIN_CLIFF_DURATION) {
            revert DurationTooShort(cliffDuration, MIN_CLIFF_DURATION);
        }
        if (cliffDuration >= totalDuration) {
            revert CliffTooLong(cliffDuration, totalDuration);
        }

        wallet = address(
            new CliffVestingWallet(beneficiary, start, cliffDuration, totalDuration)
        );
        token.mint(wallet, amount);
        emit VestingCreated(wallet, beneficiary, amount, "CLIFF");
    }

    /* ---------- instant grant (no vesting) ---------- */
    function createNoVesting(
        address beneficiary,
        uint256 amount
    ) external onlyRole(CREATOR_ROLE) nonReentrant returns (address wallet) {
        wallet = address(new NoVestingWallet(beneficiary));
        token.mint(wallet, amount);
        emit VestingCreated(wallet, beneficiary, amount, "UNLOCKED");
    }
}