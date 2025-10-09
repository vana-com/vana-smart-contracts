# DLP Rewards System - Developer Documentation

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Core Contracts](#core-contracts)
- [Contract Interactions](#contract-interactions)
- [Performance Metrics](#performance-metrics)
- [Epoch Lifecycle](#epoch-lifecycle)
- [Reward Distribution](#reward-distribution)
- [DEX Integration](#dex-integration)
- [Key Design Patterns](#key-design-patterns)
- [Development Guidelines](#development-guidelines)
- [Testing](#testing)

## Overview

The DLP Rewards system is a sophisticated ecosystem for managing and distributing rewards across Data Liquidity Pools (DLPs) and DataDAOs within the Vana network. The system operates on an epoch-based model where rewards are allocated based on performance metrics, with automated distribution mechanisms ensuring efficient market liquidity and fair compensation.

### Key Features

- **Performance-Based Rewards**: Rewards allocated based on three key metrics:
    - Token Trading Volume (30%)
    - Unique Data Contributors (20%)
    - Data Access Fees (50%)

- **Epoch-Based Distribution**: Quarterly reward cycles with configurable epoch sizes

- **Tranche-Based Deployment**: Gradual reward distribution over multiple tranches to prevent market manipulation

- **Automated DEX Integration**: Seamless token swapping and liquidity provision through Uniswap V3

- **Penalty System**: Performance penalties that reduce reward allocations for non-compliant DLPs

- **Eligibility Management**: Dynamic DLP eligibility based on verification, token setup, and liquidity provision

## Architecture

The DLP Rewards system consists of six primary contract groups, each handling specific aspects of the reward lifecycle:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DLP Rewards System                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────┐      ┌──────────────────┐     ┌────────────────┐ │
│  │ DLPRegistry   │◄─────┤  VanaEpoch       │────►│ DLPPerformance │ │
│  │               │      │  (Epoch Manager) │     │                │ │
│  └───────┬───────┘      └────────┬─────────┘     └───────┬────────┘ │
│          │                       │                        │         │
│          │                       ▼                        │         │
│          │              ┌───────────────────┐             │         │
│          │              │ DLPRewardDeployer │◄────────────┘         │
│          │              │ (Distribution)    │                       │
│          │              └────────┬──────────┘                       │
│          │                       │                                  │
│          │                       ▼                                  │
│          │              ┌───────────────────┐                       │
│          └─────────────►│ DLPRewardSwap     │                       │
│                         │ (Liquidity Mgmt)  │                       │
│                         └────────┬──────────┘                       │
│                                  │                                  │
│                                  ▼                                  │
│                         ┌───────────────────┐                       │
│                         │   SwapHelper      │                       │
│                         │   (DEX Interface) │                       │
│                         └───────────────────┘                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Contract Flow

1. **Registration Phase**: DLPs register through `DLPRegistry` with deposit and metadata
2. **Eligibility Determination**: DLPs become eligible upon verification, token setup, and LP token creation
3. **Performance Tracking**: `DLPPerformance` tracks metrics throughout each epoch
4. **Epoch Finalization**: `VanaEpoch` finalizes epochs and calculates reward allocations
5. **Reward Distribution**: `DLPRewardDeployer` distributes rewards in tranches
6. **Token Swaps**: `DLPRewardSwap` and `SwapHelper` handle DEX operations

## Core Contracts

### 1. DLPRegistry

**Location**: `contracts/dlpRewards/dlpRegistry/`

**Purpose**: Central registry for all DLPs in the Vana ecosystem, managing registration, verification, and eligibility status.

**Key Responsibilities**:
- DLP registration with deposit requirements
- Ownership and metadata management
- Verification status tracking
- Eligibility determination based on token setup and verification
- Migration support from legacy DLP systems

**Key Functions**:

```solidity
// Registration
function registerDlp(DlpRegistration calldata registrationInfo) external payable;

// Eligibility Management
function updateDlpTokenAndVerification(
    uint256 dlpId,
    address tokenAddress,
    uint256 lpTokenId,
    uint256 verificationBlockNumber
) external;

// Query Functions
function dlps(uint256 dlpId) external view returns (DlpInfo memory);
function eligibleDlpsListValues() external view returns (uint256[] memory);
function isEligibleDlp(uint256 dlpId) external view returns (bool);
```

**DLP Status States**:
- `None`: Not registered
- `Registered`: Registered but not eligible for rewards
- `Eligible`: Fully verified and eligible for rewards
- `Deregistered`: Removed from the system

**Eligibility Criteria** (DLPRegistryImplementation.sol:411-441):
A DLP becomes eligible when ALL of the following conditions are met:
- `lpTokenId != 0` (has Uniswap V3 liquidity position)
- `tokenAddress != address(0)` (has associated token)
- `verificationBlockNumber > 0` (verified by maintainers)
- Status is `Registered` or `Eligible`

### 2. VanaEpoch

**Location**: `contracts/dlpRewards/vanaEpoch/`

**Purpose**: Manages the epoch lifecycle, including creation, finalization, and reward allocation across DLPs.

**Key Responsibilities**:
- Automatic epoch creation based on block numbers
- Epoch reward pool management
- DLP reward allocation and finalization
- Bonus reward tracking for special cases
- Last epoch enforcement to prevent infinite epochs

**Key Functions**:

```solidity
// Epoch Management
function createEpochs() external;
function createEpochsUntilBlockNumber(uint256 blockNumber) external;

// Reward Allocation
function saveEpochDlpRewards(uint256 epochId, Rewards[] calldata dlpRewards) external;
function overrideEpochDlpReward(
    uint256 epochId,
    uint256 dlpId,
    uint256 rewardAmount,
    uint256 penaltyAmount
) external;

// Epoch Information
function epochs(uint256 epochId) external view returns (EpochInfo memory);
function epochDlps(uint256 epochId, uint256 dlpId) external view returns (EpochDlpInfo memory);
```

**Epoch Lifecycle**:

1. **Creation**: Epochs are created automatically when `createEpochs()` is called
2. **Active Period**: DLPs accumulate performance metrics during the epoch
3. **End**: Epoch ends at the configured `endBlock`
4. **Finalization**: Performance data is submitted and epoch is marked as finalized
5. **Distribution**: Rewards are distributed over multiple tranches

**Configuration Parameters** (VanaEpochImplementation.sol:59-68):
- `daySize`: Number of blocks per day (~7200 on Vana mainnet)
- `epochSize`: Number of days per epoch (e.g., 90 days for quarterly)
- `epochRewardAmount`: Total VANA rewards per epoch
- `lastEpoch`: Maximum epoch number to prevent infinite creation

### 3. DLPPerformance

**Location**: `contracts/dlpRewards/dlpPerformance/`

**Purpose**: Tracks and calculates performance metrics for each DLP, determining reward allocations based on weighted scores.

**Key Responsibilities**:
- Performance metric tracking (trading volume, contributors, data access fees)
- Score normalization across all eligible DLPs
- Penalty application for non-compliance
- Epoch performance finalization and reward calculation

**Key Functions**:

```solidity
// Performance Submission
function saveEpochPerformances(
    uint256 epochId,
    EpochDlpPerformanceInput[] calldata newEpochDlpPerformances
) external;

// Score Calculation
function calculateEpochDlpRewards(
    uint256 epochId,
    uint256 dlpId
) external view returns (uint256 rewardAmount, uint256 penaltyAmount);

// Performance Override
function overrideEpochPerformances(
    uint256 epochId,
    EpochDlpPerformanceInput[] calldata newEpochDlpPerformances
) external;
```

**Metric Weights** (DLPPerformanceImplementation.sol:165-178):
Default configuration (configurable by maintainers):
- Trading Volume: 30% (0.30e18)
- Unique Contributors: 20% (0.20e18)
- Data Access Fees: 50% (0.50e18)

Total must equal 100% (1e18)

**Score Normalization** (DLPPerformanceImplementation.sol:216-264):
- Each metric score is normalized to sum to 1e18 across all eligible DLPs
- Tolerance of 1e9 allowed for rounding errors
- Total score per DLP: `(tradingVolumeScore * 0.3 + uniqueContributorsScore * 0.2 + dataAccessFeesScore * 0.5)`

**Penalty System** (DLPPerformanceImplementation.sol:395-428):
Penalties are applied per-metric and reduce the effective reward:
```solidity
penaltyAmount = (
    dataAccessFeesScore * dataAccessFeesScorePenalty * dataAccessFeesRewardAmount +
    tradingVolumeScore * tradingVolumeScorePenalty * tradingVolumeRewardAmount +
    uniqueContributorsScore * uniqueContributorsScorePenalty * uniqueContributorsRewardAmount
) / 1e36;

finalReward = rewardAmount - penaltyAmount;
```

### 4. DLPRewardDeployer

**Location**: `contracts/dlpRewards/dlpRewardDeployer/`

**Purpose**: Orchestrates the gradual distribution of rewards to DLPs over multiple tranches, with slippage protection.

**Key Responsibilities**:
- Tranche-based reward distribution
- Slippage protection during token swaps
- Penalty amount withdrawal management
- Distribution timing enforcement

**Key Functions**:

```solidity
// Reward Distribution
function distributeRewards(uint256 epochId, uint256[] calldata dlpIds) external;

// Initialization
function initializeEpochRewards(
    uint256 epochId,
    uint256 distributionInterval,
    uint256 numberOfTranches,
    uint256 remediationWindow
) external;

// Penalty Withdrawal
function withdrawEpochDlpPenaltyAmount(
    uint256 epochId,
    uint256 dlpId,
    address recipientAddress
) external;
```

**Tranche Distribution Logic** (DLPRewardDeployerImplementation.sol:221-244):

Timing Requirements:
1. **Tranche Start Block**: `epoch.endBlock + remediationWindow + (distributionInterval * currentTrancheNumber)`
2. **Minimum Interval**: `numberOfBlocksBetweenTranches` must pass since last tranche

**Tranche Amount Calculation** (DLPRewardDeployerImplementation.sol:246-301):
```solidity
totalRewardToDistribute = (rewardAmount + bonusAmount) > penaltyAmount
    ? (rewardAmount + bonusAmount - penaltyAmount)
    : 0;

trancheAmount = (totalRewardToDistribute - alreadyDistributed) / remainingTranches;
```

**Distribution Process**:
1. Transfer VANA from treasury to deployer
2. Split into reward and liquidity portions
3. Execute swap and liquidity provision via `DLPRewardSwap`
4. Record distribution details and update tracking

**Configuration Parameters**:
- `numberOfBlocksBetweenTranches`: Minimum blocks between consecutive tranches
- `rewardPercentage`: Percentage allocated as direct token rewards (vs liquidity)
- `maximumSlippagePercentage`: Maximum allowed slippage for swaps

### 5. DLPRewardSwap

**Location**: `contracts/dlpRewards/dlpRewardSwap/`

**Purpose**: Handles complex token swap and liquidity provision operations for reward distribution.

**Key Responsibilities**:
- Optimal swap amount calculation for balanced liquidity provision
- Uniswap V3 position management (increase liquidity)
- Slippage protection during swaps
- Split reward execution (direct rewards + liquidity)

**Key Functions**:

```solidity
// Main Distribution Function
function splitRewardSwap(
    SplitRewardSwapParams calldata params
) external payable returns (
    uint256 tokenRewardAmount,
    uint256 spareToken,
    uint256 spareVana,
    uint256 usedVanaAmount
);

// Quote Function
function quoteSplitRewardSwap(
    QuoteSplitRewardSwapParams calldata params
) external view returns (
    uint256 tokenRewardAmount,
    uint256 spareToken,
    uint256 spareVana,
    uint256 usedVanaAmount
);
```

**Split Reward Process** (DLPRewardSwapImplementation.sol:512-597):

1. **Split Allocation**:
   ```solidity
   rewardAmount = totalAmount * rewardPercentage / 100e18;
   lpAmount = totalAmount - rewardAmount;
   ```

2. **Liquidity Provision** (`lpSwap`):
    - Calculate optimal swap amount using binary search
    - Swap portion of VANA to DLP token
    - Add both tokens as liquidity to Uniswap V3 position
    - Return spare tokens

3. **Direct Reward Distribution**:
    - Swap VANA reward amount to DLP token
    - Transfer to DLP treasury
    - Apply slippage protection

4. **Spare Token Handling**:
    - Return unused VANA to spare recipient
    - Return unused DLP tokens to spare recipient

**LP Swap Optimization** (DLPRewardSwapImplementation.sol:105-392):

The contract uses binary search to find the optimal amount to swap before providing liquidity:

```
Goal: Maximize liquidity added to the position
Constraint: Stay within slippage limits

Binary Search on swap amount (1 to amountIn):
  For each mid value:
    1. Quote swap at current price with slippage limit
    2. Calculate liquidity from remaining tokens
    3. Compare with best found so far
    4. Adjust search range based on limiting factor (token0 or token1)
```

**Special Cases**:
- **Out of Range (Low)**: Only token0 needed, no swap required
- **Out of Range (High)**: Only token1 needed, no swap required
- **In Range**: Both tokens needed, binary search finds optimal split

### 6. SwapHelper

**Location**: `contracts/dlpRewards/swapHelper/`

**Purpose**: Provides abstraction layer over Uniswap V3 for token swaps with slippage protection.

**Key Responsibilities**:
- Uniswap V3 swap execution
- Slippage limit calculation and enforcement
- WVANA wrapping/unwrapping
- Swap simulation and quoting

**Key Functions**:

```solidity
// Swap Execution
function exactInputSingle(
    ExactInputSingleParams calldata params
) external payable returns (uint256 amountOut);

function slippageExactInputSingle(
    SlippageSwapParams calldata params
) external payable returns (uint256 amountInUsed, uint256 amountOut);

// Quote Functions
function quoteExactInputSingle(
    QuoteExactInputSingleParams calldata params
) external returns (uint256 amountOut);

function quoteSlippageExactInputSingle(
    QuoteSlippageExactInputSingleParams calldata params
) external view returns (Quote memory quote);
```

**Slippage Protection** (SwapHelperImplementation.sol:169-218):

The contract calculates price limits based on maximum slippage:

```solidity
// For zeroForOne (selling token0 for token1):
slippageFactor = 100% - maximumSlippagePercentage;

// For oneForZero (selling token1 for token0):
slippageFactor = 100% + maximumSlippagePercentage;

sqrtPriceLimitX96 = currentSqrtPriceX96 * sqrt(slippageFactor);
```

If the swap would exceed this price limit, it stops early and refunds unused tokens.

**Swap Simulation** (SwapHelperImplementation.sol:381-497):

The `simulateSwap` function provides accurate quotes by:
1. Simulating tick-by-tick swap execution
2. Tracking liquidity changes at initialized ticks
3. Calculating exact amounts in/out considering fees
4. Respecting price limits

This simulation matches actual Uniswap V3 behavior without executing transactions.

## Contract Interactions

### Registration and Eligibility Flow

```
User/DLP Owner
    │
    ├─► registerDlp(info) ──► DLPRegistry
    │                              │
    │                              ├─► Status: Registered
    │                              │
Maintainer                         │
    │                              │
    ├─► updateDlpTokenAndVerification() ──► DLPRegistry
                                       │
                                       ├─► Check: tokenAddress ≠ 0?
                                       ├─► Check: lpTokenId ≠ 0?
                                       ├─► Check: verificationBlockNumber > 0?
                                       │
                                       └─► Status: Eligible
```

### Epoch Finalization Flow

```
Block Production
    │
    ├─► createEpochs() ──► VanaEpoch
    │                          │
    │                          └─► Create new epochs up to current block
    │
Epoch End (endBlock reached)
    │
    ├─► saveEpochPerformances() ──► DLPPerformance
    │                                    │
    │                                    ├─► Validate scores sum to 1e18
    │                                    └─► Store performance data
    │
    ├─► confirmEpochFinalScores() ──► DLPPerformance
                                       │
                                       ├─► calculateEpochDlpRewards()
                                       │       └─► Apply penalties
                                       │
                                       └─► saveEpochDlpRewards() ──► VanaEpoch
                                                                      │
                                                                      └─► isFinalized = true
```

### Reward Distribution Flow

```
Maintainer
    │
    ├─► initializeEpochRewards() ──► DLPRewardDeployer
    │                                     │
    │                                     └─► Set numberOfTranches, intervals
    │
Reward Deployer Bot (scheduled)
    │
    ├─► distributeRewards(epochId, dlpIds[]) ──► DLPRewardDeployer
                                                      │
                                                      ├─► Check timing constraints
                                                      │
                                                      ├─► Calculate tranche amount
                                                      │
                                                      └─► For each DLP:
                                                          │
                                                          ├─► treasury.transfer(VANA) ──► DLPRewardDeployer
                                                          │
                                                          └─► splitRewardSwap() ──► DLPRewardSwap
                                                                  │
                                                                  ├─► lpSwap() ──► increase liquidity
                                                                  │   │
                                                                  │   ├─► quoteLpSwap() (binary search)
                                                                  │   │
                                                                  │   ├─► slippageExactInputSingle() ──► SwapHelper
                                                                  │   │       └─► Uniswap V3 Router
                                                                  │   │
                                                                  │   └─► positionManager.increaseLiquidity()
                                                                  │
                                                                  └─► Reward swap
                                                                      └─► slippageExactInputSingle() ──► SwapHelper
                                                                          └─► Uniswap V3 Router
```

## Performance Metrics

### Metric Definitions

#### 1. Token Trading Volume
- **Measurement**: Total USD value of DLP token trading activity
- **Weight**: 30%
- **Data Source**: Off-chain indexers tracking DEX volumes
- **Normalization**: Scores distributed proportionally across all DLPs

#### 2. Unique Data Contributors
- **Measurement**: Number of unique addresses contributing data to the DLP
- **Weight**: 20%
- **Data Source**: On-chain events from DLP contracts
- **Normalization**: Can use various formulas (linear, logarithmic, etc.)

#### 3. Data Access Fees
- **Measurement**: Total fees paid to access DLP data (in USD/VANA equivalent)
- **Weight**: 50%
- **Data Source**: On-chain payment tracking
- **Normalization**: Proportional distribution based on fee revenue

### Performance Submission Process

**Off-chain Calculation**:
1. Indexer tracks all relevant events during epoch
2. Calculates raw metrics for each DLP
3. Normalizes scores so each metric sums to 1e18 across all DLPs
4. Applies any penalties for non-compliance

**On-chain Submission** (DLPPerformanceImplementation.sol:181-265):
```solidity
function saveEpochPerformances(
    uint256 epochId,
    EpochDlpPerformanceInput[] calldata performances
) external {
    // Validations:
    // 1. Epoch not already finalized
    // 2. Performance count matches eligible DLP count
    // 3. No duplicate DLP IDs
    // 4. All DLPs are eligible
    // 5. Each metric score sums to ~1e18 (tolerance: ±1e9)

    // Store performance data
    // Emit events for tracking
}
```

### Score Validation

The contract enforces strict validation on submitted scores:

```solidity
// Sum validation with tolerance
if (tradingVolumeTotalScore > 1e18 || tradingVolumeTotalScore < 1e18 - 1e9) {
    revert InvalidTradingVolumeScore();
}
```

Tolerance of 1e9 (0.000000001%) accounts for:
- Rounding errors in off-chain calculations
- Integer division precision limits
- Gas optimization trade-offs

## Epoch Lifecycle

### 1. Epoch Creation

**Automatic Creation** (VanaEpochImplementation.sol:326-347):
```solidity
function _createEpochsUntilBlockNumber(uint256 blockNumber) internal {
    while (currentEpoch.endBlock < blockNumber) {
        // Check lastEpoch limit
        if (epochsCount >= lastEpoch) {
            revert LastEpochExceeded(lastEpoch);
        }

        Epoch storage newEpoch = _epochs[++epochsCount];
        newEpoch.startBlock = currentEpoch.endBlock + 1;
        newEpoch.endBlock = newEpoch.startBlock + epochSize * daySize - 1;
        newEpoch.rewardAmount = epochRewardAmount;

        emit EpochCreated(epochsCount, ...);
    }
}
```

**Configuration**:
- `epochSize`: 90 days (quarterly)
- `daySize`: ~7200 blocks (2 seconds per block)
- Total blocks per epoch: 90 * 7200 = 648,000 blocks (~15 days)

### 2. Active Period

During the active period:
- DLPs accumulate performance metrics off-chain
- Users interact with DLPs (contribute data, access data, trade tokens)
- No on-chain state changes related to rewards
- DLPs must maintain eligibility criteria

### 3. Epoch End

When `block.number > epoch.endBlock`:
- Epoch is considered ended
- Performance data can be submitted
- No new metrics accumulated for this epoch

### 4. Performance Submission

**Manager Role** submits performance data:

```solidity
saveEpochPerformances(epochId, performanceData[]);
```

Validates and stores:
- Raw metrics (tradingVolume, uniqueContributors, dataAccessFees)
- Normalized scores (must sum to 1e18 per metric)
- Performance data for all eligible DLPs

### 5. Epoch Finalization

**Maintainer** confirms final scores:

```solidity
confirmEpochFinalScores(epochId);
```

This function:
1. Verifies epoch has ended
2. Calculates rewards for each DLP
3. Applies penalties
4. Calls `VanaEpoch.saveEpochDlpRewards()`
5. Sets `epoch.isFinalized = true`

### 6. Distribution Initialization

**Maintainer** initializes distribution parameters:

```solidity
initializeEpochRewards(
    epochId,
    distributionInterval,  // e.g., 86400 blocks (~2 days)
    numberOfTranches,      // e.g., 45 tranches over 90 days
    remediationWindow      // e.g., 43200 blocks (~1 day grace period)
);
```

### 7. Reward Distribution

**Reward Deployer Role** distributes tranches:

```solidity
distributeRewards(epochId, [dlpId1, dlpId2, ...]);
```

For each DLP:
1. Calculate tranche amount
2. Execute split reward swap
3. Record distribution
4. Emit events

### 8. Epoch Completion

Epoch is complete when:
- All tranches distributed for all eligible DLPs
- OR DLPs fail to maintain eligibility (forfeit remaining rewards)

## Reward Distribution

### Distribution Parameters

**Configurable by Maintainer**:

1. **Number of Tranches** (`numberOfTranches`):
    - Typical: 45 tranches for 90-day epoch
    - One tranche every ~2 days

2. **Distribution Interval** (`distributionInterval`):
    - Typical: 86,400 blocks (~2 days)
    - Minimum time before first tranche starts

3. **Remediation Window** (`remediationWindow`):
    - Typical: 43,200 blocks (~1 day)
    - Grace period after epoch ends before distributions begin

4. **Reward Percentage** (`rewardPercentage`):
    - Typical: 50% (50e18)
    - Split between direct rewards and liquidity provision

5. **Maximum Slippage** (`maximumSlippagePercentage`):
    - Typical: 2% (2e18)
    - Maximum price impact allowed per swap

### Timing Constraints

**Tranche Distribution Timing** (DLPRewardDeployerImplementation.sol:221-244):

```solidity
// Minimum start time for tranche N:
minStartBlock = epoch.endBlock
              + remediationWindow
              + (distributionInterval * trancheNumber);

// Minimum time between tranches:
minNextBlock = lastTrancheBlock + numberOfBlocksBetweenTranches;

// Both conditions must be satisfied
require(block.number >= minStartBlock, "TrancheIntervalNotStarted");
require(block.number >= minNextBlock, "NumberOfBlocksBetweenTranchesNotPassed");
```

**Example Timeline**:
```
Epoch End: Block 1,000,000
Remediation Window: 43,200 blocks
Distribution Interval: 86,400 blocks
Number Between Tranches: 14,400 blocks

Tranche 1: Block 1,129,600 (1,000,000 + 43,200 + 86,400*0)
Tranche 2: Block 1,144,000 (min 1,129,600 + 14,400 or 1,216,000)
Tranche 3: Block 1,158,400 ...
...
Tranche 45: Block 2,847,600 (~90 days later)
```

### Distribution Execution

**Step 1: Tranche Amount Calculation**

```solidity
// Net reward after penalties
totalRewardToDistribute = (rewardAmount + bonusAmount) > penaltyAmount
    ? (rewardAmount + bonusAmount - penaltyAmount)
    : 0;

// Divide remaining by remaining tranches
trancheAmount = (totalRewardToDistribute - alreadyDistributed)
              / (numberOfTranches - tranchesDistributed);
```

**Step 2: Transfer from Treasury**

```solidity
treasury.transfer(address(this), address(0), trancheAmount);
```

**Step 3: Split Reward Swap**

```solidity
dlpRewardSwap.splitRewardSwap{value: trancheAmount}(
    SplitRewardSwapParams({
        lpTokenId: dlp.lpTokenId,
        rewardPercentage: rewardPercentage,  // e.g., 50%
        maximumSlippagePercentage: maximumSlippagePercentage,  // e.g., 2%
        rewardRecipient: dlp.treasuryAddress,
        spareRecipient: address(treasury)
    })
);
```

This call:
1. Splits VANA into reward (50%) and LP (50%) portions
2. Executes LP swap and liquidity provision
3. Swaps reward portion to DLP token
4. Sends tokens to appropriate recipients
5. Returns spare tokens to treasury

**Step 4: Record Distribution**

```solidity
epochDlpReward.totalDistributedAmount += trancheAmount;
epochDlpReward.distributedRewards[trancheCount] = DistributedReward({
    amount: trancheAmount,
    blockNumber: block.number,
    tokenRewardAmount: tokenRewardAmount,
    spareToken: spareToken,
    spareVana: spareVana,
    usedVanaAmount: usedVanaAmount
});
```

### Penalty Handling

**Penalty Calculation** (DLPPerformanceImplementation.sol:417-428):
```solidity
penaltyAmount = (
    dataAccessFeesScore * dataAccessFeesScorePenalty * dataAccessFeesRewardAmount +
    tradingVolumeScore * tradingVolumeScorePenalty * tradingVolumeRewardAmount +
    uniqueContributorsScore * uniqueContributorsScorePenalty * uniqueContributorsRewardAmount
) / 1e36;
```

**Penalty Enforcement**:
- Penalties reduce the `totalRewardToDistribute`
- Penalty amounts can be withdrawn by maintainer
- Withdrawn penalties return to global reward pool

**Penalty Withdrawal** (DLPRewardDeployerImplementation.sol:198-219):
```solidity
function withdrawEpochDlpPenaltyAmount(
    uint256 epochId,
    uint256 dlpId,
    address recipientAddress
) external {
    uint256 toWithdrawAmount = epochDlp.penaltyAmount - distributedPenaltyAmount;
    treasury.transfer(recipientAddress, address(0), toWithdrawAmount);
}
```

## DEX Integration

### Uniswap V3 Integration

The DLP Rewards system integrates with Uniswap V3 for:
1. Token swaps (VANA ↔ DLP Token)
2. Liquidity provision (increase liquidity in existing positions)
3. Price quotation and simulation

### Key Uniswap V3 Concepts

**Concentrated Liquidity**:
- Liquidity providers specify price ranges
- Capital efficiency higher than Uniswap V2
- Position represented as NFT with `tokenId`

**Price Representation**:
- Prices stored as `sqrtPriceX96` (Q64.96 fixed-point)
- `price = (sqrtPriceX96 / 2^96)^2`

**Tick System**:
- Price ranges defined by ticks
- Each tick represents 0.01% price change
- Liquidity concentrated between `tickLower` and `tickUpper`

### SwapHelper Integration

**Uniswap V3 Router**:
```solidity
IV3SwapRouter(uniswapV3Router).exactInputSingle(swapParams);
```

**WVANA Handling**:
```solidity
// For VANA (address(0)) inputs:
1. Receive ETH/VANA via payable function
2. Wrap to WVANA for Uniswap compatibility
3. Approve router to spend WVANA
4. Execute swap
5. Unwrap WVANA to VANA for output (if needed)
6. Transfer native VANA to recipient
```

**Slippage Protection** (SwapHelperImplementation.sol:192-218):
```solidity
// Calculate sqrt price limit
uint160 sqrtPriceLimitX96 = _getSqrtPriceLimitX96(
    zeroForOne,
    currentSqrtPriceX96,
    maximumSlippagePercentage
);

// If swap would exceed limit, stops early
// Unused input tokens refunded to caller
```

### DLPRewardSwap Liquidity Provision

**Challenge**: Providing balanced liquidity requires optimal swap amount

**Solution**: Binary search to maximize liquidity added

**Algorithm** (DLPRewardSwapImplementation.sol:187-376):

```
Input: amountIn (VANA), targetPosition (lpTokenId)

1. Get position parameters:
   - tickLower, tickUpper (price range)
   - currentPrice

2. Binary search on swapAmount (0 to amountIn):
   For each candidate:
     a. Quote swap: swapAmount VANA → DLP Token
     b. Calculate after-swap balances:
        - amount0 = VANA or DLP token remaining
        - amount1 = DLP token or VANA remaining
     c. Calculate liquidity from these amounts
     d. Track best (highest liquidity)

3. Execute swap at optimal amount

4. Increase liquidity with both tokens:
   positionManager.increaseLiquidity({
       tokenId: lpTokenId,
       amount0Desired: amount0,
       amount1Desired: amount1,
       ...
   })

5. Return spare tokens
```

**Edge Cases**:

1. **Price Out of Range (Below)**:
    - Only token0 needed
    - No swap required
    - Add all as token0

2. **Price Out of Range (Above)**:
    - Only token1 needed
    - No swap required
    - Add all as token1

3. **Price In Range**:
    - Both tokens needed
    - Binary search finds optimal split
    - Liquidity balanced for current price

### Position Manager Integration

**Increase Liquidity** (DLPRewardSwapImplementation.sol:482-491):
```solidity
(uint128 liquidity, uint256 amount0, uint256 amount1) =
    positionManager.increaseLiquidity(
        IncreaseLiquidityParams({
            tokenId: lpTokenId,
            amount0Desired: amount0Desired,
            amount1Desired: amount1Desired,
            amount0Min: 0,  // Accept any amount (we control slippage via swap)
            amount1Min: 0,
            deadline: block.timestamp
        })
    );
```

**Position Requirements**:
- Position must exist (created by DLP)
- Position must pair WVANA with DLP token
- Position must be owned by DLP (or approved)
- Sufficient liquidity available in pool

## Key Design Patterns

### 1. Proxy Pattern

**All main contracts use UUPS Upgradeable Proxy Pattern**:

```
User/Contract
     ↓
DLPRegistryProxy ────────► DLPRegistryImplementation (logic)
     │                              ↑
     │ (delegatecall)               │
     └──────────────────────────────┘
           (storage)
```

**Benefits**:
- Upgradeable logic without changing addresses
- Preserves storage and state
- Security through access control on upgrades

**Implementation**:
```solidity
contract DLPRegistryImplementation is UUPSUpgradeable {
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {}
}
```

### 2. Role-Based Access Control

**OpenZeppelin AccessControl** used throughout:

```solidity
bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
bytes32 public constant REWARD_DEPLOYER_ROLE = keccak256("REWARD_DEPLOYER_ROLE");
```

**Role Hierarchy**:
- `DEFAULT_ADMIN_ROLE`: Can grant/revoke all roles, authorize upgrades
- `MAINTAINER_ROLE`: Can update configuration, manage contracts
- `MANAGER_ROLE`: Can submit performance data (subset of MAINTAINER)
- `REWARD_DEPLOYER_ROLE`: Can distribute rewards (automated bot)

### 3. Treasury Pattern

**Separate Treasury Contracts** manage funds:

```solidity
interface ITreasury {
    function transfer(
        address recipient,
        address token,
        uint256 amount
    ) external;
}
```

**Benefits**:
- Centralized fund management
- Multi-signature support possible
- Audit trail for all transfers
- Separation of concerns

**Usage**:
```solidity
// Withdraw from treasury
treasury.transfer(address(this), address(0), trancheAmount);

// Return spare to treasury
treasury.transfer(address(treasury), address(0), spareAmount);
```

### 4. Pausable Pattern

**Emergency Stop Mechanism**:

```solidity
function pause() external onlyRole(MAINTAINER_ROLE) {
    _pause();
}

function distributeRewards(...) external whenNotPaused {
    // Function only works when not paused
}
```

**Protected Functions**:
- Registration/updates in DLPRegistry
- Performance submissions
- Reward distributions
- Swap operations

### 5. Reentrancy Guard

**Protection Against Reentrancy Attacks**:

```solidity
function distributeRewards(...)
    external
    nonReentrant
    whenNotPaused
{
    // External calls to DEX, treasury, etc.
}
```

**Applied to**:
- All functions making external calls
- Functions transferring ETH/tokens
- DEX interaction functions

### 6. Check-Effects-Interactions Pattern

**Example from DLPRewardDeployer** (DLPRewardDeployerImplementation.sol:246-301):

```solidity
// 1. CHECKS
require(block.number >= minStartBlock, "TrancheIntervalNotStarted");
require(totalDistributed < totalReward, "NothingToDistribute");

// 2. EFFECTS (update state)
++epochDlpReward.tranchesCount;
epochDlpReward.totalDistributedAmount += trancheAmount;
epochDlpReward.distributedRewards[trancheCount] = DistributedReward({...});

// 3. INTERACTIONS (external calls)
treasury.transfer(address(this), address(0), trancheAmount);
dlpRewardSwap.splitRewardSwap{value: trancheAmount}(...);
```

### 7. EnumerableSet for Gas-Efficient Tracking

**Used in DLPRegistry and VanaEpoch**:

```solidity
using EnumerableSet for EnumerableSet.UintSet;

EnumerableSet.UintSet private _eligibleDlpsList;

// Add/remove O(1)
_eligibleDlpsList.add(dlpId);
_eligibleDlpsList.remove(dlpId);

// Query O(1)
bool isEligible = _eligibleDlpsList.contains(dlpId);
uint256 count = _eligibleDlpsList.length();

// Iterate O(n)
uint256[] memory dlpIds = _eligibleDlpsList.values();
```

## Development Guidelines

### Environment Setup

```bash
# Install dependencies
yarn install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Run specific test file
npx hardhat test test/dlpRewards/DLPRegistry.test.ts

# Run with gas reporting
REPORT_GAS=true npx hardhat test

# Generate coverage report
npx hardhat coverage
```

### Configuration Files

**Network Configuration** (`hardhat.config.ts`):
```typescript
networks: {
  vana: {
    url: process.env.VANA_RPC_URL,
    chainId: 1480,
    accounts: [process.env.DEPLOYER_PRIVATE_KEY]
  },
  moksha: {
    url: process.env.MOKSHA_RPC_URL,
    chainId: 14800,
    accounts: [process.env.DEPLOYER_PRIVATE_KEY]
  }
}
```

**Environment Variables** (`.env`):
```bash
DEPLOYER_PRIVATE_KEY=<your-private-key>
VANA_RPC_URL=https://rpc.vana.org
MOKSHA_RPC_URL=https://rpc.moksha.vana.org
```

### Deployment

**Deploy Scripts** (`deploy/`):

```bash
# Deploy to Moksha testnet
npx hardhat deploy --network moksha --tags DLPRewardsDeploy

# Deploy to Vana mainnet
npx hardhat deploy --network vana --tags DLPRewardsDeploy

# Deploy specific contract
npx hardhat deploy --network moksha --tags DLPRegistry
```

**Deploy Script Structure**:
```typescript
const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Deploy implementation
  const implementation = await deploy('DLPRegistryImplementation', {
    from: deployer,
    args: [],
    log: true,
  });

  // Deploy proxy
  const proxy = await deploy('DLPRegistryProxy', {
    from: deployer,
    args: [implementation.address, proxyAdminAddress, initializeData],
    log: true,
  });
};
```

### Verification

**Verify on Block Explorer**:

```bash
# Verify implementation contract
npx hardhat verify --network moksha <implementation-address>

# Verify proxy contract
npx hardhat verify --network moksha <proxy-address> \
  <implementation-address> \
  <admin-address> \
  <initialize-data>
```

### Upgrading Contracts

**Upgrade Process**:

1. Deploy new implementation:
```bash
npx hardhat deploy --network moksha --tags DLPRegistryImplementation
```

2. Verify new implementation:
```bash
npx hardhat verify --network moksha <new-implementation-address>
```

3. Upgrade proxy (via multisig/admin):
```typescript
const proxy = await ethers.getContractAt('UUPSUpgradeable', proxyAddress);
await proxy.upgradeTo(newImplementationAddress);
```

4. Test upgraded contract:
```typescript
const contract = await ethers.getContractAt('DLPRegistryImplementation', proxyAddress);
const version = await contract.version();
console.log('New version:', version);
```

### Testing Best Practices

**Unit Tests** - Test individual functions:
```typescript
describe('DLPRegistry', () => {
  it('should register a new DLP', async () => {
    await dlpRegistry.registerDlp({
      dlpAddress: dlp.address,
      ownerAddress: owner.address,
      treasuryAddress: treasury.address,
      name: 'Test DLP',
      iconUrl: 'https://icon.url',
      website: 'https://website.com',
      metadata: '{}'
    }, { value: depositAmount });

    const dlpInfo = await dlpRegistry.dlps(1);
    expect(dlpInfo.name).to.equal('Test DLP');
  });
});
```

**Integration Tests** - Test contract interactions:
```typescript
describe('Epoch Finalization', () => {
  it('should finalize epoch and distribute rewards', async () => {
    // Setup
    await createEpoch();
    await advanceToEpochEnd();

    // Submit performance
    await dlpPerformance.saveEpochPerformances(1, performanceData);

    // Confirm scores
    await dlpPerformance.confirmEpochFinalScores(1);

    // Verify finalization
    const epoch = await vanaEpoch.epochs(1);
    expect(epoch.isFinalized).to.be.true;
  });
});
```

**Gas Optimization Tests**:
```typescript
it('should gas efficiently update multiple DLPs', async () => {
  const tx = await dlpRegistry.batchUpdateDlps(updates);
  const receipt = await tx.wait();
  expect(receipt.gasUsed).to.be.lt(1000000);
});
```

### Security Considerations

**Access Control**:
- Always use role modifiers on admin functions
- Grant minimum necessary roles
- Use multisig for admin roles in production

**Input Validation**:
```solidity
require(params.ownerAddress != address(0), "InvalidAddress");
require(params.amount > 0, "ZeroAmount");
require(params.percentage <= ONE_HUNDRED_PERCENT, "InvalidPercentage");
```

**Reentrancy Protection**:
- Use `nonReentrant` on functions making external calls
- Follow checks-effects-interactions pattern

**Integer Overflow/Underflow**:
- Solidity 0.8.x has built-in protection
- Still be mindful of multiplication before division

**External Call Safety**:
```solidity
// Check return value
(bool success, ) = recipient.call{value: amount}("");
require(success, "TransferFailed");

// Or use OpenZeppelin's Address.sendValue
payable(recipient).sendValue(amount);
```

### Monitoring and Events

**Key Events to Monitor**:

```solidity
// DLP Lifecycle
event DlpRegistered(uint256 indexed dlpId, ...);
event DlpStatusUpdated(uint256 indexed dlpId, DlpStatus newStatus);

// Epoch Lifecycle
event EpochCreated(uint256 epochId, uint256 startBlock, uint256 endBlock);
event EpochFinalized(uint256 epochId);

// Performance Tracking
event EpochDlpPerformancesSaved(uint256 indexed epochId, uint256 indexed dlpId, ...);

// Reward Distribution
event EpochDlpRewardDistributed(uint256 indexed epochId, uint256 indexed dlpId, ...);

// Swap Operations
event Swap(address indexed sender, address indexed recipient, ...);
```

**Monitoring Setup**:
1. Index events using The Graph or custom indexer
2. Alert on unusual patterns (large slippage, failed distributions)
3. Track reward distribution progress per epoch
4. Monitor DLP eligibility changes

## Testing

### Test Structure

```
test/dlpRewards/
├── DLPRegistry.test.ts
├── VanaEpoch.test.ts
├── DLPPerformance.test.ts
├── DLPRewardDeployer.test.ts
├── DLPRewardSwap.test.ts
├── SwapHelper.test.ts
├── integration/
│   ├── EpochLifecycle.test.ts
│   └── RewardDistribution.test.ts
└── helpers/
    ├── fixtures.ts
    └── utils.ts
```

### Running Tests

```bash
# All tests
npx hardhat test

# Specific contract
npx hardhat test test/dlpRewards/DLPRegistry.test.ts

# With gas reporting
REPORT_GAS=true npx hardhat test

# Coverage
npx hardhat coverage

# Watch mode (requires hardhat-watcher)
npx hardhat watch test
```

### Test Fixtures

```typescript
// fixtures.ts
export async function deployDLPRewardsFixture() {
  const [owner, user1, user2] = await ethers.getSigners();

  // Deploy contracts
  const dlpRegistry = await deployDLPRegistry();
  const vanaEpoch = await deployVanaEpoch();
  const dlpPerformance = await deployDLPPerformance();
  const dlpRewardDeployer = await deployDLPRewardDeployer();
  const swapHelper = await deploySwapHelper();
  const dlpRewardSwap = await deployDLPRewardSwap();

  // Setup connections
  await dlpRegistry.updateVanaEpoch(vanaEpoch.address);
  await vanaEpoch.updateDlpRegistry(dlpRegistry.address);
  await vanaEpoch.updateDlpPerformance(dlpPerformance.address);
  // ... more setup

  return {
    dlpRegistry,
    vanaEpoch,
    dlpPerformance,
    dlpRewardDeployer,
    swapHelper,
    dlpRewardSwap,
    owner,
    user1,
    user2
  };
}
```

### Time Manipulation

```typescript
import { mine, time } from "@nomicfoundation/hardhat-network-helpers";

// Advance blocks
await mine(1000);

// Advance time
await time.increase(86400); // 1 day

// Set specific block
await mine(1000, { interval: 2 }); // Mine 1000 blocks, 2 seconds apart
```

### Testing Patterns

**Testing State Transitions**:
```typescript
it('should transition DLP from Registered to Eligible', async () => {
  // Initial state
  let dlp = await dlpRegistry.dlps(dlpId);
  expect(dlp.status).to.equal(DlpStatus.Registered);

  // Trigger transition
  await dlpRegistry.updateDlpTokenAndVerification(
    dlpId,
    tokenAddress,
    lpTokenId,
    verificationBlock
  );

  // Final state
  dlp = await dlpRegistry.dlps(dlpId);
  expect(dlp.status).to.equal(DlpStatus.Eligible);
});
```

**Testing Reverts**:
```typescript
it('should revert when non-owner tries to update DLP', async () => {
  await expect(
    dlpRegistry.connect(user1).updateDlp(dlpId, updateInfo)
  ).to.be.revertedWith('NotDlpOwner');
});
```

**Testing Events**:
```typescript
it('should emit DlpRegistered event', async () => {
  await expect(dlpRegistry.registerDlp(registrationInfo, { value: depositAmount }))
    .to.emit(dlpRegistry, 'DlpRegistered')
    .withArgs(1, dlpAddress, ownerAddress, treasuryAddress, ...);
});
```

**Testing Gas Usage**:
```typescript
it('should efficiently process 100 DLPs', async () => {
  const tx = await dlpPerformance.saveEpochPerformances(
    epochId,
    performanceData // 100 DLPs
  );
  const receipt = await tx.wait();

  console.log('Gas used:', receipt.gasUsed.toString());
  expect(receipt.gasUsed).to.be.lt(10000000); // Under 10M gas
});
```

### Integration Testing

**Full Epoch Cycle**:
```typescript
describe('Full Epoch Lifecycle', () => {
  it('should complete entire epoch process', async () => {
    // 1. Setup
    const { dlpRegistry, vanaEpoch, dlpPerformance, dlpRewardDeployer } =
      await loadFixture(deployDLPRewardsFixture);

    // 2. Register DLPs
    await registerMultipleDLPs(10);

    // 3. Make DLPs eligible
    await makeAllDLPsEligible();

    // 4. Create epoch
    await vanaEpoch.createEpochs();
    const epochId = await vanaEpoch.epochsCount();

    // 5. Advance to epoch end
    const epoch = await vanaEpoch.epochs(epochId);
    await mine(epoch.endBlock - (await ethers.provider.getBlockNumber()) + 1);

    // 6. Submit performance
    const performanceData = generatePerformanceData(10);
    await dlpPerformance.saveEpochPerformances(epochId, performanceData);

    // 7. Finalize epoch
    await dlpPerformance.confirmEpochFinalScores(epochId);

    // 8. Initialize distribution
    await dlpRewardDeployer.initializeEpochRewards(
      epochId,
      86400, // distributionInterval
      45,    // numberOfTranches
      43200  // remediationWindow
    );

    // 9. Distribute first tranche
    const eligibleDlps = await dlpRegistry.eligibleDlpsListValues();
    await mine(43200 + 86400); // Wait for first tranche
    await dlpRewardDeployer.distributeRewards(epochId, eligibleDlps);

    // 10. Verify distribution
    const dlpRewardInfo = await dlpRewardDeployer.epochDlpRewards(epochId, eligibleDlps[0]);
    expect(dlpRewardInfo.totalDistributedAmount).to.be.gt(0);
  });
});
```

### Mock Contracts

**Use mocks for external dependencies**:

```typescript
// MockUniswapV3Router.sol
contract MockUniswapV3Router {
    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        returns (uint256 amountOut)
    {
        // Simplified swap logic for testing
        amountOut = params.amountIn * 99 / 100; // 1% slippage
        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
    }
}
```

### Continuous Integration

**GitHub Actions** (`.github/workflows/test.yml`):
```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: yarn install
      - run: npx hardhat compile
      - run: npx hardhat test
      - run: npx hardhat coverage
```

---

## Additional Resources

- **Vana Documentation**: https://docs.vana.org
- **Audit Reports**: Available from Hashlock and Nethermind
- **Smart Contract Standards**:
    - VRC-14: Reward distribution standard
    - VRC-15: Data access standard
    - VRC-20: Token standard

## Contract Addresses

### Vana Mainnet (Chain ID: 1480)

| Contract | Address |
|----------|---------|
| VanaEpoch | `0x2063cFF0609D59bCCc196E20Eb58A8696a6b15A0` |
| DLPRegistry | `0x4D59880a924526d1dD33260552Ff4328b1E18a43` |
| DLPRegistryTreasury | `0xb12ce1d27bEeFe39b6F0110b1AB77C21Aa0c9F9a` |
| DLPPerformance | `0x847715C7DB37cF286611182Be0bD333cbfa29cc1` |
| DLPRewardDeployer | `0xEFD0F9Ba9De70586b7c4189971cF754adC923B04` |
| DLPRewardDeployerTreasury | `0xb547ca8Fe4990fe330FeAeb1C2EBb42F925Af5b8` |
| DLPRewardSwap | `0x7c6862C46830F0fc3bF3FF509EA1bD0EE7267fB0` |
| SwapHelper | `0x55D5e6F73326315bF2E091e97F04f0770e5C54e2` |

### Moksha Testnet (Chain ID: 14800)

| Contract | Address |
|----------|---------|
| VanaEpoch | `0x2063cFF0609D59bCCc196E20Eb58A8696a6b15A0` |
| DLPRegistry | `0x4D59880a924526d1dD33260552Ff4328b1E18a43` |
| DLPRegistryTreasury | `0xb12ce1d27bEeFe39b6F0110b1AB77C21Aa0c9F9a` |
| DLPPerformance | `0x847715C7DB37cF286611182Be0bD333cbfa29cc1` |
| DLPRewardDeployer | `0xEFD0F9Ba9De70586b7c4189971cF754adC923B04` |
| DLPRewardDeployerTreasury | `0xb547ca8Fe4990fe330FeAeb1C2EBb42F925Af5b8` |
| DLPRewardSwap | `0x7c6862C46830F0fc3bF3FF509EA1bD0EE7267fB0` |
| SwapHelper | `0x55D5e6F73326315bF2E091e97F04f0770e5C54e2` |

---

