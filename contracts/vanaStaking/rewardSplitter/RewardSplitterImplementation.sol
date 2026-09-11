// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
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
    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // Burn rate is percent * 1e18 (matching maxAPY / commission), so 100% == this.
    uint256 public constant MAX_BURN_RATE = 100e18;

    IVanaPoolEntity public vanaPoolEntity;

    // last stake-seconds reading taken for an entity (the round baseline)
    mapping(uint256 entityId => uint256 stakeSeconds) public baseline;
    // whether an entity has been seen before (distinguishes "baseline 0" from unset)
    mapping(uint256 entityId => bool) public seen;

    // Buy-and-burn: this fraction of each distributed budget is set aside before
    // the remainder is split across entities. distribute() only accrues it into
    // pendingBurn; executeBuyAndBurn() flushes it to buyAndBurnAddress.
    uint256 public burnRate; // percent * 1e18; 0 = no burn
    address public buyAndBurnAddress;
    uint256 public pendingBurn; // wei accrued for buy-and-burn, not yet flushed

    event Distributed(uint256 indexed entityId, uint256 amount, uint256 weight);
    event RoundDistributed(uint256 budget, uint256 totalWeight, uint256 entityCount);
    event BurnAccrued(uint256 amount, uint256 pendingBurn);
    event BuyAndBurnExecuted(address indexed to, uint256 amount);
    event BuyAndBurnUpdated(uint256 burnRate, address buyAndBurnAddress);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error InvalidAddress();
    error InvalidBudget();
    error InvalidBurnRate();
    error TransferFailed();

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

        // Buy-and-burn: set aside a cut of the budget before the entity split.
        // Only accrued here (no transfer); flushed by executeBuyAndBurn.
        uint256 burnAmount = (burnRate > 0 && buyAndBurnAddress != address(0))
            ? (budget * burnRate) / MAX_BURN_RATE
            : 0;
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
            // fund the entity's reward pool; it vests to its stakers by its model
            vanaPoolEntity.addRewards{value: share}(id);
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
     * @notice Set the buy-and-burn cut skimmed from each distributed budget.
     * @param newBurnRate         percent * 1e18 (0..MAX_BURN_RATE); 0 disables
     * @param newBuyAndBurnAddress recipient of the skim (a burner/buy-back sink)
     */
    function updateBuyAndBurn(
        uint256 newBurnRate,
        address newBuyAndBurnAddress
    ) external onlyRole(MAINTAINER_ROLE) {
        if (newBurnRate > MAX_BURN_RATE) {
            revert InvalidBurnRate();
        }
        // require a recipient whenever the rate is nonzero, so a live rate can't
        // silently skim to address(0).
        if (newBurnRate > 0 && newBuyAndBurnAddress == address(0)) {
            revert InvalidAddress();
        }
        burnRate = newBurnRate;
        buyAndBurnAddress = newBuyAndBurnAddress;
        emit BuyAndBurnUpdated(newBurnRate, newBuyAndBurnAddress);
    }

    /**
     * @notice Flush the accrued buy-and-burn balance to buyAndBurnAddress.
     *         Permissionless: funds only ever go to the configured sink. No-op
     *         when nothing has accrued.
     */
    function executeBuyAndBurn() external nonReentrant {
        uint256 amount = pendingBurn;
        if (amount == 0) {
            return;
        }
        address sink = buyAndBurnAddress;
        if (sink == address(0)) {
            revert InvalidAddress();
        }
        pendingBurn = 0; // effects before interaction
        (bool burned, ) = sink.call{value: amount}("");
        if (!burned) {
            revert TransferFailed();
        }
        emit BuyAndBurnExecuted(sink, amount);
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

    function pause() external onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }
}
