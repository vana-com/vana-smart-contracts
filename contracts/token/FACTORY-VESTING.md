# DAT Factory

**2-contract stack**

| File                | Purpose                                   |
|---------------------|-------------------------------------------|
| `DATUpgradeable.sol`| ERC-20 (cap + permit + votes + pause) ready for minimal-proxy cloning. Immutable once deployed. |
| `DATFactory.sol`    | Issues EIP-1167 clones **and** spins up OpenZeppelin `VestingWallet`s from user-supplied params, then mints allocations. |

---

## 1 · Create a token

```solidity
struct VestingParams {
    address beneficiary;   // gets the tokens
    uint64  start;         // TGE (unix)
    uint64  end;           // final unlock ≥ start
    uint64  cliff;         // seconds after start before any release
    uint256 amount;        // token units
}

/* JS / TS example */
const schedules = [
  { beneficiary: team, start: now, end: now+455d, cliff:90d, amount: 1_000_000e18 },
  { beneficiary: airdrop, start: now, end: now, cliff: 0,   amount:   250_000e18 }
];

await factory.createToken(
  "MyToken", "MYT",
  ownerAddress,
  10_000_000e18,   // cap
  schedules,
  salt             // 0x0 for ordinary CREATE, else deterministic CREATE2
);
```

## Common patterns
| Wanted schedule | end | cliff | Effect |
|-----------------|-----|-------|--------|
| Instant / no vesting | start | 0 | 100 % releasable now |
| Pure 90-day cliff | start | 90 d | All at start+90 d |
| Cliff + 1 yr linear | start+455 d | 90 d | Nothing 90 d, then linear |
| 2-year linear | start+2 yr | 0 | Linear 2 yr |

(Factory converts each tuple to a standard OZ VestingWallet(start+cliff, duration).)

## 2 · Deterministic addresses (optional)
Pass salt ≠ 0 → CREATE2 → address = keccak256(0xff || factory || salt || initHash)[12:].

Query it beforehand:

```js
const predicted = await factory.predictAddress(salt); // uses factory's own addr
```

## 3 · Security & upgradeability
Clones are 45-byte immutable proxies (no admin slot, no upgrades).

Factory mints once, then revokes its minter role.

Block-list enforced on transfers and vote delegation.

Libraries (EnumerableSet, VestingWallet) are stateless → safe in upgradeable context.
