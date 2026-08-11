# keyscan

Finds leaked EOA private keys in a diff by **deriving** them, not by matching them.

## Why not just match the pattern

An Ethereum private key has no structure — 32 uniformly random bytes, no checksum, no
version byte, no prefix. The only pattern available is `(0x)?[0-9a-f]{64}`, and in this
repository that also matches transaction hashes, block hashes, every keccak256 digest,
merkle and state roots, storage slots, ABI-encoded 32-byte words, salts, and the
`deposit_data_root` / `withdrawal_credentials` fields in validator deposit data. 32-byte
hex *is* the native unit of this codebase.

Measured on the tracked tree at the time of writing:

| Stage | Count |
|---|---|
| 64-hex candidates in tracked files | 5,782 |
| Distinct values | 588 |
| Surviving the filters | **2** |

A rule based on shape alone would have produced several thousand annotations. Both
survivors were triaged by hand and handled outside this repository; neither was a false
positive. That precision is why GitHub ships no built-in detector for this type, and why
generic scanners are unusable here.

## How it decides

For each candidate it derives the address that key would control, then looks for positive
evidence that the key is real:

- **critical** — the derived address is in our own known-address register.
- **verified** — the derived address has real on-chain history (non-zero nonce or balance).
- **suspicious** — one weaker signal only: a secret-shaped filename or line.

Three rules keep the noise out, and each is a statement about entropy rather than a
denylist that has to be maintained:

1. **Entropy bounds.** A value must be in `[2^128, N)` where `N` is the secp256k1 curve
   order, and must not be a short pattern repeated to fill 64 characters. A real key is
   32 random bytes: it never falls below 2^128, and it is never periodic (even a
   32-character period has probability 2^-128). Anything smaller is an ABI-encoded
   integer — `bytes32(1)`, a length prefix, an array offset — and anything periodic is a
   placeholder somebody typed, like `1234567890abcdef` four times over.
2. **Public values.** Two families that are valid keys but belong to nobody: the standard
   proxy storage slots, and the Hardhat/Anvil development accounts. Both are public, so
   both have real on-chain history — the EIP-1967 implementation slot derives to an
   address with a non-zero nonce on Moksha, and Hardhat account #0 has been used on Vana
   and Moksha alike. Since that slot appears in every proxy deployment file we publish
   and those accounts appear in every test fixture, without this rule they alone produce
   hundreds of findings. Everything here is computed from its definition
   (`keccak256("eip1967.proxy.implementation") - 1`; the accounts derived from the
   standard test mnemonic), so the list cannot drift from the real values.
3. **Breadth downgrade.** A value appearing in three or more files is a shared constant;
   a leaked key is a one-off accident. Breadth never *opens* a finding, it only lowers
   the severity of one already raised.

### Known blind spot

A freshly generated key that was never funded derives to an address with no history, so
liveness will not see it. The register and the secret-shaped-context check cover part of
that tail, but not all of it. This is a backstop, not a substitute for keeping production
keys somewhere they cannot be committed in the first place.

## Where it runs, and why the hook is the important one

| Stage | Catches | Network | Blocks? |
|---|---|---|---|
| **pre-push hook** | a key before it ever leaves the machine | no | **yes** |
| CI on the PR diff | a key that was already pushed | yes | no (advisory) |
| scheduled full-tree scan | the back-catalogue, and keys funded after commit | yes | no |

**This repository is public, so CI is a smoke alarm that rings after the house is
gone.** The moment a push lands, the key is in every fork, clone and mirror, and
GitHub keeps the object even after a force-push — deleting it afterwards does not take
it back. Only the pre-push hook runs while the key is still private.

The hook runs offline in about two seconds and scans only the commits being pushed.

```bash
git config core.hooksPath .githooks   # `yarn install` does this for you
```

If it fires on something that genuinely is not a secret, mark that line rather than
reaching for `--no-verify`:

```ts
const wellKnownTestKey = "0x…"; // keyscan: allow — anvil fixture, funded by nobody
```

`--no-verify` disables *every* hook for that push. Given only that escape, people use
it habitually and the check quietly stops existing.

## Usage

```bash
# What a pull request adds (what CI runs)
npx ts-node scripts/keyscan/scan.ts --diff origin/main...HEAD

# Whole tracked tree — for a one-off baseline
npx ts-node scripts/keyscan/scan.ts --all

# Machine-readable, and non-zero exit on a confirmed hit
npx ts-node scripts/keyscan/scan.ts --diff origin/main...HEAD --json --fail-on-verified
```

Run the tests with:

```bash
npx mocha --require ts-node/register scripts/keyscan/scan.test.ts
```

They need no network and no chain.

### Environment

| Variable | Meaning |
|---|---|
| `KEYSCAN_RPC_URLS` | Comma-separated endpoints, each `name=url` or a bare url. Liveness checks are skipped entirely if unset, and the run says so rather than reporting a clean result. Name your endpoints: an unnamed one is displayed as its hostname, because provider URLs usually carry an API key and chain names reach CI logs. |
| `KEYSCAN_ADDRESS_REGISTRY` | Optional path to JSON holding known Vana addresses — an array of strings, or an object keyed by address. A candidate deriving to a registered address is reported even with no chain history. |

**Do not put a private RPC URL in the pull-request workflow.** That job runs the scanner
*from the pull request's own checkout*, and same-repository PRs do receive repository
secrets — so a PR that edits `scan.ts` could print the URL, and its API key, into the log.
The workflow therefore uses public endpoints only. Point the scanner at our own node from a
trusted context: locally, or from a workflow that does not execute PR-authored code.

## Failing closed

Liveness is the evidence this tool runs on. If an RPC is rate-limited, unreachable, or
never configured, a funded leaked key produces no finding at all — indistinguishable from
a clean run. `--fail-on-verified` therefore exits non-zero on an **incomplete** scan as
well as on a confirmed hit. A gate that passes because the chain was unreachable is worse
than no gate.

## If it fires

This repository is public. A `critical` or `verified` hit means the key is already
exposed to anyone who has ever cloned or mirrored the repo.

1. **Rotate the key and move any funds first.** Deleting the line does not undo the
   exposure, and neither does rewriting history.
2. Revoke any on-chain roles or permissions the derived address holds.
3. Only then remove it from the code.

Keys are never printed in full — output is redacted to `0xabcdef…1234` plus the derived
address, which is enough to locate the line without repeating the secret into CI logs.

## Making it blocking

The workflow is advisory (`continue-on-error: true`, no `--fail-on-verified`) so the real
false-positive rate can be observed before anyone's merge depends on it. To promote it,
remove `continue-on-error` from `.github/workflows/keyscan.yml` and add
`--fail-on-verified` to the scan step.
