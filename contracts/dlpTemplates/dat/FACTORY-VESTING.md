# DAT Factory

**2-contract stack**

| File                | Purpose                                   |
|---------------------|-------------------------------------------|
| `DAT.sol`           | ERC-20 (cap + permit + votes + pause) ready for minimal-proxy cloning. Immutable once deployed. |
| `DATFactory.sol`    | Issues EIP-1167 clones **and** spins up OpenZeppelin `VestingWallet`s from user-supplied params, then mints allocations. |

---

## 1 · Create a token with Vesting

### VestingParams Structure
```solidity
struct VestingParams {
    address beneficiary;   // who gets the tokens (vesting wallet owner)
    uint64  start;         // token generation event (unix timestamp)
    uint64  cliff;         // seconds after start before first release
    uint64  duration;      // TOTAL seconds for vesting period INCLUDING cliff
    uint256 amount;        // token units to be vested
}
```

### Parameter Details
- **start**: Unix timestamp when vesting begins (TGE date)
- **cliff**: Seconds after start before any tokens unlock
- **duration**: Total seconds for the entire vesting period (includes cliff period)
- **amount**: Tokens to vest (in smallest units, e.g., wei)

### Security Validations
The factory enforces these safety checks:
- Beneficiary cannot be zero address
- Duration must exceed cliff period
- Start, cliff, and duration must not overflow uint64
- Total minted amount cannot exceed token cap
- Various overflow protections

### JavaScript Example
```javascript
// Utility constants
const day = 24 * 60 * 60; // seconds in a day
const now = Math.floor(Date.now() / 1000); // current timestamp

// Example vesting schedules
const schedules = [
  // Team tokens: 90-day cliff, then linear vesting over 1 year
  { 
    beneficiary: teamAddress, 
    start: now, 
    cliff: 90 * day, 
    duration: 455 * day, // 90-day cliff + 365-day linear vesting
    amount: ethers.utils.parseEther("1000000") 
  },
  
  // Instant release tokens (no vesting)
  { 
    beneficiary: airdropAddress, 
    start: now, 
    cliff: 0, 
    duration: 1, // minimum duration for immediate release
    amount: ethers.utils.parseEther("250000") 
  }
];

// Create token with vesting schedules
await factory.createToken(
  "MyToken", "MYT",
  ownerAddress,
  ethers.utils.parseEther("10000000"), // cap
  schedules,
  ethers.ZeroHash // use 0x0 for ordinary CREATE, non-zero for deterministic CREATE2
);
```

## Common Vesting Patterns

| Vesting Type | duration | cliff | Effect |
|--------------|----------|-------|--------|
| Instant / no vesting | 1 | 0 | 100% releasable immediately |
| Pure cliff (all at once) | cliff + 1 | cliff | 0% until cliff, then 100% |
| Cliff + linear vesting | cliff + linear period | cliff | 0% until cliff, then linear release |
| Pure linear vesting | total period | 0 | Linear release from day 1 |

The factory automatically converts these parameters to OpenZeppelin's VestingWallet format:
- VestingWallet start = YourStart + YourCliff
- VestingWallet duration = YourDuration - YourCliff

This conversion ensures the native parameters are intuitive to users while maintaining compatibility with OpenZeppelin's implementation.

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
