// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVanaPoolEntity} from "../vanaPoolEntity/interfaces/IVanaPoolEntity.sol";

/**
 * @title  VanaPoolLens
 * @notice Read-only views over VanaPoolEntity that every consumer would
 *         otherwise approximate differently. Holds no funds and no roles, reads
 *         only public getters, and is not upgradeable: replace it by deploying a
 *         new one.
 *
 * @dev    entityAPY is the pool's current forward rate for a staker who holds
 *         through the window, net of commission, from both reward sources:
 *
 *         - the owner track (lockedRewardPool), released by the entity's reward
 *           model and skimmed for commission on every settlement;
 *         - the splitter track (stakerLockedRewardPool), released linearly over
 *           its schedule; commission was taken when it was funded, so it is
 *           already net and is not discounted again.
 *
 *         Rates are percent * 1e18 (40% == 40e18), annualised over the active
 *         pool as the next settlement would leave it (previewActiveRewardPool).
 *         Every component is a SIMPLE annualised rate (the current pace * 1 year),
 *         so the components add and the sum is directly comparable with
 *         annualised share-price growth. For the APY model that is the nominal
 *         rate maxAPY * (1 - commission); the compounded equivalent, which is
 *         what currentAPYByEntity reports gross, is given separately as
 *         ownerNetEffectiveAPY. It is not a realised yield — use share-price
 *         history for that — and it says nothing about how long a rate lasts:
 *         read ownerFundedUntil / splitterEndsAt for that.
 */
contract VanaPoolLens {
    uint256 private constant YEAR = 365 days;
    uint256 private constant PERCENT = 100e18; // 100% in the entity's units (== MAX_COMMISSION)

    IVanaPoolEntity public immutable vanaPoolEntity;

    struct EntityAPY {
        uint256 apy; // ownerNetAPY + splitterAPY (simple, annualised)
        uint256 ownerGrossAPY; // owner track before commission (simple)
        uint256 ownerNetAPY; // owner track after commission (simple)
        uint256 splitterAPY; // splitter track, already net of commission (simple)
        uint256 ownerFundedUntil; // when lockedRewardPool runs dry at the current pace (0 if not paying)
        uint256 splitterEndsAt; // end of the splitter schedule (0 if not paying)
        uint256 activePool; // the denominator
        uint256 ownerNetEffectiveAPY; // owner track after commission, compounded over a year (APY model: e^(maxAPY*(1-c)) - 1)
    }

    constructor(IVanaPoolEntity vanaPoolEntity_) {
        vanaPoolEntity = vanaPoolEntity_;
    }

    function entityAPYs(uint256[] calldata entityIds) external view returns (EntityAPY[] memory out) {
        out = new EntityAPY[](entityIds.length);
        for (uint256 i = 0; i < entityIds.length; i++) {
            out[i] = entityAPY(entityIds[i]);
        }
    }

    function entityAPY(uint256 entityId) public view returns (EntityAPY memory r) {
        IVanaPoolEntity.EntityInfo memory info = vanaPoolEntity.entities(entityId);
        if (info.status != IVanaPoolEntity.EntityStatus.Active) {
            return r;
        }
        uint256 pool = vanaPoolEntity.previewActiveRewardPool(entityId);
        if (pool == 0) {
            return r;
        }
        r.activePool = pool;

        uint256 commission = vanaPoolEntity.entityCommissionRate(entityId);
        (r.ownerGrossAPY, r.ownerNetAPY, r.ownerNetEffectiveAPY, r.ownerFundedUntil) = _ownerTrack(
            entityId,
            info,
            pool,
            commission
        );
        (r.splitterAPY, r.splitterEndsAt) = _splitterTrack(entityId, pool);
        r.apy = r.ownerNetAPY + r.splitterAPY;
    }

    // ---- owner track ----

    function _ownerTrack(
        uint256 entityId,
        IVanaPoolEntity.EntityInfo memory info,
        uint256 pool,
        uint256 commission
    ) internal view returns (uint256 gross, uint256 net, uint256 netEffective, uint256 fundedUntil) {
        uint256 locked = info.lockedRewardPool;
        if (locked == 0) {
            return (0, 0, 0, 0);
        }

        if (vanaPoolEntity.entityRewardModel(entityId) == IVanaPoolEntity.RewardModel.APY) {
            if (info.maxAPY == 0) {
                return (0, 0, 0, 0);
            }
            // The drip pays maxAPY continuously on the pool: that is its current
            // pace, i.e. its simple annualised rate. Commission is skimmed from
            // each settlement, so stakers keep maxAPY * (1 - c).
            gross = info.maxAPY;
            net = (info.maxAPY * (PERCENT - commission)) / PERCENT;
            // Compounded equivalent: only the net drip re-enters the pool, so it
            // compounds at the net rate: e^net - 1 (not (e^maxAPY - 1) * (1 - c)).
            netEffective = (vanaPoolEntity.calculateYield(pool, net, YEAR) * PERCENT) / pool;
            // The drip draws gross (commission included) from the reserve.
            fundedUntil = block.timestamp + (locked * YEAR * PERCENT) / (pool * gross);
            return (gross, net, netEffective, fundedUntil);
        }

        // STREAM: the entry vesting now (the active one, or the queued one the
        // next settlement would promote), capped by what the reserve holds.
        IVanaPoolEntity.RewardSchedule memory s = vanaPoolEntity.entityRewardSchedule(entityId);
        (uint256 value, uint256 end, uint256 duration) = _vestingEntry(s);
        if (value == 0) {
            return (0, 0, 0, 0);
        }
        gross = (value * YEAR * PERCENT) / (duration * pool);
        net = (gross * (PERCENT - commission)) / PERCENT;
        netEffective = net; // fixed amounts released linearly: nothing compounds on the schedule itself
        uint256 dry = block.timestamp + (locked * duration) / value; // reserve / (value per second)
        fundedUntil = dry < end ? dry : end;
    }

    /// @dev The linear entry vesting at block.timestamp, if any.
    function _vestingEntry(
        IVanaPoolEntity.RewardSchedule memory s
    ) internal view returns (uint256 value, uint256 end, uint256 duration) {
        uint256 activeEnd = uint256(s.start) + s.duration;
        if (s.scheduledValue > 0 && s.duration > 0 && block.timestamp >= s.start && block.timestamp < activeEnd) {
            return (s.scheduledValue, activeEnd, s.duration);
        }
        uint256 nextEnd = uint256(s.nextStart) + s.nextDuration;
        if (
            block.timestamp >= activeEnd &&
            s.nextScheduledValue > 0 &&
            s.nextDuration > 0 &&
            block.timestamp >= s.nextStart &&
            block.timestamp < nextEnd
        ) {
            return (s.nextScheduledValue, nextEnd, s.nextDuration);
        }
        return (0, 0, 0);
    }

    // ---- splitter track ----

    function _splitterTrack(uint256 entityId, uint256 pool) internal view returns (uint256 rate, uint256 endsAt) {
        if (vanaPoolEntity.entityStakerLockedRewardPool(entityId) == 0) {
            return (0, 0);
        }
        // Rebased on every deposit: one linear entry holding the whole
        // outstanding balance from its deposit time.
        IVanaPoolEntity.RewardSchedule memory s = vanaPoolEntity.entityStakerRewardSchedule(entityId);
        (uint256 value, uint256 end, uint256 duration) = _vestingEntry(s);
        if (value == 0) {
            return (0, 0);
        }
        rate = (value * YEAR * PERCENT) / (duration * pool);
        endsAt = end;
    }
}
