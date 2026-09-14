# Why `updateMinDepositAmount` has no input validation

**Contract:** `DepositContractSeeded`
**Decision:** deliberate — validation was considered and declined (2026-08).

`updateMinDepositAmount` (and the constructor's `_minDepositAmount` argument)
accept any value, including `0`. This is not an oversight. A non-zero check
was proposed, tested, and rejected for the reasons below.

## 1. `> 0` blocks exactly one bad value while admitting every other one

The concern behind such a check is junk deposits growing the Merkle tree for
free. But set `minDepositAmount = 1` — the smallest value a `> 0` guard
permits — and a 1 gwei deposit passes (it satisfies the
`msg.value % 1 gwei == 0` check by definition). Both cases were verified
with tests during development:

- `minDepositAmount = 0` → a 0-value deposit is accepted and appends a leaf;
- `minDepositAmount = 1` → a 1 gwei deposit is accepted just the same.

From the spam perspective those outcomes are equivalent. A guard that only
excludes one point on the number line is not a floor; it reads like a
protection without providing one, which is worse than nothing.

## 2. The real protection would be a policy floor, not a validation

What actually prevents cheap tree growth is a meaningful minimum — the
canonical Ethereum contract's hard-coded `1 ether`, or Vana's operational
value of 35,000 VANA (the value the original deposit contract at
`0x17BbE91c315Bf14f38F6D35052a827cadfFe184e` enforced as both its min and
max). If enforcement in code is ever wanted, the right shape is

```solidity
require(newMinDepositAmount >= MIN_DEPOSIT_FLOOR, "...");
```

with a named constant, applied in both the constructor and the setter.
That is a governance decision about the floor value, not an input check.

## 3. The value is mutable and the owner is trusted

While `minDepositAmount` was `immutable` in an early revision, a bad deploy
value would have been permanent, and validation was worth considering. Once
the value became owner-settable, a mistake became a correctable operational
error rather than a contract defect. The owner can already set the minimum
to 1 wei deliberately, so a `> 0` check does not shrink the trust assumption
placed in the owner — it only adds gas and code surface.

This also matches the sibling `DepositImplementation`, whose
`updateMinDepositAmount` performs no validation either.

## The same reasoning covers an upper-bound check (`!= uint256.max`)

A `!= type(uint256).max` check was also considered and declined:

- The deposit path already has a hard ceiling of `type(uint64).max` gwei
  (~18.4 billion VANA) per deposit, so **any** `minDepositAmount` above that
  makes deposits impossible -- `uint256.max`, `uint256.max - 1`, `10**30`,
  all equivalently. Excluding the single value `uint256.max` changes nothing.
  A meaningful version would be
  `require(newMin <= uint256(type(uint64).max) * 1 gwei)`.
- Even the meaningful version blocks nothing the owner cannot already do
  deliberately: an unreachable minimum is functionally a pause switch, and
  `updateRestricted(true)` with an empty allowlist already provides one,
  reversibly, through the front door.
- There is no computational hazard: `minDepositAmount` is used in exactly one
  operation, the comparison `msg.value >= minDepositAmount`. It is never
  added, multiplied, or cast, so extreme values cannot overflow anything.

## Residual risk: renouncing ownership freezes the value

`renounceOwnership()` is intentionally left available so the contract can be
made ownerless once its parameters are settled. Renouncing freezes
`minDepositAmount` at its current value forever — the contract is not
upgradeable and no recovery path exists. If the owner renounces while the
value is accidentally `0`, that mistake becomes permanent.

The mitigation is procedural, not a code check: **set the final value,
verify it on-chain, then renounce.** A `> 0` guard would not help in this
scenario anyway — renouncing with the value set to 35 VANA instead of
35,000 VANA would be just as wrong, and no input validation catches it.

## Summary

The check was omitted not because zero is safe, but because this particular
guard buys approximately nothing against the risks it appears to address:
spam is addressed by the operational floor (35,000 VANA), an unreachable
minimum duplicates the pause capability restricted mode already provides,
deploy-time mistakes are addressed by mutability, and the
renounce-with-wrong-value scenario is procedural and uncatchable by input
validation. Both the lower bound (`> 0`) and the upper bound
(`!= uint256.max`) fail the same test: each excludes a single point on the
number line while admitting a continuum of values with the same effect.
