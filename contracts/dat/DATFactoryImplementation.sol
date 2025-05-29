// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*  OpenZeppelin */
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/finance/VestingWallet.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

import {DATFactoryStorageV1} from "./interfaces/DATFactoryStorageV1.sol";
import {IDAT} from "./interfaces/IDAT.sol";

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
    error DurationTooShort(uint64 duration, uint64 cliff);
    error ZeroOwner();
    error ZeroAmount();
    error ZeroAddress();
    error StartTimeOverflow(uint64 start, uint64 cliff);
    error ZeroStartTime();
    error ZeroDuration();
    error ZeroSalt();
    error ExceedsCap(uint256 total, uint256 cap);
    error CapTooLow();
    error ExcessiveCap();
    error InvalidDefaultCap();
    error InvalidDATType(DATType datType);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address ownerAddress,
        uint256 minCap,
        uint256 maxCap,
        address datImplementation,
        address datVotesImplementation,
        address datPausableImplementation
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        /// @dev Use clones to avoid importing the whole DAT contracts
        datTemplates[DATType.DEFAULT] = datImplementation;
        datTemplates[DATType.VOTES] = datVotesImplementation;
        datTemplates[DATType.PAUSABLE] = datPausableImplementation;

        if (maxCap < minCap || minCap == 0 || maxCap == 0 || maxCap > type(uint208).max) {
            revert InvalidDefaultCap();
        }

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
     * Deploy a VRC-20 + its vesting wallets.
     *
     * Pass `salt = 0x0` for a non-deterministic address.
     */
    function createToken(CreateTokenParams calldata params) external override returns (address tokenAddr) {
        // Validate input parameters
        /// @dev name_ and symbol_ will be validated in the DAT constructor
        if (params.owner == address(0)) revert ZeroOwner();

        /// @dev DAT assumes that zero _cap means type(uint256).max cap
        uint256 cap_ = params.cap;
        if (cap_ == 0) cap_ = maxCapDefault;

        if (cap_ < minCapDefault) revert CapTooLow();
        if (cap_ > maxCapDefault) revert ExcessiveCap();

        // Calculate total vesting amount and validate against cap
        /// @dev cap_ should be always positive here
        uint256 len = params.schedules.length;
        uint256 totalVestingAmount = 0;
        for (uint256 i; i < len; ) {
            /// @dev No need to explicitly check for arithmetic overflow in Solidity 0.8.x
            totalVestingAmount += params.schedules[i].amount;
            unchecked {
                ++i;
            }
        }
        // Check if total amount exceeds cap
        if (totalVestingAmount > cap_) revert ExceedsCap(totalVestingAmount, cap_);

        /* 1 – deploy vesting wallets, gather mint arrays */
        address[] memory receivers = new address[](len);
        uint256[] memory amounts = new uint256[](len);

        for (uint256 i; i < len; ) {
            /* compute schedule adapted to OZ VestingWallet */
            receivers[i] = _deployVesting(params.schedules[i]);
            amounts[i] = params.schedules[i].amount;
            unchecked {
                ++i;
            }
        }

        /* 2 – clone token */
        tokenAddr = (params.salt == bytes32(0))
            ? Clones.clone(datTemplates[params.datType])
            : Clones.cloneDeterministic(datTemplates[params.datType], params.salt);

        _datList.add(tokenAddr);

        /* 3 – initialise token (mints to the wallets) */
        IDAT(tokenAddr).initialize(params.name, params.symbol, params.owner, cap_, receivers, amounts);

        emit DATCreated(tokenAddr, params.salt, params.name, params.symbol, params.owner, cap_);
    }

    /* helper: predict the clone address this factory will deploy */
    function predictAddress(DATType datType, bytes32 salt) external view override returns (address) {
        if (salt == bytes32(0)) revert ZeroSalt();
        return Clones.predictDeterministicAddress(datTemplates[datType], salt);
    }

    /* ---- helper ---- */
    function _deployVesting(VestingParams calldata params) private returns (address wallet) {
        // Validate parameters
        if (params.beneficiary == address(0)) revert ZeroAddress();
        if (params.start == 0) revert ZeroStartTime();
        if (params.duration == 0) revert ZeroDuration();

        // Ensure duration and cliff relationship is valid
        if (params.duration <= params.cliff) revert DurationTooShort(params.duration, params.cliff);
        if (params.amount == 0) revert ZeroAmount();

        // Prevent overflow when adding start + cliff
        if (params.start > type(uint64).max - params.cliff) revert StartTimeOverflow(params.start, params.cliff);

        // Calculate OpenZeppelin VestingWallet parameters
        uint64 startPlusCliff = params.start + params.cliff;
        uint64 postCliffDuration = params.duration - params.cliff;

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
