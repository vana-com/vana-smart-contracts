# README – Upgrade from Simple DAT to DAT + Vesting Stack

## Overview
The token system evolved from a single ERC-20 contract to a modular stack that mints **only through on-chain vesting wallets**.

---

## 1. Contracts Added / Changed

| Layer           | v1: Simple DAT                                 | v2: DAT + Vesting Stack                                                                 |
|----------------|------------------------------------------------|-----------------------------------------------------------------------------------------|
| **Token**       | `DAT.sol` – ERC-20 with `MINTER_ROLE` only     | `DAT.sol` extended:<br>• Optional cap (`0 = unlimited`)<br>• Pausable & block-list<br>• Irreversible `blockMint()` fuse<br>• Governance via `ERC20Votes` |
| **Minting Hub** | —                                              | `VestingFactory.sol` – sole minter (`MINTER_ROLE`), role-gated by `CREATOR_ROLE`, emits `VestingCreated` |
| **Vesting Wallets** | —                                          | • `LinearVestingWallet` (linear unlock)<br>• `CliffVestingWallet` (cliff ➜ linear)<br>• `NoVestingWallet` (instant unlock) |

---

## 2. Key Flow (v2)

1. **DAO / multisig** holds `CREATOR_ROLE` on **VestingFactory**  
2. Factory mints DAT directly into a newly deployed **vesting wallet**  
3. Beneficiary (or anyone) calls `release()` to claim vested tokens  
4. `VestingCreated` and `Released` events provide full on-chain audit  

```text
DAT ──MINTER_ROLE──► VestingFactory ──deploys──► VestingWallet ──release──► Beneficiary
```

## 3. Security & Governance Improvements

- **Mint fuse** — `blockMint()` permanently disables further minting
- **Pausable & block-list** — freeze transfers or specific addresses
- **Transparent allocation** — every grant & release is an event
- **Governance-ready** — voting power zeroed for blocked accounts

## 4. Migration Steps

1. Deploy new DAT with `desired cap`
2. Deploy VestingFactory targeting DAT
3. Grant `MINTER_ROLE` to the factory; revoke from deployer
4. Use factory to create wallets (Linear, Cliff, NoVesting)
5. Update front-end to read `releasable()` / `released()` for balances

## TL;DR
Token supply now enters circulation only through vesting wallets — enforcing cliffs, linear unlocks, and full on-chain transparency.
