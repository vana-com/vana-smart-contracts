# DAT Vesting Analysis Tool

A command-line tool to analyze and manage token vesting wallets created by the DATFactory contract.

## Overview

This tool allows you to:
- View detailed information about all vesting wallets from a DAT creation transaction
- Track vesting progress with visual indicators
- See original and OpenZeppelin vesting parameters 
- Project vesting status at future dates
- Release available tokens to beneficiaries

## Requirements

- Node.js (v14 or higher)
- Access to an RPC endpoint for the blockchain network
- A valid private key for sending transactions (if using the release feature)

## Installation

1. Make sure you have the required dependencies installed:
   ```bash
   npm install ethers dotenv yargs
   npm install --save-dev @types/yargs
   ```
## Usage

### Basic Usage

To analyze vesting wallets from a DAT token creation transaction:

```bash
npx ts-node test-scripts/checkVesting.ts --txhash 0xYourTransactionHash
```

### Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--txhash` | `-tx` | (Required) Transaction hash of the DAT token creation |
| `--date` | `-d` | Check vesting at specific date (format: YYYY-MM-DD) |
| `--release` | `-r` | Automatically release available tokens to beneficiaries |
| `--help` | `-h` | Show help information |

### Examples

**Check current vesting status:**
```bash
npx ts-node test-scripts/checkVesting.ts --txhash 0x123abc...
```

**Project vesting status on a future date:**
```bash
npx ts-node test-scripts/checkVesting.ts --txhash 0x123abc... --date 2026-04-30
```

**Release available tokens:**
```bash
npx ts-node test-scripts/checkVesting.ts --txhash 0x123abc... --release
```

## Understanding the Output

The script provides detailed information for each vesting wallet:

### 1. Basic Information

```
🔑 Token:       Data Access Token (DAT)
📍 Address:     0x123abc...
👛 Wallet:      0xdef456...
👤 Beneficiary: 0x789ghi...
```

### 2. Original Vesting Parameters (as configured in DATFactory)

```
📋 Original Vesting Parameters
- Start date:  2025-01-01 00:00:00 (unix: 1735689600)
- Cliff:       90 days, 0 hours (7776000 seconds)
- Duration:    730 days, 0 hours (63072000 seconds, including cliff)
```

These are the parameters as they were specified when creating the token.

### 3. OpenZeppelin VestingWallet Parameters

```
📋 OpenZeppelin VestingWallet Parameters
- Start date:  2025-04-01 00:00:00 (unix: 1743465600)
- Duration:    640 days, 0 hours (55296000 seconds)
- End date:    2026-12-31 00:00:00 (unix: 1798761600)
```

These are the actual parameters used by the VestingWallet contract after conversion.

### 4. Token Amounts and Progress

```
💰 Token Amounts
- Total vesting:      100000 DAT
- Vested so far:      25000 DAT (25.00%)
- Released:           20000 DAT (20.00%)
- Currently releasable: 5000 DAT
- Remaining in wallet: 80000 DAT
- Beneficiary balance: 20000 DAT

📈 Vesting Progress
Vested:  [██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 25.00%
Released: [████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 20.00%
```

## Understanding Vesting Parameters

The key to understanding the vesting schedule is knowing how parameters are converted:

### Factory Parameters
- `start`: When vesting period begins (TGE date)
- `cliff`: Seconds after start before first tokens unlock  
- `duration`: TOTAL seconds from start until 100% vested (including cliff)

### Converted OpenZeppelin Parameters
- OZ `start` = Factory `start` + Factory `cliff`
- OZ `duration` = Factory `duration` - Factory `cliff`

### Common Vesting Patterns

| Vesting Type | duration | cliff | Effect |
|--------------|----------|-------|--------|
| Instant release | 1 | 0 | 100% unlocked immediately |
| Pure cliff | cliff + 1 | cliff | 0% until cliff, then 100% |
| Cliff + linear | cliff + period | cliff | 0% until cliff, then linear vesting |
| Pure linear | total period | 0 | Linear vesting from day 1 |

## Troubleshooting

### RPC Provider Limits
If you encounter errors like "eth_getLogs is limited to a 10,000 range", your RPC provider has a limit on log queries. Using the transaction hash approach avoids this issue.

### Unknown Transaction
If you receive "Transaction not found", verify that:
- The transaction hash is correct
- You're connected to the correct network
- The transaction was actually mined

### Release Failures
If token release fails, check that:
- Your private key has enough funds for gas
- The transaction sender is authorized to call the release function
- There are actually tokens available to release

## Advanced Usage

### Monitoring Multiple Vesting Schedules

To monitor the vesting status of multiple tokens, you can create a shell script:

```bash
#!/bin/bash
# monitor-vesting.sh

# Team token
echo "===== TEAM TOKEN ====="
npx ts-node test-scripts/checkVesting.ts --txhash 0xTeamTokenTxHash

# Advisor token
echo "===== ADVISOR TOKEN ====="
npx ts-node test-scripts/checkVesting.ts --txhash 0xAdvisorTokenTxHash
```

### Automating Token Releases

You can schedule regular releases using a cron job:

```
# Release tokens every Monday at 9 AM
0 9 * * 1 cd /path/to/project && npx ts-node test-scripts/checkVesting.ts --txhash 0xTransactionHash --release
