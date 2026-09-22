// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVanaPoolEntity} from "../vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/**
 * @notice Splits a VANA reward budget across VanaPool entities in proportion to
 *         their stake-seconds accrued since the previous distribution -- i.e. by
 *         committed stake over time, not a snapshot. Each entity's share is paid
 *         via addRewards, so the entity then vests it to its own stakers under
 *         its own model (APY or STREAM). The splitter holds a VANA balance
 *         (funded by governance) and pays out of it.
 */
contract RewardSplitterImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // Burn rate is percent * 1e18 (matching maxAPY / commission), so 100% == this.
    uint256 public constant MAX_BURN_RATE = 100e18;

    // The burn cut is sent to the zero address, which permanently removes the
    // VANA from circulation. No dedicated burn/sink address is configured.
    address public constant BURN_ADDRESS = address(0);

    IVanaPoolEntity public vanaPoolEntity;

    // last stake-seconds reading taken for an entity (the round baseline)
    mapping(uint256 entityId => uint256 stakeSeconds) public baseline;
    // whether an entity has been seen before (distinguishes "baseline 0" from unset)
    mapping(uint256 entityId => bool) public seen;

    // Burn: this fraction of each distributed budget is set aside before the
    // remainder is split across entities. distribute() only accrues it into
    // pendingBurn; executeBurn() sends it to BURN_ADDRESS (the zero address).
    uint256 public burnRate; // percent * 1e18; 0 = no burn
    uint256 public pendingBurn; // wei accrued for burning, not yet sent

    // --- ERC-20 reward inlet (appended; append-safe for UUPS) ---
    // There is no on-chain swap. ERC-20 rewards are funded here, handed to a
    // trusted off-chain converter, and returned as native VANA (via receive())
    // to be distributed by the existing native path. pendingConversion is the
    // record of tokens held but not yet sent to the converter.
    address public converter;
    mapping(address token => uint256 amount) public pendingConversion;

    // Whether entity payouts pay the entity owner's commission cut. Passed to
    // addStakerRewards, which vests to delegators and (when true) skims the owner's
    // cut up front at the current rate. Governance-toggled.
    bool public payEntityCommission;

    // Linear vesting span (seconds) for each entity payout on the entity's
    // owner-proof splitter track. Must be set explicitly before distributing;
    // there is no default, so a payout can never be an unintended instant release.
    uint32 public rewardVestingDuration;

    event Distributed(uint256 indexed entityId, uint256 amount, uint256 weight);
    event RoundDistributed(uint256 budget, uint256 totalWeight, uint256 entityCount);
    event BurnAccrued(uint256 amount, uint256 pendingBurn);
    event Burned(uint256 amount);
    event BurnRateUpdated(uint256 burnRate);
    event PayEntityCommissionUpdated(bool value);
    event RewardVestingDurationUpdated(uint32 duration);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event ConverterUpdated(address indexed converter);
    event TokenRewardFunded(address indexed token, address indexed from, uint256 amount);
    event SentToConverter(address indexed token, address indexed to, uint256 amount);
    event TokenRecovered(address indexed token, address indexed to, uint256 amount);

    error InvalidAddress();
    error InvalidBudget();
    error InvalidBurnRate();
    error TransferFailed();
    error InvalidAmount();
    error VestingDurationNotSet();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address ownerAddress, address vanaPoolEntityAddress) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        if (ownerAddress == address(0) || vanaPoolEntityAddress == address(0)) {
            revert InvalidAddress();
        }

        vanaPoolEntity = IVanaPoolEntity(vanaPoolEntityAddress);
        payEntityCommission = true; // default: pay the entity owner's commission cut

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
        _grantRole(DISTRIBUTOR_ROLE, ownerAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /// @notice Fund the splitter's distributable balance.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    /**
     * @notice Fund an ERC-20 reward. Pulls `amount` of `token` from the caller
     *         (who must have approved this contract) and records it in
     *         pendingConversion. There is no on-chain swap: the tokens wait here
     *         until a maintainer forwards them to the converter, which swaps them
     *         off-chain and returns native VANA to receive() for distribution.
     *         Permissionless, mirroring the native receive() inlet.
     * @param token  ERC-20 reward token
     * @param amount amount to pull from the caller
     */
    function fundTokenReward(address token, uint256 amount) external nonReentrant whenNotPaused {
        if (token == address(0)) {
            revert InvalidAddress();
        }
        if (amount == 0) {
            revert InvalidAmount();
        }
        // Record exactly what arrives, so fee-on-transfer tokens can't leave
        // pendingConversion overstating the real balance.
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - balanceBefore;

        pendingConversion[token] += received;
        emit TokenRewardFunded(token, msg.sender, received);
    }

    /// @notice Set the trusted converter that swaps ERC-20 rewards to VANA
    ///         off-chain and returns the VANA to this contract.
    function updateConverter(address newConverter) external onlyRole(MAINTAINER_ROLE) {
        if (newConverter == address(0)) {
            revert InvalidAddress();
        }
        converter = newConverter;
        emit ConverterUpdated(newConverter);
    }

    /**
     * @notice Forward recorded ERC-20 rewards to the converter for off-chain
     *         swapping to VANA. The converter is trusted to return native VANA to
     *         receive(); this contract holds no on-chain guarantee it will, so
     *         only a maintainer may call, and only to the configured converter.
     * @param token  ERC-20 reward token
     * @param amount amount to forward (<= pendingConversion[token])
     */
    function sendToConverter(address token, uint256 amount) external onlyRole(MAINTAINER_ROLE) nonReentrant {
        if (converter == address(0)) {
            revert InvalidAddress();
        }
        if (amount == 0) {
            revert InvalidAmount();
        }
        if (amount > pendingConversion[token]) {
            revert InvalidBudget();
        }
        pendingConversion[token] -= amount; // effects before interaction
        IERC20(token).safeTransfer(converter, amount);
        emit SentToConverter(token, converter, amount);
    }

    /**
     * @notice Split `budget` across `entityIds` by their stake-seconds accrued
     *         since the previous distribution (the delta from each entity's
     *         baseline -- absolute stake-seconds would re-pay all past rounds and
     *         let old/empty pools dominate). A first-seen entity only has its
     *         baseline recorded (it earns from the next round); flash stake
     *         integrates to ~0 weight; only a pool's own stakers can reduce its
     *         weight, so no third party can skew the split.
     *
     * @param budget      wei to distribute (<= the splitter's balance)
     * @param entityIds   entities to split across
     */
    function distribute(
        uint256 budget,
        uint256[] calldata entityIds
    ) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant whenNotPaused {
        // The vesting duration must be set explicitly; no default, so a payout is
        // never an unintended instant release.
        if (rewardVestingDuration == 0) {
            revert VestingDurationNotSet();
        }
        // pendingBurn is reserved; a distribution can only use the free balance.
        if (budget == 0 || budget > address(this).balance - pendingBurn) {
            revert InvalidBudget();
        }

        uint256 n = entityIds.length;
        uint256[] memory current = new uint256[](n);
        uint256[] memory weights = new uint256[](n);
        uint256 totalWeight;

        // Pass 1: read each entity's cumulative stake-seconds; its weight is the
        // growth since the last distribution (its baseline).
        for (uint256 i = 0; i < n; i++) {
            uint256 id = entityIds[i];
            uint256 s = vanaPoolEntity.stakeSecondsAt(id);
            current[i] = s;

            if (!seen[id]) {
                seen[id] = true; // first sight: baseline only, weight 0 (earns next round)
                weights[i] = 0;
            } else {
                weights[i] = s - baseline[id]; // monotone, so never underflows
                totalWeight += weights[i];
            }
        }

        // No weight yet (all first-seen, or no accrual): just roll baselines forward.
        if (totalWeight == 0) {
            for (uint256 i = 0; i < n; i++) {
                baseline[entityIds[i]] = current[i];
            }
            emit RoundDistributed(budget, 0, n);
            return;
        }

        // Burn: set aside a cut of the budget before the entity split. Only
        // accrued here (no transfer); sent to the burn address by executeBurn.
        uint256 burnAmount = burnRate > 0 ? (budget * burnRate) / MAX_BURN_RATE : 0;
        uint256 entityBudget = budget - burnAmount;
        if (burnAmount > 0) {
            pendingBurn += burnAmount;
            emit BurnAccrued(burnAmount, pendingBurn);
        }

        // Pass 2: advance baselines and pay each entity its pro-rata share of the
        // entity budget. Dust from integer division stays for the next round.
        for (uint256 i = 0; i < n; i++) {
            uint256 id = entityIds[i];
            baseline[id] = current[i];

            if (weights[i] == 0) {
                continue;
            }
            uint256 share = (entityBudget * weights[i]) / totalWeight;
            if (share == 0) {
                continue;
            }
            // Pay the entity's stakers on the owner-proof track: vests over
            // rewardVestingDuration; the entity owner cannot withhold or re-rate it.
            vanaPoolEntity.addStakerRewards{value: share}(id, payEntityCommission, rewardVestingDuration);
            emit Distributed(id, share, weights[i]);
        }

        emit RoundDistributed(budget, totalWeight, n);
    }

    /**
     * @notice The weight an entity would receive right now (stake-seconds since
     *         its baseline). 0 for a first-seen entity.
     */
    function pendingWeight(uint256 entityId) external view returns (uint256) {
        if (!seen[entityId]) {
            return 0;
        }
        return vanaPoolEntity.stakeSecondsAt(entityId) - baseline[entityId];
    }

    function updateVanaPoolEntity(address newVanaPoolEntityAddress) external onlyRole(MAINTAINER_ROLE) {
        if (newVanaPoolEntityAddress == address(0)) {
            revert InvalidAddress();
        }
        vanaPoolEntity = IVanaPoolEntity(newVanaPoolEntityAddress);
    }

    /**
     * @notice Set the burn cut skimmed from each distributed budget. The skim is
     *         sent to the zero address (BURN_ADDRESS), so no recipient is needed.
     * @param newBurnRate percent * 1e18 (0..MAX_BURN_RATE); 0 disables
     */
    function updateBurnRate(uint256 newBurnRate) external onlyRole(MAINTAINER_ROLE) {
        if (newBurnRate > MAX_BURN_RATE) {
            revert InvalidBurnRate();
        }
        burnRate = newBurnRate;
        emit BurnRateUpdated(newBurnRate);
    }

    /// @notice Toggle whether entity payouts pay the entity owner's commission cut.
    function updatePayEntityCommission(bool value) external onlyRole(MAINTAINER_ROLE) {
        payEntityCommission = value;
        emit PayEntityCommissionUpdated(value);
    }

    /// @notice Set the linear vesting span (seconds) applied to each entity payout.
    ///         Must be explicitly set (> 0) before distributing.
    function updateRewardVestingDuration(uint32 duration) external onlyRole(MAINTAINER_ROLE) {
        if (duration == 0) {
            revert VestingDurationNotSet();
        }
        rewardVestingDuration = duration;
        emit RewardVestingDurationUpdated(duration);
    }

    /**
     * @notice Send the accrued burn balance to the zero address, permanently
     *         removing it from circulation. Permissionless: funds only ever go
     *         to BURN_ADDRESS. No-op when nothing has accrued.
     */
    function executeBurn() external nonReentrant {
        uint256 amount = pendingBurn;
        if (amount == 0) {
            return;
        }
        pendingBurn = 0; // effects before interaction
        (bool burned, ) = BURN_ADDRESS.call{value: amount}("");
        if (!burned) {
            revert TransferFailed();
        }
        emit Burned(amount);
    }

    /// @notice Recover unallocated VANA (division dust or excess funding). Cannot
    ///         touch the pendingBurn reserve.
    function withdraw(address payable to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) {
            revert InvalidAddress();
        }
        if (amount > address(this).balance - pendingBurn) {
            revert InvalidBudget();
        }
        (bool success, ) = to.call{value: amount}("");
        if (!success) {
            revert TransferFailed();
        }
        emit Withdrawn(to, amount);
    }

    /// @notice Recover ERC-20 not part of a recorded reward -- tokens airdropped
    ///         or sent directly rather than via fundTokenReward. Cannot touch the
    ///         pendingConversion reserve, which must exit through sendToConverter.
    function recoverToken(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) {
            revert InvalidAddress();
        }
        uint256 recoverable = IERC20(token).balanceOf(address(this)) - pendingConversion[token];
        if (amount > recoverable) {
            revert InvalidBudget();
        }
        IERC20(token).safeTransfer(to, amount);
        emit TokenRecovered(token, to, amount);
    }

    function pause() external onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }
}
