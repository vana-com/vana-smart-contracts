// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*  OpenZeppelin */
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/finance/VestingWallet.sol";

import "./DAT.sol";

/* Import error types */
import {ZeroAmount, ZeroAddress} from "./DAT.sol";
import {DATFactoryStorageV1} from "./interfaces/DATFactoryStorageV1.sol";

contract DATFactoryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    DATFactoryStorageV1
{
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    event DATCreated(
        address indexed token,
        bytes32 indexed salt,
        string name,
        string symbol,
        address owner,
        uint256 cap
    );

    event VestingWalletCreated(
        address indexed wallet,
        address indexed beneficiary,
        uint64 start,
        uint64 cliff,
        uint64 duration,
        uint256 amount
    );

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
    error CapTooLow();
    error ExcessiveCap();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address ownerAddress, uint256 minCap, uint256 maxCap) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        datTemplates[DATType.DEFAULT] = address(new DAT());

        minCapDefault = minCap;
        maxCapDefault = maxCap;

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function datListValues() external view override returns (address[] memory) {
        return _datList.values();
    }

    function datListCount() external view override returns (uint256) {
        return _datList.length();
    }

    function datListAt(uint256 index) external view override returns (address) {
        return _datList.at(index);
    }

    /**
     * Deploy a VRC-20 clone + its vesting wallets.
     *
     * Pass `salt = 0x0` for a non-deterministic address.
     */
    function createToken(
        string calldata name_,
        string calldata symbol_,
        address owner_,
        uint256 cap_,
        VestingParams[] calldata schedules,
        bytes32 salt
    ) external override returns (address tokenAddr) {
        // Validate input parameters
        if (bytes(name_).length == 0) revert EmptyName();
        if (bytes(symbol_).length == 0) revert EmptySymbol();
        if (owner_ == address(0)) revert ZeroOwner();

        if (cap_ < minCapDefault) revert CapTooLow();
        if (cap_ > maxCapDefault) revert ExcessiveCap();

        // Validate cap - reuse the same validation from DAT.sol for consistency
        //        if (cap_ == 1) revert CapTooLow();
        //        if (cap_ > type(uint128).max) revert ExcessiveCap(cap_);

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
            if (totalVestingAmount > cap_) revert ExceedsCap(totalVestingAmount, cap_);
        }

        /* 1 – clone token */
        tokenAddr = (salt == bytes32(0))
            ? Clones.clone(datTemplates[DATType.DEFAULT])
            : Clones.cloneDeterministic(datTemplates[DATType.DEFAULT], salt);

        //todo: check if we can remove the EIP-1967 and introduce a standard deployment
        //        tokenAddr = address(new DAT());

        _datList.add(tokenAddr);

        /* 2 – deploy vesting wallets, gather mint arrays */
        uint256 len = schedules.length;
        address[] memory receivers = new address[](len);
        uint256[] memory amounts = new uint256[](len);

        for (uint256 i; i < len; ++i) {
            /* compute schedule adapted to OZ VestingWallet */
            address wallet = _deployVesting(schedules[i]);
            receivers[i] = wallet;
            amounts[i] = schedules[i].amount;
        }

        /* 3 – initialise token (mints to the wallets) */
        DAT(tokenAddr).initialize(name_, symbol_, owner_, cap_, receivers, amounts);
        emit DATCreated(tokenAddr, salt, name_, symbol_, owner_, cap_);
    }

    /* helper: predict the clone address this factory will deploy */
    function predictAddress(bytes32 salt) external view override returns (address) {
        if (salt == bytes32(0)) revert ZeroSalt();
        return Clones.predictDeterministicAddress(datTemplates[DATType.DEFAULT], salt);
    }

    /* ---- helper ---- */
    function _deployVesting(VestingParams calldata params) private returns (address wallet) {
        // Validate parameters
        if (params.beneficiary == address(0)) revert ZeroAddress();
        if (params.start == 0) revert ZeroStartTime();
        if (params.duration == 0) revert ZeroDuration();

        // Prevent parameter overflows
        if (params.duration > type(uint64).max) revert ParameterOverflow("duration", params.duration, type(uint64).max);
        if (params.start > type(uint64).max) revert ParameterOverflow("start", params.start, type(uint64).max);
        if (params.cliff > type(uint64).max) revert ParameterOverflow("cliff", params.cliff, type(uint64).max);

        // Ensure duration and cliff relationship is valid
        if (params.duration <= params.cliff) revert DurationTooShort(params.duration, params.cliff);
        if (params.amount == 0) revert ZeroAmount();

        // Prevent overflow when adding start + cliff
        if (params.start > type(uint64).max - params.cliff) revert StartTimeOverflow(params.start, params.cliff);

        // Calculate OpenZeppelin VestingWallet parameters
        uint64 startPlusCliff = params.start + params.cliff;
        uint64 postCliffDuration = params.duration - params.cliff;

        // Ensure postCliffDuration is valid and won't cause problems in VestingWallet
        // This is redundant with the duration > cliff check above, but adds a specific error type
        if (postCliffDuration == 0) revert PostCliffDurationOverflow(params.duration, params.cliff);

        wallet = address(new VestingWallet(params.beneficiary, startPlusCliff, postCliffDuration));

        emit VestingWalletCreated(
            wallet,
            params.beneficiary,
            params.start,
            params.cliff,
            params.duration,
            params.amount
        );
    }
}
