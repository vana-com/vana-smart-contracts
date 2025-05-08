// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*  OpenZeppelin */
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/finance/VestingWallet.sol";

/*  Local */
import "./DAT.sol";

/* Import error types */
import {ZeroAmount, ZeroAddress, ExcessiveCap} from "./DAT.sol";

contract DATFactory {
    /* ───── custom errors ───── */
    error ZeroSalt();
    error DurationTooShort(uint64 duration, uint64 cliff);
    error EmptyName();
    error EmptySymbol();
    error ZeroOwner();
    error StartTimeOverflow(uint64 start, uint64 cliff);
    error ZeroStartTime();
    error ZeroDuration();
    error InvalidArrayLengths();
    error ParameterOverflow(string paramName, uint256 value, uint256 max);
    error TotalAmountOverflow(uint256 current, uint256 toAdd);
    error ExceedsCap(uint256 total, uint256 cap);
    error PostCliffDurationOverflow(uint64 duration, uint64 cliff);

    /* one immutable logic contract */
    address public immutable implementation;

    constructor() {
        implementation = address(new DAT());
    }

    /* ─────────── vesting input ─────────── */
    struct VestingParams {
        address beneficiary;   // receiver
        uint64  start;         // unix, token generation event
        uint64  cliff;         // seconds after start before first release
        uint64  duration;      // TOTAL seconds for vesting period INCLUDING cliff
        uint256 amount;        // token units
    }

    event DATCreated(
        address indexed token,
        bytes32 indexed salt,
        string  name,
        string  symbol,
        address owner,
        uint256 cap
    );

    event VestingWalletCreated(
        address indexed wallet,
        address indexed beneficiary,
        uint64  start,
        uint64  cliff,
        uint64  duration,
        uint256 amount
    );

    /**
     * Deploy a VRC-20 clone + its vesting wallets.
     *
     * Pass `salt = 0x0` for a non-deterministic address.
     */
    function createToken(
        string          calldata name_,
        string          calldata symbol_,
        address         owner_,
        uint256         cap_,
        VestingParams[] calldata schedules,
        bytes32         salt
    ) external returns (address tokenAddr) {
        // Validate input parameters
        if (bytes(name_).length == 0) revert EmptyName();
        if (bytes(symbol_).length == 0) revert EmptySymbol();
        if (owner_ == address(0)) revert ZeroOwner();
        
        // Validate cap - reuse the same validation from DAT.sol for consistency
        if (cap_ == 1) revert CapTooLow();
        if (cap_ > type(uint128).max) revert ExcessiveCap(cap_);
        
        // Calculate total vesting amount and validate against cap
        if (cap_ > 0 && schedules.length > 0) {
            uint256 totalVestingAmount = 0;
            for (uint256 i = 0; i < schedules.length; i++) {
                // Check for arithmetic overflow
                if (totalVestingAmount > type(uint256).max - schedules[i].amount) 
                    revert TotalAmountOverflow(totalVestingAmount, schedules[i].amount);
                totalVestingAmount += schedules[i].amount;
            }
            
            // Check if total amount exceeds cap
            if (totalVestingAmount > cap_) 
                revert ExceedsCap(totalVestingAmount, cap_);
        }
        
        /* 1 – clone token */
        tokenAddr = (salt == bytes32(0))
            ? Clones.clone(implementation)
            : Clones.cloneDeterministic(implementation, salt);

        /* 2 – deploy vesting wallets, gather mint arrays */
        uint256 len = schedules.length;
        address[] memory receivers = new address[](len);
        uint256[] memory amounts   = new uint256[](len);

        for (uint256 i; i < len; ++i) {
            /* compute schedule adapted to OZ VestingWallet */
            address wallet   = _deployVesting(schedules[i]);
            receivers[i]     = wallet;
            amounts[i]       = schedules[i].amount;
        }

        /* 3 – initialise token (mints to the wallets) */
        DAT(tokenAddr).initialize(
            name_,
            symbol_,
            owner_,
            cap_,
            receivers,
            amounts
        );
        emit DATCreated(tokenAddr, salt, name_, symbol_, owner_, cap_);
    }

    /* helper: predict the clone address this factory will deploy */
    function predictAddress(bytes32 salt)
        external
        view
        returns (address)
    {
        if (salt == bytes32(0)) revert ZeroSalt();
        return Clones.predictDeterministicAddress(implementation, salt);
    }

    /* ---- helper ---- */
    function _deployVesting(VestingParams calldata s)
        private
        returns (address wallet)
    {
        // Validate parameters
        if (s.beneficiary == address(0)) revert ZeroAddress();
        if (s.start == 0) revert ZeroStartTime();
        if (s.duration == 0) revert ZeroDuration();
        
        // Prevent parameter overflows
        if (s.duration > type(uint64).max) revert ParameterOverflow("duration", s.duration, type(uint64).max);
        if (s.start > type(uint64).max) revert ParameterOverflow("start", s.start, type(uint64).max);
        if (s.cliff > type(uint64).max) revert ParameterOverflow("cliff", s.cliff, type(uint64).max);
        
        // Ensure duration and cliff relationship is valid
        if (s.duration <= s.cliff) revert DurationTooShort(s.duration, s.cliff);
        if (s.amount == 0) revert ZeroAmount();
        
        // Prevent overflow when adding start + cliff
        if (s.start > type(uint64).max - s.cliff) revert StartTimeOverflow(s.start, s.cliff);
        
        // Calculate OpenZeppelin VestingWallet parameters
        uint64 startPlusCliff = s.start + s.cliff;
        uint64 postCliffDuration = s.duration - s.cliff;
        
        // Ensure postCliffDuration is valid and won't cause problems in VestingWallet
        // This is redundant with the duration > cliff check above, but adds a specific error type
        if (postCliffDuration == 0) revert PostCliffDurationOverflow(s.duration, s.cliff);
        
        wallet = address(
            new VestingWallet(s.beneficiary, startPlusCliff, postCliffDuration)
        );
        
        emit VestingWalletCreated(
            wallet,
            s.beneficiary,
            s.start,
            s.cliff,
            s.duration,
            s.amount
        );
    }
}
