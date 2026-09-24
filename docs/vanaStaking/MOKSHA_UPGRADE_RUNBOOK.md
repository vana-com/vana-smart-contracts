# Moksha upgrade runbook — VanaPool staking (branch `feat/staking-rewards-models`)

Facts below were read on-chain on 2026-09-24 (RPC `https://rpc.moksha.vana.org`, chainId 14800).
Re-verify the "Pre-flight" section immediately before executing; the state will have moved.

## 1. What is being upgraded

| Contract | Proxy | Live version → target | Live implementation |
|---|---|---|---|
| VanaPoolStaking | `0x641C18E2F286c86f96CE95C8ec1EB9fC0415Ca0e` | 2 → **4** | `0x8ffd88ada6e26b4b1585a2f994aa5daa147053d3` |
| VanaPoolEntity | `0x44f20490A82e1f1F1cC25Dd3BA8647034eDdce30` | 2 → **4** | `0x208cfa5a89386f1a33b6f43a2303d5cd5acc118a` |
| VanaPoolTreasury (**live**) | `0x143BE72CF2541604A7691933CAccd6D9cC17c003` | 1 → **2** | `0xa094c3074d25da6159b0e96f68af204da879ffce` |
| RewardSplitter | — (not deployed) | fresh deploy | — |

**Discrepancy to be aware of:** `deployments-official/moksha/VanaPoolTreasuryProxy.json` records
`0x6Afeb9e8A15Bc3a8677e8c5C1A06eD1E8114D7a2`, but that proxy is an unused duplicate holding 0 wei.
The treasury that custodies stake is the one `staking.vanaPoolTreasury()` returns: **`0x143BE72C…`**,
balance ≈ 377,692 VANA, which equals entity 1's `activeRewardPool + lockedRewardPool` (solvent).
The Treasury script refuses to run against a treasury whose `vanaPool()` is not the staking proxy.
Correcting the official record is a separate decision.

The recorded implementation addresses in `deployments-official/moksha/*Implementation.json` are also
stale (older than what the proxies point to). The table above is what is live.

## 2. Who can execute

A single EOA, **`0x2AC93684679a5bdA03C6160def908CdB8D46792f`**, holds `DEFAULT_ADMIN_ROLE` and
`MAINTAINER_ROLE` on Staking and Entity and `DEFAULT_ADMIN_ROLE` on the treasury (the Staking proxy also
holds treasury `DEFAULT_ADMIN_ROLE`, a v1 design). The same EOA owns entity 1. Every step below is
executable directly by that key; `DEPLOY_ONLY=true` prints the equivalent calls if a different signer
must submit them. `.env` currently has **no** `DEPLOYER_PRIVATE_KEY`; the admin key must be configured.

## 3. Order, and why it matters

```
Entity (v4)  →  Staking (v4)  →  Treasury (v2, atomic payload)  →  RewardSplitter deploy + wire
```

- **Entity before Staking.** Staking v4 calls `VanaPoolEntity.vanaToShares` (in `stake`/`redelegate`/
  `unstakeVana`) and `previewActiveRewardPool` (in `getMaxUnstakeAmount`). Neither exists on Entity v2,
  so upgrading Staking first would revert every stake. The reverse window is safe: Staking v2 only
  uses functions Entity v4 still has (`vanaToEntityShare`, `updateEntityPool`, `processRewards`, ...).
- **Treasury via `upgradeToAndCall`, never plain `upgradeTo`.** v2 gates `transferVana` on
  `SPENDER_ROLE`, which nobody holds on a v1 deployment. A plain upgrade would make **every unstake
  revert** until the role is granted. The script upgrades with `updateVanaPool(staking)` as the payload:
  it revokes `SPENDER_ROLE` from the current `vanaPool` (nobody holds it: no-op) and grants it to
  Staking in the same transaction. Then `updateVanaPoolEntity(entity)` grants the entity its spend
  right (`claimCommission`, `sweepUnallocatedRewards` pay out through the entity).
- **Splitter last.** It needs Entity v4 (`addStakerRewards`, `updateRewardSplitter`).

## 4. Pre-flight (run right before)

```bash
export RPC=https://rpc.moksha.vana.org
STK=0x641C18E2F286c86f96CE95C8ec1EB9fC0415Ca0e; ENT=0x44f20490A82e1f1F1cC25Dd3BA8647034eDdce30; TRE=0x143BE72CF2541604A7691933CAccd6D9cC17c003
cast call $STK 'version()(uint256)' --rpc-url $RPC        # expect 2
cast call $ENT 'version()(uint256)' --rpc-url $RPC        # expect 2
cast call $TRE 'version()(uint256)' --rpc-url $RPC        # expect 1
cast call $STK 'vanaPoolTreasury()(address)' --rpc-url $RPC   # MUST equal $TRE
cast call $TRE 'vanaPool()(address)' --rpc-url $RPC           # MUST equal $STK
cast call $STK 'hasRole(bytes32,address)(bool)' $(cast keccak VANA_POOL_ENTITY_ROLE) $ENT --rpc-url $RPC   # MUST be true, or createEntity reverts
cast balance $TRE --rpc-url $RPC
cast call $ENT 'entities(uint256)((uint256,address,uint8,string,uint256,uint256,uint256,uint256,uint256,uint256))' 1 --rpc-url $RPC
# solvency: treasury balance >= active + locked (+ accruedCommission, 0 on v2)
```

Record the outputs; they are the rollback / verification baseline. Snapshot on 2026-09-24: entity 1
`activeRewardPool` 80,065.59 VANA, `lockedRewardPool` 297,627.20 VANA, `totalShares` 75,239.89e18,
12 active stakers, `bondingPeriod` 432000 s (5 d), `minRegistrationStake` 100 VANA, `minStakeAmount` 1e10 wei.

**Storage-layout safety (verified against `origin/main`, which is at exactly the live versions
2/2/1):** every storage contract that exists on main is byte-identical on the branch
(`VanaPoolStakingStorageV1/V2`, `VanaPoolTreasuryStorageV1`; `VanaPoolEntityStorageV1` differs only by
the `REWARD_SPLITTER_ROLE` *constant*, which occupies no slot). New contracts append only:
`VanaPoolStakingStorageV3` (slots 10, 11), `VanaPoolEntityStorageV2` (slot 8), `VanaPoolTreasuryStorageV2`
(slot 1). Implementation inheritance order is unchanged apart from the appended storage contract. The
`Entity` struct (held only in the `_entities` mapping) gained 12 fields strictly after main's 9. The
Foundry tests prove the Staking slot map live (`vm.load(slot 9) == bondingPeriod`).

**Mainnet reference:** mainnet's pre-upgrade implementations (`0x61d6…`, `0x60bf…`, `0x6afe…`) are
different contracts from Moksha's, but their bytecode differs *only* in the UUPS `__self` immutable (each
implementation's own address, embedded 2–3×); with that masked they are byte-identical. So they are the
same `origin/main` source, and the layout argument above applies to mainnet unchanged.

Hardhat is broken under Node 24 in this repo; run the scripts under Node 18/20.

## 5. Execution

### Step 1 — Entity v2 → v4
```bash
VANA_POOL_ENTITY_PROXY_ADDRESS=$ENT npx hardhat deploy --network moksha --tags VanaPoolEntityUpgrade
```
Verify: `version() == 4`; `entities(1)` unchanged; `entityRewardModel(1) == 0` (APY);
`rewardSplitter() == 0x0` (wired in step 4). Principal-seconds seeding for entity 1 is automatic on its
first stake/unstake (`stakedPrincipal` seeds from `activeRewardPool`); nothing to do.
(The script's trailing "call addTotalDistributedRewards" note is from the v2 upgrade — ignore.)

### Step 2 — Staking v2 → v4, with the legacy floor backfill
Entity 1 has no registrant record (the floor is recorded only at creation). Its registration is the
first `Staked(entityId=1)` event, block 2111158: **1e20 shares (100 VANA) by `0x2AC9…`**.
```bash
VANA_POOL_STAKING_PROXY_ADDRESS=$STK \
BACKFILL_REGISTRATIONS="1:0x2AC93684679a5bdA03C6160def908CdB8D46792f:100000000000000000000" \
npx hardhat deploy --network moksha --tags VanaPoolStakingUpgrade
```
Verify: `version() == 4`; `entityRegistrant(1) == 0x2AC9…`; `entityRegistrationShares(1) == 1e20`;
`getMaxUnstakeAmount(0x2AC9…, 1)` reports `limitingFactor` **3** with `maxShares` = holdings − 1e20: a
full-exit quote for the registrant is always capped by the seed they must keep, by design.
Note: `unstakeVana` gained a 4th parameter (`vanaAmountMin`); it is not in any published ABI.

### Step 3 — Treasury v1 → v2 (atomic SPENDER grant)
```bash
VANA_POOL_TREASURY_PROXY_ADDRESS=$TRE VANA_POOL_STAKING_PROXY_ADDRESS=$STK VANA_POOL_ENTITY_PROXY_ADDRESS=$ENT \
npx hardhat deploy --network moksha --tags VanaPoolTreasuryUpgrade
```
The script, in order: `upgradeToAndCall(impl, updateVanaPool($STK))` (SPENDER to Staking, atomic),
`updateVanaPoolEntity($ENT)` (SPENDER to Entity), and — only once both grants are confirmed on-chain —
`revokeRole(DEFAULT_ADMIN_ROLE, $STK)`, so the Staking contract ends holding `SPENDER_ROLE` only.
Verify: `version() == 2`; `hasRole(SPENDER_ROLE, $STK) == true`; `hasRole(SPENDER_ROLE, $ENT) == true`;
`hasRole(0x00…00, $STK) == false`; `vanaPoolEntity() == $ENT`. **Then perform one small real unstake**
from a test staker and confirm it pays out.

### Step 4 — RewardSplitter deploy + wiring
```bash
VANA_POOL_ENTITY_PROXY_ADDRESS=$ENT OWNER_ADDRESS=0x2AC93684679a5bdA03C6160def908CdB8D46792f \
REWARD_VESTING_DURATION=604800 DISTRIBUTOR_ADDRESS=<distributor or the owner> \
npx hardhat deploy --network moksha --tags RewardSplitterDeploy
```
One run does all of it: deploys implementation + proxy (owner = admin/maintainer/distributor of the
splitter), wires `entity.updateRewardSplitter(splitter)` (grants `REWARD_SPLITTER_ROLE` on the entity),
sets `rewardVestingDuration`, grants `DISTRIBUTOR_ROLE` to `DISTRIBUTOR_ADDRESS`, and prints the final
state. Any step the deployer lacks the role for is printed as the exact call instead. The splitter needs
no treasury role (`addStakerRewards` forwards value to the treasury itself).
Verify: `entity.rewardSplitter() == splitter`; `entity.hasRole(REWARD_SPLITTER_ROLE, splitter)`;
`splitter.rewardVestingDuration() > 0`. Then fund the splitter with VANA. The first `distribute([1])`
only records the baseline and pays nothing; the second round pays.

## 6. Rollback

Old implementations (table in §1) stay deployed; rollback is `upgradeToAndCall(oldImpl, "0x")` from
the admin. Appended storage written by v4/v2 is invisible to the old code and harmless.

**Treasury caveat:** v1 gates `transferVana` on `DEFAULT_ADMIN_ROLE`, and step 3 revokes that role
from the Staking proxy. A rollback of the treasury to v1 must therefore be **preceded** by
`grantRole(0x00…00, $STK)` from the admin EOA, or every unstake reverts on the rolled-back v1. Order:
grant admin to Staking → `upgradeToAndCall(v1Impl, "0x")` → verify an unstake pays out.

## 7. Post-upgrade checklist
- [ ] versions 4 / 4 / 2; splitter wired
- [ ] treasury balance ≥ Σ(active + locked + accruedCommission + stakerLockedRewardPool) over all entities
- [ ] one stake, one partial unstake, one `unstakeVana(…, 0, 0)` by a test staker succeed
- [ ] owner of entity 1 cannot unstake below 1e20 shares (`CannotRemoveRegistrationStake`)
- [ ] `getMaxUnstakeAmount` quote equals an actual payout for a test staker
- [ ] first splitter round: baseline only; second round: entity 1 `entityStakerLockedRewardPool` increases
- [ ] Staking holds treasury `SPENDER_ROLE` only (`DEFAULT_ADMIN_ROLE` revoked by step 3)
- [ ] decide on: correcting `deployments-official/moksha`

## 8. Commits this upgrade ships (audit remediation, NM-1052)
`0d83fc5` `2a6c350` `6b7b2d6` `c583cc7` `d7d52ff` `32f757f` (PR #82) `e41f64f` `5700086` `d8e459d`
`4197369` `0c30045` `93b28e7` `77ab6a5` `770b9ae` `2b5849b` `c2b250c` `14b4128`, plus `f3c72e3`,
`f3b2976`, `a68ae55`, `d898734` already on the branch. Test suite: 233/233 (Foundry).

## 9. Executed on Moksha — 2026-09-24

All four steps ran from the admin EOA `0x2AC93684…` under Node 20.20.2 (nvm), each verified on-chain
before the next. No unstake window was opened at any point (treasury step used the atomic payload).

| Contract | Proxy | New implementation | Version |
|---|---|---|---|
| VanaPoolEntity | `0x44f20490A82e1f1F1cC25Dd3BA8647034eDdce30` | `0x6F8ad03e92A242FD837f3Fd4f51855C2DfcD2D8e` | 4 |
| VanaPoolStaking | `0x641C18E2F286c86f96CE95C8ec1EB9fC0415Ca0e` | `0x6F575694f9C0aB740d3aBcA9A3791e9B8fBAe43B` | 4 |
| VanaPoolTreasury (live) | `0x143BE72CF2541604A7691933CAccd6D9cC17c003` | `0xb484b57b5D9b6Aece84fAFb15f92F418448235d4` | 2 |
| RewardSplitter (parity address) | `0x7A7B89b6925A8156b9A51E520327c0701023b344` | `0x9b53808c51De5c82149373a0DFAf789Aa41285ec` | — |
| RewardSplitterDeployer | `0xd08C61d69e10B82ff79b6b53c9F5a638EAa11372` (same on mainnet) | — | — |

State after: entity 1 unchanged and floor recorded (`0x2AC9…`, 1e20 shares); treasury `SPENDER_ROLE` held by
Staking and Entity, Staking's `DEFAULT_ADMIN_ROLE` revoked, admin EOA retained; treasury balance unchanged
(377,692.79 VANA); a simulated 1-share unstake by the admin returns 1.0937 VANA (transferVana passes the new
gate). Splitter wired (`REWARD_SPLITTER_ROLE`), `rewardVestingDuration` 604800 s, `payEntityCommission` true,
`burnRate` 0, owner holds admin/maintainer/distributor, **unfunded**. The splitter was redeployed the same
day at the chain-independent address `0x7A7B89b6…` via `RewardSplitterDeployer` (§10); the first
splitter `0x742A676A…` is unwired (role revoked), unfunded and inert. Mainnet, deployed from the same commit
with salt `RewardSplitterProxySalt`, lands at the same `0x7A7B89b6…` regardless of signer.

Remaining (product decisions): fund the splitter; first `distribute([1])` is baseline-only; decide the burn
rate; correct `deployments-official/moksha` (treasury proxy record + new implementation addresses — hardhat-
deploy wrote fresh records to `deployments/moksha/`). Blockscout: implementation and proxy sources are
verified; the helper's proxy→implementation "link" step reported a warning, harmless.

## 10. Address parity with mainnet (RewardSplitter)

The Entity and Staking proxies already share their addresses across Moksha and mainnet (both were deployed
by `0xb11B37A47b120bEAED9b06910d951209d5Cf80f1`). The mainnet treasury record is `0x143BE72C…` — the same
address as the live Moksha treasury, so the Moksha entry in `deployments-official` should simply be
corrected to it.

The first Moksha splitter (`0x742A676A…`) **cannot** reproduce on mainnet: its CREATE2 creation code embeds
`initialize(owner=0x2AC9…, entity)`, and the owner differs per chain. The deploy script now uses
`RewardSplitterDeployer` (CREATE2, fixed salt, no constructor args → same address on every chain), which
creates the proxy with empty constructor data and calls `initialize` atomically. The proxy address depends
only on (deployer contract, `CREATE2_SALT`, entity address, implementation) — **not on the signer and not
on the owner** — so any maintainer of the entity can deploy on either chain and get the same address. That
is also the guard: only an entity `MAINTAINER_ROLE` holder may call `deploy`, so nobody else can occupy the
address first. Parity requires on mainnet: the **same commit** (implementation bytecode) and the **same
salt**; the entity address is already identical. Re-running the script on Moksha redeploys the splitter at
the parity address and re-wires the entity (rotating the role off `0x742A…`, which is unfunded).

## 11. Post-upgrade e2e on the live contracts (fork test)

`test/foundry/fork/MokshaE2E.t.sol` runs the full scenario against the real Moksha bytecode and state
(forked at the latest block; nothing broadcast): three new entities at 40% APY with 10% commission,
entity 1 blocked for new stake, every live staker of entity 1 migrated by `redelegate`, splitter funded,
10% burn, two distribution rounds (round 1 is baseline-only by design), commission claimed by the owners
through the treasury's `SPENDER_ROLE`, stakers' positions grown by both the splitter track and the APY
drip, burn executed to `address(0)`, treasury solvency asserted at every stage.
Run: `MOKSHA_FORK=1 forge test --match-path test/foundry/fork/MokshaE2E.t.sol -vv` (skipped otherwise).

**Finding from its first run (2026-09-24):** the Moksha entity did **not** hold `VANA_POOL_ENTITY_ROLE` on
Staking, so `createEntity` reverted — a pre-existing Moksha misconfiguration (the gate exists in v2 as
well; mainnet holds the role). Fixed the same day with `grantRole(VANA_POOL_ENTITY_ROLE, entity)` from the
admin. The pre-flight above now checks it.

