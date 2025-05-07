// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*  OpenZeppelin */
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/finance/VestingWallet.sol";

/*  Local */
import "./DAT.sol";

contract DATFactory {
    /* one immutable logic contract */
    address public immutable implementation;

    constructor() {
        implementation = address(new DAT());
    }

    /* ─────────── vesting input ─────────── */
    struct VestingParams {
        address beneficiary;   // receiver
        uint64  start;         // unix, token generation event
        uint64  end;           // unix, final unlock (≥ start)
        uint64  cliff;         // seconds after start before first release
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
        uint64  end,
        uint64  cliff,
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
        require(salt != bytes32(0), "DATFactory: salt is zero");
        return Clones.predictDeterministicAddress(implementation, salt);
    }

    /* ---- helper ---- */
    function _deployVesting(VestingParams calldata s)
        private
        returns (address wallet)
    {
        uint64 startPlusCliff = s.start + s.cliff;
        uint64 duration       = (s.end <= startPlusCliff)
            ? 1
            : s.end - startPlusCliff;

        wallet = address(
            new VestingWallet(s.beneficiary, startPlusCliff, duration)
        );

        emit VestingWalletCreated(
            wallet,
            s.beneficiary,
            s.start,
            s.end,
            s.cliff,
            s.amount
        );
    }
}
