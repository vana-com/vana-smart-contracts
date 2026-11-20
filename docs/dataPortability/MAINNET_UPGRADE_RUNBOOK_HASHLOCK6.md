# Mainnet upgrade runbook — data portability V2, Hashlock 6th audit fixes

Facts below were read on-chain on 2026-11-20 (RPC `https://rpc.vana.org`, chainId 1480, block 11094898).
Re-run the "Pre-flight" section immediately before executing; state moves.

Branch `dp_escrow`, fix-review commit **`b8ed895b1c0e79dd38f981931bd0e4d93b78cefd`** (the commit Hashlock's
final report v2 names). The `contracts/` tree must be exactly that commit's when the implementations are
deployed (later commits that only add scripts or docs are fine): the Safe batch encodes CREATE2 addresses
derived from that bytecode, and the deploy script aborts if an implementation would land elsewhere.

## 1. What is being upgraded

| Contract | Proxy | Live version → target | Live implementation | Why |
|---|---|---|---|---|
| DataRegistryV2 | `0x8f1eFCdff3d0d5BB535e32620721c7EBed151867` | 1 → 1 | `0xfa48b6e19b177c1c0a8e19af7a2e0e8e64640c54` | Q-02, Q-03, Q-04 |
| DataPortabilityServersV2 | `0xCae2CE0e9caa6643ed28186cF57bd40Bd9E17Eab` | 1 → **2** | `0x97537454751ee1a649c92ac1ba7d0e4a9e90d1fd` | M-01, Q-06, Q-01, Q-04 |
| DataPortabilityPermissionsV2 | `0x4d3FA76064D88e0454cFc4CaD7e5FeC3e3124011` | 1 → 1 | `0x4e71094c8cd2065f1c0c85e978d7f53b79b1aa84` | L-01, Q-05, Q-04 |
| DataPortabilityEscrow | `0x07d7769081adc3a3DBe91f5E4B98E9A5a6B292e3` | 1 → **2** | `0x0de07f128b3a127cae1ad6e8d44f2f6a6c3a9611` | payee pinning (Centralisation section) |
| FeeRegistry | `0xb4FA18443E0FA6cdC0280D20b8cCDB2377D13Bf2` | 1 (unchanged) | `0x3a95fc4b4fe7ca6e83de71b4d9afe6d2d92afef8` | no change since deploy |

DataRegistryV2 and PermissionsV2 keep `version() == 1`: their fixes add events, validation and constants
only. Verify those two by the implementation slot, not by `version()`.

**Baseline proven:** every live implementation above is bytecode-identical (modulo the UUPS `__self`
immutable) to the artifact compiled at the audited commit `7f622d9`. The OpenZeppelin storage-layout
checker (`@openzeppelin/upgrades-core`, audited commit → `b8ed895`) reports **no errors** for all five:
DataRegistryV2 and PermissionsV2 layouts are unchanged; ServersV2 appends `requireServerProof` and
`_provenServerIds` (StorageV2) and keeps the old forwarder slot as `_deprecatedTrustedForwarder`
(`@custom:oz-renamed-from`); Escrow appends `feeRegistry` (StorageV2). FeeRegistry is unchanged.

## 2. Who does what

| Step | Signer |
|---|---|
| Deploy the four implementations | Hardware wallet `LEDGER_ADDRESS` (any funded EOA works; the implementations are CREATE2 through the shared factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`, so the address does not depend on the deployer) |
| Upgrade the four proxies | Safe **`0x5ECA5208F29e32879a711467916965B2D753bAf4`** (v1.4.1, threshold 3 of 7), sole `DEFAULT_ADMIN_ROLE` holder on all five proxies |

The deploy script never upgrades and never needs admin. The Safe batch is one atomic MultiSend of four
`upgradeToAndCall`s: either all four proxies move or none does.

## 3. Order, and why

```
Ledger: deploy impls (idempotent)  →  Safe: 1 batch [DataRegistryV2, ServersV2, PermissionsV2, Escrow]
```

- **Escrow via `upgradeToAndCall(impl, setFeeRegistry(0xb4FA…3Bf2))`, never a bare upgrade.** The v2
  escrow reads `feeRegistry` on every settlement and reverts `FeeRegistryNotSet` while it is zero. The
  payload runs under the Safe's `msg.sender`, which `setFeeRegistry`'s `onlyRole(DEFAULT_ADMIN_ROLE)` needs.
- The other three carry an empty payload. No reinitializer exists on any of them.
- Order inside the batch does not matter functionally (no new cross-contract ABI is required by any of
  the four), it is atomic anyway; the file lists them in the table order.
- `ServersV2.requireServerProof` is **not** switched on by this batch. Legacy
  `registerServerWithSignature` keeps working until the gateway, SDK and personal server send server
  proofs; then a `MAINTAINER_ROLE` holder calls `setRequireServerProof(true)` (separate transaction,
  closes Hashlock Q-01, which the report lists as Acknowledged for exactly this reason).

## 4. Gateway prerequisites (ship before or with the batch)

From the upgrade TODO. The contract changes are backward compatible for reads; these are the write-path
behaviours the data-gateway must handle, or settlements queue up and fail:

- **Escrow `UnexpectedPayee`.** `to` must equal the FeeRegistry payee for the op's kind. Settlement
  snapshots taken with an older payee revert, and one bad op reverts the whole batch. The settle drains
  must simulate per op and quarantine mismatches instead of retrying. Never send `OpKind.Unspecified`
  (always reverts now).
- **Q-02.** A direct `setStatus` now cancels every pending signed `SetStatus` (`UnexpectedVersion`). The
  gateway must resync its stored state after a failed status relay and never cache `statusSequence`.
- **Q-05.** Reject >64 scopes, empty or >128-byte scopes and duplicates at intake, or the grant reverts
  at settle.
- **L-01.** Reject a signed `grantVersion` greater than stored + 2^64 at intake.
- Mainnet FeeRegistry has payees only for `data_access` and `grant_registration`. Any other OpKind the
  gateway settles must get a payee first (`setFeeByName`).

## 5. Environment

```
VANA_RPC_URL=https://rpc.vana.org          # the `vana` network
VANA_API_URL=https://vanascan.io/api       # verification
VANA_BROWSER_URL=https://vanascan.io
LEDGER_ADDRESS=0x…                         # hardware wallet that deploys + verifies
```
The `vana` network signs **only** through `@nomicfoundation/hardhat-ledger` (`accounts: "remote"` +
`ledgerAccounts: [LEDGER_ADDRESS]`); the deploy script refuses to run on chain 1480 without
`LEDGER_ADDRESS`. Ledger: Ethereum app open, blind signing enabled (each deploy is a call to the CREATE2
factory with data). Four deploys, 10.34M gas in total as measured on the fork (2.82M / 2.71M / 2.14M / 2.66M);
at 2x the 0.21 gwei gas price seen on 2026-11-20 that is about 0.005 VANA. Never put an admin key
in `.env`. Build from a clean tree so the artifacts match the batch:

```bash
git diff --stat b8ed895 -- contracts/      # must print nothing
npx hardhat clean && npx hardhat compile
```

## 6. Pre-flight (run right before)

```bash
export RPC=https://rpc.vana.org
DR=0x8f1eFCdff3d0d5BB535e32620721c7EBed151867; SV=0xCae2CE0e9caa6643ed28186cF57bd40Bd9E17Eab
PM=0x4d3FA76064D88e0454cFc4CaD7e5FeC3e3124011; ES=0x07d7769081adc3a3DBe91f5E4B98E9A5a6B292e3
FR=0xb4FA18443E0FA6cdC0280D20b8cCDB2377D13Bf2; SAFE=0x5ECA5208F29e32879a711467916965B2D753bAf4
SLOT=0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
for P in $DR $SV $PM $ES; do
  echo "$P impl=$(cast storage $P $SLOT --rpc-url $RPC | sed 's/^0x0*/0x/') version=$(cast call $P 'version()(uint256)' --rpc-url $RPC) paused=$(cast call $P 'paused()(bool)' --rpc-url $RPC) safeIsAdmin=$(cast call $P 'hasRole(bytes32,address)(bool)' 0x0000000000000000000000000000000000000000000000000000000000000000 $SAFE --rpc-url $RPC)"
done
# expect: the four live implementations from §1, version 1/1/1/1, paused false, safeIsAdmin true
cast call $ES 'feeRegistry()(address)' --rpc-url $RPC 2>&1 | head -1    # reverts on v1: proves not yet upgraded
cast call $FR 'fees(bytes32)((uint256,address,address,bool))' $(cast keccak data_access) --rpc-url $RPC
cast call $FR 'fees(bytes32)((uint256,address,address,bool))' $(cast keccak grant_registration) --rpc-url $RPC
# both payees must be non-zero: after the upgrade every settlement pays only these addresses
cast call $ES 'getAllowedTargets()(address[])' --rpc-url $RPC            # record; must be unchanged after
cast call $SV 'serversCount()(uint256)' --rpc-url $RPC                   # record; must be unchanged after
```

Then rebuild and re-simulate the batch against a fresh fork (fails loudly on any drift):

```bash
npx hardhat run scripts/dataPortabilityV2/hashlock6UpgradeBatch.ts      # rewrites docs/dataPortability/mainnet-safe/1-upgrade-dp-v2-hashlock6.json
git diff --stat docs/dataPortability/mainnet-safe/                       # only createdAt/checksum may change
VANA_RPC_URL=$RPC npx hardhat run scripts/dataPortabilityV2/simulateHashlock6Upgrade.ts   # must end with ALL CHECKS PASSED
```

The simulation forks mainnet at the latest block, deploys the implementations through the factory exactly
as the Ledger will, replays the batch file from the Safe address, checks slots/versions/roles/wiring and
that sampled live records read identically, then exercises payee-pinned `settle`, `registerServerWithProof`,
duplicate-scope rejection and `StatusSequenceConsumed`.

**Result on 2026-11-20 (fork of block 11094939): ALL CHECKS PASSED.** The four upgrades cost 37.8k / 39.8k /
37.6k / 63.9k gas from the Safe. The sampled permission, server, data point and escrow balance read identically
before and after; `settle` to a non-payee and with `OpKind.Unspecified` revert `UnexpectedPayee`, `settle` to the
FeeRegistry payee (`0xa5105914755cF2158be2D2C5c2392C4ba963f78F` for `data_access`) pays out.

## 7. Step A — Ledger deploys the implementations

```bash
LEDGER_ADDRESS=0x… npx hardhat deploy --network vana --tags DPV2Hashlock6Implementations
```

Four factory calls, Blockscout verification after each. The script aborts if any implementation lands
anywhere but its predicted address. Re-running skips what already exists.

| Contract | Salt | Predicted address (commit b8ed895) |
|---|---|---|
| DataRegistryV2Implementation | `DataRegistryV2Implementation-hashlock6` | `0x8dB6Cf7242Eb3C2554f3e7647f0e5160e4B4D45B` |
| DataPortabilityServersV2Implementation | `DataPortabilityServersV2Implementation-hashlock6` | `0xb2E34Dd13bD1B525fd840a7759Ea2FDF38A6e13A` |
| DataPortabilityPermissionsV2Implementation | `DataPortabilityPermissionsV2Implementation-hashlock6` | `0x2DA18814FbAAbAd6409A278ce63a8BEaB744d14d` |
| DataPortabilityEscrowImplementation | `DataPortabilityEscrowImplementation-hashlock6` | `0xb54EB5bC78E36EbB2D55917B8aBBD8D5D5aE304F` |

Confirm before handing over to the signers:

```bash
for A in 0x8dB6Cf7242Eb3C2554f3e7647f0e5160e4B4D45B 0xb2E34Dd13bD1B525fd840a7759Ea2FDF38A6e13A 0x2DA18814FbAAbAd6409A278ce63a8BEaB744d14d 0xb54EB5bC78E36EbB2D55917B8aBBD8D5D5aE304F; do
  echo "$A code bytes: $(( ($(cast code $A --rpc-url $RPC | wc -c) - 2) / 2 ))"; done   # all non-zero
```

## 8. Step B — Safe executes the batch

File: `docs/dataPortability/mainnet-safe/1-upgrade-dp-v2-hashlock6.json` (Safe Transaction Builder format,
checksummed; import via Apps → Transaction Builder → "Load batch").

| # | To | Call |
|---|---|---|
| 1 | DataRegistryV2 `0x8f1e…1867` | `upgradeToAndCall(0x8dB6…D45B, 0x)` |
| 2 | ServersV2 `0xCae2…17Eab` | `upgradeToAndCall(0xb2E3…e13A, 0x)` |
| 3 | PermissionsV2 `0x4d3F…4011` | `upgradeToAndCall(0x2DA1…d14d, 0x)` |
| 4 | Escrow `0x07d7…92e3` | `upgradeToAndCall(0xb54E…304F, setFeeRegistry(0xb4FA…3Bf2))` |

Signers should check, in the Safe UI, that each `newImplementation` equals the table in §7 and that
transaction 4's inner call is `setFeeRegistry(0xb4FA18443E0FA6cdC0280D20b8cCDB2377D13Bf2)`. The Safe's
built-in simulation must succeed; it fails if Step A has not run.

## 9. Post-checks

```bash
for P in $DR $SV $PM $ES; do echo "$P impl=$(cast storage $P $SLOT --rpc-url $RPC | sed 's/^0x0*/0x/') version=$(cast call $P 'version()(uint256)' --rpc-url $RPC)"; done
# expect impls = §7 table; versions 1 / 2 / 1 / 2
cast call $ES 'feeRegistry()(address)' --rpc-url $RPC          # 0xb4FA18443E0FA6cdC0280D20b8cCDB2377D13Bf2
cast call $SV 'requireServerProof()(bool)' --rpc-url $RPC      # false
cast call $ES 'getAllowedTargets()(address[])' --rpc-url $RPC  # unchanged
cast call $SV 'serversCount()(uint256)' --rpc-url $RPC         # unchanged
cast call $PM 'MAX_SCOPES()(uint256)' --rpc-url $RPC           # 64
npx hardhat run scripts/check-mainnet-impls.ts --network vana  # after updating its expectedImpl values to §7
```

Watch the gateway's settle drains for `UnexpectedPayee` over the next hours (§4).

## 10. Rollback

The Safe can point any proxy back at its previous implementation (§1 "Live implementation") with
`upgradeToAndCall(oldImpl, 0x)`; the appended storage (`feeRegistry`, `requireServerProof`,
`_provenServerIds`) is simply ignored by the old code. Records created by the new code remain readable
by the old code (same structs). Servers registered through `registerServerWithProof` are ordinary
records to v1. Rolling back the escrow re-enables settlement to arbitrary payees.

## 11. After the upgrade

- Update `scripts/check-mainnet-impls.ts` expected implementations to §7.
- When all clients send server proofs: `setRequireServerProof(true)` from a `MAINTAINER_ROLE` holder on
  ServersV2 (closes Q-01).
- Tell Hashlock the deployed implementation addresses; the report's conclusion ties the fixes to deployment.
- V1 DataPortabilityServers `0x1483B1F634DBA75AeaE60da7f01A679aabd5ee2c` is idle since 2026-03-08 and
  outside this upgrade; pausing it or revoking its roles is a separate decision.
