# DLP Root smart contracts - deprecated

## Table of Contents
1. [Introduction](#1-Introduction)
2. [Overview](#2-overview)
3. [Flow](#3-flow)
4. [Installation](#4-installation)
5. [Contracts](#5-contracts)
    - [DLPRootEpoch](#contracts-dlp-root-epoch)
    - [DLPRootCore](#contracts-dlp-root-core)
    - [DLPRoot](#contracts-dlp-root)
    - [DLPRootMetrics](#contracts-dlp-root-metrics)
    - [DLPRootTreasuries](#contracts-dlp-root-treasuries)
6. [Audit](#6-audit)


## 1. Introduction



## 2. Overview

### Root Epoch Contract

Handles epoch-based operations including creation, finalization, and reward distribution for DLPs across time periods.

The DLPRootEpoch contract manages the temporal structure of the Vana ecosystem through a system of epochs, which are fixed time periods (measured in blocks) during which DLPs can participate and earn rewards. It handles epoch creation, finalization, and the distribution of rewards to eligible DLPs based on their performance and stake amounts within each epoch.

Each epoch has a defined start and end block, a total reward amount to be distributed, and tracks participating DLPs along with their stake scores. The contract enables dynamic epoch creation, ensuring the system always has future epochs available for participation. When an epoch ends, it can be finalized, which locks in the participating DLPs and their metrics, and triggers the reward distribution process based on the stake scores and performance metrics from DLPRootMetrics.

The contract implements sophisticated reward calculation and distribution mechanisms that account for both the stake amount and performance rating of each DLP. It provides functions to query historical data about epochs and DLP participation, allowing for transparent tracking of rewards and performance over time. The epoch structure is configurable, with adjustable parameters like epoch size, reward amount, and maximum DLPs per epoch, providing flexibility to adapt the protocol as the ecosystem grows.

Moksha:  [0xc3d176cF6BccFCB9225b53B87a95147218e1537F](https://moksha.vanascan.io/address/0x143BE72CF2541604A7691933CAccd6D9cC17c003)

Vana mainnet: [0xc3d176cF6BccFCB9225b53B87a95147218e1537F](https://vanascan.io/address/0x143BE72CF2541604A7691933CAccd6D9cC17c003)


### DLPRootCore Contract
Manages the DLP (Delegation Liquidity Provider) lifecycle including registration, verification, and stake management with eligibility thresholds.

The DLPRootCore contract manages the lifecycle of Delegation Liquidity Providers (DLPs) in the Vana ecosystem, handling registration, verification, and eligibility status. It serves as the central registry for all DLPs, storing critical information such as their addresses, ownership details, stake amounts, and verification status, which determine their eligibility to participate in the ecosystem.

The contract implements a tiered eligibility system with configurable thresholds that determine whether a DLP can participate in epochs and receive rewards. DLPs can be in various states including Registered, Eligible, SubEligible, or Deregistered, with transitions between these states triggered by changes in stake amounts or administrative actions. The eligibility mechanism ensures that only DLPs meeting minimum stake requirements and verification standards can actively participate in the protocol.

A key feature of the contract is its historical data tracking using checkpoints, which record stake amounts and staker reward percentages at different points in time. This allows for accurate historical queries when calculating rewards for past epochs. The contract also manages the distribution between staker and owner rewards through configurable percentages, balancing incentives for both DLP operators and their stakers while maintaining security through comprehensive role-based access controls.

Moksha:  [0x0aBa5e28228c323A67712101d61a54d4ff5720FD](https://moksha.vanascan.io/address/0x0aBa5e28228c323A67712101d61a54d4ff5720FD)

Vana mainnet: [0x0aBa5e28228c323A67712101d61a54d4ff5720FD](https://vanascan.io/address/0x0aBa5e28228c323A67712101d61a54d4ff5720FD)


### DLPRoot Staking Contract

Core contract managing staking functionality including stake creation, withdrawal, migration, and reward claiming.

The DLPRoot contract serves as the central hub of the Vana staking ecosystem, managing the core staking functionality for users who want to support DLPs. It coordinates the interactions between stakers, DLPs, and the various specialized contracts in the system, including DLPRootCore, DLPRootEpoch, DLPRootMetrics, and DLPRootTreasury.

The contract enables users to create stakes on DLPs, with stakes tracked by amount, start block, and associated DLP. It implements a sophisticated reward calculation system based on stake duration and the performance of the chosen DLP, with longer stake periods receiving multiplier bonuses. Stakers can close and withdraw their stakes after optional waiting periods, or migrate their stakes to different DLPs, providing flexibility while ensuring system stability.

A key feature is the integrated reward claiming mechanism, where stakers can claim their portion of rewards earned by the DLPs they've supported, with rewards calculated based on stake score relative to total stake scores for that DLP in each epoch. The contract employs checkpoints to track historical values like withdrawal delays and claim delays, enabling accurate historical queries. The entire system is secured through role-based access controls, ensuring that sensitive operations like treasury transfers can only be performed by authorized entities.

Moksha:  [0xff14346dF2B8Fd0c95BF34f1c92e49417b508AD5](https://moksha.vanascan.io/address/0xff14346dF2B8Fd0c95BF34f1c92e49417b508AD5)

Vana mainnet: [0xff14346dF2B8Fd0c95BF34f1c92e49417b508AD5](https://vanascan.io/address/0xff14346dF2B8Fd0c95BF34f1c92e49417b508AD5)

### DLPRootMetrics Contract

The DLPRootMetrics contract manages DataDAO performance ratings and DLP reward distributiion.

The DLPRootMetrics contract calculates and tracks performance metrics for DataDAOs in the Vana ecosystem, working alongside the DLP Root contract to determine reward distribution. It uses a dual-rating system that combines stake amounts with performance metrics, where each DataDAO receives a performance rating every epoch based on their activities and contributions.

The contract implements a weighted scoring system where both stake amount and performance metrics influence the final rating, with configurable percentages for each component. This ensures that DataDAOs are incentivized not just to maintain high stake amounts, but also to perform well in their operations. Performance ratings are submitted by Vana Oracle and become final at the end of each epoch, determining the reward distribution among the top DataDAOs.

To promote long-term engagement, the system includes a multiplier mechanism that increases based on staking duration, reaching up to 300% after 64 days of staking. This multiplier affects the stake score component of the rating, while the performance component is determined by the DataDAO's actual operations and effectiveness. The contract allows for dynamic updates to performance ratings within an epoch until finalization, ensuring the system can adapt to changing conditions while maintaining security through role-based access control.

Moksha:  [0xbb532917B6407c060Afd9Cb7d53527eCb91d6662](https://moksha.vanascan.io/address/0xbb532917B6407c060Afd9Cb7d53527eCb91d6662)

Vana mainnet: [0xbb532917B6407c060Afd9Cb7d53527eCb91d6662](https://vanascan.io/address/0xbb532917B6407c060Afd9Cb7d53527eCb91d6662)

### DLPRootTreasuries

The DLPRootTreasury contracts securely manage staked and reward VANA tokens in the DLPRoot

The DLPRootTreasury contracts, consisting of DLPRootStakesTreasury and DLPRootRewardsTreasury, serve as the financial backbone of the DLPRoot system, each managing distinct aspects of VANA token flows. The DLPRootStakesTreasury securely holds all staked VANA tokens, processing deposits from both DataDAO registrations and user staking operations, while implementing strict withdrawal controls to prevent manipulation and ensure system stability.

The DLPRootRewardsTreasury complements this by managing the reward distribution process, holding VANA tokens allocated for epoch rewards and facilitating their distribution to both DataDAO treasuries and stakers. This separation of concerns ensures that staked tokens remain secure and isolated from reward operations, while maintaining efficient reward distribution channels for the ecosystem's incentive mechanisms.

By operating as separate entities but working in concert, these treasury contracts create a robust financial infrastructure that supports the DLPRoot's staking and reward mechanics. The dual-treasury design enables clear tracking of token flows and provides enhanced security through compartmentalization, ensuring that stake-related operations and reward distributions are handled through their respective dedicated pathways.

DlpRootStakesTreasury:  
Moksha:  [0x52c3260ED5C235fcA43524CF508e29c897318775](https://moksha.vanascan.io/address/0x52c3260ED5C235fcA43524CF508e29c897318775)

Vana mainnet: [0x52c3260ED5C235fcA43524CF508e29c897318775](https://vanascan.io/address/0x52c3260ED5C235fcA43524CF508e29c897318775)

DlpRootRewardsTreasury:  
Moksha:  [0xDBFb6B8b9E2eCAEbdE64d665cD553dB81e524479](https://moksha.vanascan.io/address/0xDBFb6B8b9E2eCAEbdE64d665cD553dB81e524479)

Vana mainnet: [0xDBFb6B8b9E2eCAEbdE64d665cD553dB81e524479](https://vanascan.io/address/0xDBFb6B8b9E2eCAEbdE64d665cD553dB81e524479)


## 3. Flow

### Data Contributor Flow

The following describes the process of contributing data to a DLP from a user's perspective:

Bob wants to become a data contributor for DLP1. Here's the step-by-step process:

1. Bob uploads his file to the DataRegistry (a URL with encrypted data).  
   E.g.https://moksha.vanascan.io/tx/0x900e23d55bf7706973376ff7da5a649bbf3d470bfd9020dc66d9830fd4dbd1d3
2. Bob requests an attestation by adding a new job in the TeePool.  
   E.g.https://moksha.vanascan.io/tx/0x40c58020c0cf10c8c53e412f209b60c923dc7a8c7513bf94fefe189a736b7f96?tab=logs
3. TEE operators see Bob's job and create an attestation for that file based on the instructions required for validating the file in relation to DLP1.
4. This proof is saved in the DataRegistry.  
   E.g.https://moksha.vanascan.io/tx/0x2f4dba67e90685429b73a43e74fe839e580c9e50f60ce5d460b19f88f56a2e99?tab=index
5. Bob must grant access to the DLP to read the data (by encrypting the file with the specific publicKey of DLP1).  
   E.g.https://moksha.vanascan.io/tx/0xfeeda337eeb60367a8332a664087cbef5b4e7f0882af30e36c5259c43a7042cc

   This step can be done by Bob in the first step by passing the permission along with the file.  
   E.g.https://moksha.vanascan.io/tx/0xb54582c8bfa1940a2003dff4aa729f36effeef4537181e1a68d009b32a5880d0

7. After Bob's file receives the necessary attestation, he must inform DLP1 that he owns a file and a valid proof intended for this DLP. Bob will be automatically rewarded based on the score obtained from the attestation by the TEE operator.  
   E.g. https://moksha.vanascan.io/tx/0x69c07a8e0e5fd3a2f9b9c063c4c4f1f56a9aabb18b5c0f07bd10107d0844ebd9

This process ensures that data is securely contributed, validated, and rewarded within the Vana ecosystem.

To save Bob from paying transaction fees, the DLP can act as a proxy between Bob and the smart contracts. Bob provides the DLP app with the necessary information, and the DLP can perform all the required transactions on Bob's behalf. Bob remains the owner of the file and the recipient of the allocated reward.

It's important to emphasize that this is just an example of Bob's interaction with the smart contracts. In practice, there should be a user interface (UI) that comes packaged with these contracts to assist users. This UI would simplify the process for users, making it easier for them to interact with the DLP ecosystem without needing to directly interact with the smart contracts.

### Reward distribution

The RootNetwork smart contract manages the reward distribution for Data Liquidity Pools (DLPs) in the Vana ecosystem. Here's a detailed explanation of how the reward system works:

#### DLP Registration and Staking

1. Each DLP must register in the RootNetwork contract using the `registerDLP` method.
2. During registration, the DLP specifies a `stakersPercentage`, which determines the proportion of rewards that will go to the DLP's stakers. The remainder goes to the DLP owner.

E.g.  https://moksha.vanascan.io/tx/0x84532d83be589ec1c13d9de04e426dcc7c54652060f8f78032a416d9f5dc159b

#### Epoch System

- The RootNetwork operates on an epoch-based timeline (1 hour on moksha)

#### DLP Selection Process

1. At the end of each epoch, the top 16 DLPs are selected based on their total staked amount.
2. Only these 16 DLPs participate in that epoch.
3. Other DLPs can compete for future epochs by accumulating more stakes.

#### Reward Distribution

1. At the end of each epoch, rewards are distributed to the 16 participating DLPs based on their performance during the epoch.
2. For each DLP:
    - A portion of the reward goes to the DLP owner.
    - The rest is reserved for the DLP's stakers (as per the `stakersPercentage`).
3. Staker rewards are not distributed automatically; each staker must claim their rewards individually.


#### Important Considerations

- The selection of top DLPs occurs at the start of each epoch, so staking positions at that time are crucial.
- Stakers should regularly check and claim their rewards to ensure they receive their share.
- DLP owners should carefully consider their `stakersPercentage` to balance attracting stakers and maintaining profitability.
- Data contributors should understand the specific reward mechanism of each DLP they contribute to.

This reward system incentivizes DLPs to perform well and attract stakers, while also providing flexibility in how they reward their data contributors. It creates a competitive ecosystem where DLPs strive for top positions to participate in epochs and earn rewards.


## 4. Installation

#### 1. Environment Setup

Before deploying or interacting with the contracts, you need to set up your environment variables. Follow these steps:
- Copy the `.env.example` file and rename it to `.env`.
- Open the `.env` file and update the following parameters:

`DEPLOYER_PRIVATE_KEY`: The private key of the account that will deploy the contracts. Make sure to keep this private and never share it.

`OWNER_ADDRESS`: The Ethereum address that will be set as the owner of the deployed contracts. This address will have special privileges in the contracts.

<a id="env-truested_forwarder_address"></a>
`TRUSTED_FORWARDER_ADDRESS`: The address of the trusted forwarder contract. This contract is used for gasless transactions. (E.g. **0x853407D0C625Ce7E43C0a2596fBc470C3a6f8305**). Read [gelato documentation](https://docs.gelato.network/web3-services/relay/supported-networks#new-deployments-oct-2024) for more details.  
The integration with gelato is optional, you can set this parameter to 0x0000000000000000000000000000000000000000 if you don't want to use it.

`DLP_NAME`: The name of your Data Liquidity Pool. Choose a descriptive name for your DLP.

`DLP_PUBLIC_KEY`: A public key for your DLP. This is used for encryption purposes. Make sure to generate a strong, unique key.

`DLP_TOKEN_NAME`: The name of the token associated with your DLP. This will be visible in token listings.

`DLP_TOKEN_SYMBOL`: The symbol of your DLP token. This is typically a short, all-caps code.

`DLP_FILE_REWARD_FACTOR`: A factor used to calculate file rewards. This value determines the reward amount based on the file's score.

#### 2. Install dependencies
```bash
yarn install
```

#### 3. Run tests
- DLPRoot tests: ```npx hardhat test test/dlpRoot/root.ts```

#### 4. Deploy

#### DLPRoot
```bash
npx hardhat deploy --network moksha --tags DLPRootDeploy
```

#### DLPRootMetrics
```bash
npx hardhat deploy --network moksha --tags DLPRootMetricsDeploy
```

#### DLPRootTreasury
```bash
npx hardhat deploy --network moksha --tags DLPRootTreasuryDeploy
```


The deployment scripts will also verify the contract on blockscout.

#### 5. Register your DLP on the RootNetwork
After deploying your DLP, you need to register it on the RootNetwork contract. This will allow your DLP to participate in the Vana ecosystem and receive rewards. To register your DLP, call the `registerDlp` function on the RootNetwork contract.

   ```solidity
   function registerDlp(
       address dlpAddress,
       address payable dlpOwnerAddress,
       uint256 stakersPercentage
   ) external payable
   ```

    - `dlpAddress`: The address of your DLP contract
    - `dlpOwnerAddress`: The address that will be set as the owner of the DLP
    - `stakersPercentage`: The percentage of rewards that will be distributed to stakers (in 18 decimal format, e.g., 50% would be 50e18)
- Send the required stake amount with the transaction. The value sent with the transaction (`msg.value`) must be at least the `minDlpStakeAmount` (0.1 Vana on moksha).

E.g.  https://moksha.vanascan.io/tx/0x84532d83be589ec1c13d9de04e426dcc7c54652060f8f78032a416d9f5dc159b

### After Registration

Upon successful registration:
1. The DLP is assigned a unique ID.
2. The DLP's details are stored in the contract.
3. The sent stake amount is recorded for the DLP owner as a stake.
4. The DLP is added to the list of registered DLPs.
5. Users can start staking VANA tokens to the DLP to participate in the reward distribution.


## 5. Contracts

<a id="contracts-dlp-root-epoch"></a>
### DLPRootEpoch

```solidity
struct InitParams {
    address trustedForwarder;
    address payable ownerAddress;
    uint256 eligibleDlpsLimit;
    uint256 epochDlpsLimit;
    uint256 minStakeAmount;
    uint256 minDlpStakersPercentage;
    uint256 maxDlpStakersPercentage;
    uint256 minDlpRegistrationStake;
    uint256 dlpEligibilityThreshold;
    uint256 dlpSubEligibilityThreshold;
    uint256 stakeWithdrawalDelay;
    uint256 rewardClaimDelay;
    uint256 startBlock;
    uint256 epochSize;
    uint256 daySize;
    uint256 epochRewardAmount;
}

function initialize(InitParams memory params) external initializer
```

Initializes the contract with configuration parameters.

Parameters:
- `params`: Struct containing initialization parameters including owner address, limits, thresholds and delays

Restrictions:
- Can only be called once due to initializer modifier
- Parameter values must meet specific validation rules

---

```solidity
function numberOfTopDlps() external view returns (uint256)
```

Returns the number of top DLPs.

Returns:
- `uint256`: The number of top DLPs

---

```solidity
function maxNumberOfRegisteredDlps() external view returns (uint256)
```

Returns the maximum number of registered DLPs.

Returns:
- `uint256`: The maximum number of registered DLPs

---

```solidity
function epochSize() external view returns (uint256)
```

Returns the size of each epoch in blocks.

Returns:
- `uint256`: The size of each epoch in blocks

---

```solidity
function registeredDlps() external view returns (uint256[] memory)
```

Returns an array of registered DLP IDs.

Returns:
- `uint256[] memory`: Array of registered DLP IDs

---

```solidity
function dlpsCount() external view returns (uint256)
```

Returns the total number of DLPs.

Returns:
- `uint256`: Total number of DLPs

---

```solidity
function dlps(uint256 index) external view returns (DlpResponse memory)
```

Returns information about a DLP by its index.

Parameters:
- `index`: Index of the DLP

Returns:
- `DlpResponse`: Struct containing DLP information

---

```solidity
function dlpsByAddress(address dlpAddress) external view returns (DlpResponse memory)
```

Returns information about a DLP by its address.

Parameters:
- `dlpAddress`: Address of the DLP

Returns:
- `DlpResponse`: Struct containing DLP information

---

```solidity
function dlpsByName(string calldata dlpName) external view returns (DlpInfo memory)
```

Returns information about a DLP by its name.

Parameters:
- `dlpName`: Name of the DLP

Returns:
- `DlpInfo`: Struct containing DLP information

---

```solidity
function dlpIds(address dlpAddress) external view returns (uint256)
```

Returns the ID of a DLP given its address.

Parameters:
- `dlpAddress`: Address of the DLP

Returns:
- `uint256`: ID of the DLP

---

```solidity
function dlpEpochs(uint256 dlpId, uint256 epochId) external view returns (DlpEpochInfo memory)
```

Returns information about a DLP's performance in a specific epoch.

Parameters:
- `dlpId`: ID of the DLP
- `epochId`: ID of the epoch

Returns:
- `DlpEpochInfo`: Struct containing DLP epoch information

---

```solidity
function stakerDlpsListCount(address stakerAddress) external view returns (uint256)
```

Returns the number of DLPs a staker has staked in.

Parameters:
- `stakerAddress`: Address of the staker

Returns:
- `uint256`: Number of DLPs staked in

---

```solidity
struct DlpRegistration {
    address dlpAddress;
    address ownerAddress;
    address payable treasuryAddress;
    uint256 stakersPercentage;
    string name;
    string iconUrl;
    string website;
    string metadata;
}

function registerDlp(DlpRegistration calldata registrationInfo) external payable
```

Registers a new DLP with metadata and initial stake.

Parameters:
- `registrationInfo`: DLP configuration including addresses, stake split and metadata

Restrictions:
- Contract must not be paused
- Initial stake must be >= minDlpRegistrationStake
- Name must be unique and non-empty
- Stakers percentage must be between min and max allowed values

Events:
- `DlpRegistered`
- `StakeCreated`

---

```solidity
function updateDlp(uint256 dlpId, DlpRegistration calldata dlpUpdateInfo) external
```

Updates an existing DLP's information.

Parameters:
- `dlpId`: ID of the DLP to update
- `dlpUpdateInfo`: New DLP configuration

Restrictions:
- Can only be called by DLP owner
- Cannot change DLP address
- Stakers percentage must be within allowed range

Events:
- `DlpUpdated`

---

```solidity
function closeStakes(uint256[] memory stakeIds) external
```

Closes multiple stakes in one transaction.

Parameters:
- `stakeIds`: Array of stake IDs to close

Restrictions:
- Must be stake owner
- Stakes must not be already closed

Events:
- `StakeClosed` for each stake

---

```solidity
function withdrawStakes(uint256[] memory stakeIds) external
```

Withdraws multiple closed stakes.

Parameters:
- `stakeIds`: Array of stake IDs to withdraw

Restrictions:
- Stakes must be closed
- Withdrawal delay period must have passed

Events:
- `StakeWithdrawn` for each stake

---

```solidity
function deregisterDlp(uint256 dlpId) external
```

Deregisters a DLP.

Parameters:
- `dlpId`: ID of the DLP

Restrictions:
- Must be DLP owner
- DLP must be in valid status
- Contract must not be paused

Events:
- `DlpDeregistered`

---

```solidity
function stake(uint256 dlpId) external payable
```

Stakes tokens in a DLP.

Parameters:
- `dlpId`: ID of the DLP

Restrictions:
- DLP must be in Registered status
- Current epoch must be created
- Stake amount must meet minimum

Events:
- `Staked`

---

```solidity
function unstake(uint256 dlpId, uint256 amount) external
```

Unstakes tokens from a DLP.

Parameters:
- `dlpId`: ID of the DLP
- `amount`: Amount to unstake

Restrictions:
- Amount must be <= unstakeable amount
- Current epoch must be created

Events:
- `Unstaked`

---

```solidity
function estimatedDlpReward(uint256 dlpId) external view returns (uint256 historyRewardEstimation, uint256 stakeRewardEstimation)
```

Gets estimated rewards for a DLP.

Parameters:
- `dlpId`: ID of the DLP

Returns:
- `historyRewardEstimation`: Estimated reward based on history
- `stakeRewardEstimation`: Estimated reward based on current stake

Note: Both return values are scaled by 1e18

---

```solidity
function calculateStakeScore(uint256 stakeAmount, uint256 stakeStartBlock, uint256 blockNumber) public view returns (uint256)
```

Calculates a stake's score based on amount and duration.

Parameters:
- `stakeAmount`: Amount staked
- `stakeStartBlock`: Block when staked
- `blockNumber`: Block to calculate for

Returns:
- Score including duration multiplier

---

```solidity
function createEpochs() external
function createEpochsUntilBlockNumber(uint256 blockNumber) external
```

Creates new epochs up to current block or specified block number.

Parameters:
- `blockNumber`: Target block number (for second function)

Restrictions:
- Contract must not be paused

Events:
- `EpochCreated` for each new epoch

The contract maintains role-based access control:
- DEFAULT_ROLE_ADMIN: System administration and contract upgrades
- MAINTAINER_ROLE: System maintenance and parameter updates
- MANAGER_ROLE: Epoch scores and performance metrics

---  

<a id="contracts-dlp-root-metrics"></a>
### DLPRootMetrics

```solidity
function initialize(
    address trustedForwarderAddress,
    address ownerAddress,
    address dlpRootAddress,
    uint256 stakeRatingPercentage,
    uint256 performanceRatingPercentage
) external initializer
```

Initializes the contract with required parameters.

Parameters:
- `trustedForwarderAddress`: Address of the trusted forwarder for meta-transactions
- `ownerAddress`: Address of the contract owner
- `dlpRootAddress`: Address of the DLPRoot contract
- `stakeRatingPercentage`: Initial percentage for stake rating
- `performanceRatingPercentage`: Initial percentage for performance rating

Restrictions:
- Can only be called once due to `initializer` modifier
- Sum of rating percentages must equal 100e18

---

```solidity
function epochs(uint256 epochId) external view returns (EpochInfo memory)
```

Returns information about a specific epoch.

Parameters:
- `epochId`: ID of the epoch to query

Returns:
- `EpochInfo`: Struct containing total performance rating and finalized status

---

```solidity
function epochDlps(uint256 epochId, uint256 dlpId) external view returns (EpochDlpInfo memory)
```

Returns information about a specific DLP's performance in an epoch.

Parameters:
- `epochId`: ID of the epoch
- `dlpId`: ID of the DLP

Returns:
- `EpochDlpInfo`: Struct containing performance rating

---

```solidity
function topDlps(
    uint256 epochId,
    uint256 numberOfDlps,
    uint256[] memory dlpIds,
    uint256[] memory customRatingPercentages
) external view returns (DlpRating[] memory)
```

Returns top performing DLPs based on combined stake and performance ratings.

Parameters:
- `epochId`: ID of the epoch
- `numberOfDlps`: Maximum number of DLPs to return
- `dlpIds`: Array of DLP IDs to consider
- `customRatingPercentages`: Custom percentages for stake and performance ratings

Returns:
- Array of `DlpRating` structs containing DLP IDs and their ratings

---

```solidity
function estimatedDlpRewardPercentages(
    uint256[] memory dlpIds,
    uint256[] memory customRatingPercentages
) external view returns (IDLPRoot.DlpRewardApy[] memory)
```

Calculates estimated reward percentages for given DLPs.

Parameters:
- `dlpIds`: Array of DLP IDs to calculate rewards for
- `customRatingPercentages`: Custom percentages for stake and performance ratings

Returns:
- Array of `DlpRewardApy` structs containing EPY and APY calculations

---

```solidity
function getMultiplier(uint256 index) external pure returns (uint256)
```

Returns the stake score multiplier based on duration.

Parameters:
- `index`: Duration index (0-63)

Returns:
- Multiplier value (100-300)

---

```solidity
function saveEpochPerformanceRatings(
    uint256 epochId,
    bool shouldFinalize,
    DlpPerformanceRating[] memory dlpPerformanceRatings
) external
```

Saves or updates performance ratings for DLPs in an epoch.

Parameters:
- `epochId`: ID of the epoch
- `shouldFinalize`: Whether to finalize the epoch
- `dlpPerformanceRatings`: Array of performance ratings for DLPs

Restrictions:
- Can only be called by addresses with MANAGER_ROLE
- Contract must not be paused
- Epoch must not be already finalized
- If finalizing, epoch must have ended

Events Emitted:
- `EpochPerformanceRatingsSaved`
- `DlpEpochPerformanceRatingSaved` for each DLP

---

```solidity
function updateRatingPercentages(
    uint256 stakeRatingPercentage,
    uint256 performanceRatingPercentage
) external
```

Updates the percentages used for stake and performance ratings.

Parameters:
- `stakeRatingPercentage`: New percentage for stake rating
- `performanceRatingPercentage`: New percentage for performance rating

Restrictions:
- Can only be called by addresses with MAINTAINER_ROLE
- Sum of percentages must equal 100e18

Events Emitted:
- `RatingPercentagesUpdated` for each rating type

---

```solidity
function pause() external
```

Pauses the contract operations.

Restrictions:
- Can only be called by addresses with MAINTAINER_ROLE

---

```solidity
function unpause() external
```

Unpauses the contract operations.

Restrictions:
- Can only be called by addresses with MAINTAINER_ROLE

---

```solidity
function updateDlpRoot(address dlpRootAddress) external
```

Updates the DLPRoot contract address.

Parameters:
- `dlpRootAddress`: New DLPRoot contract address

Restrictions:
- Can only be called by addresses with MAINTAINER_ROLE

---

```solidity
function updateTrustedForwarder(address trustedForwarderAddress) external
```

Updates the trusted forwarder address for meta-transactions.

Parameters:
- `trustedForwarderAddress`: New trusted forwarder address

Restrictions:
- Can only be called by addresses with MAINTAINER_ROLE

___

<a id="contracts-dlp-root-treasuries"></a>
### DLPRootTreasuries

The DLPRoot system uses two treasury contracts to manage different types of funds:
1. DLPRootStakesTreasury: Manages the staked VANA tokens
2. DLPRootRewardsTreasury: Manages the rewards for DLP creators and stakers

Both treasuries share the same implementation but serve different purposes in the ecosystem.

```solidity
function initialize(address ownerAddress, address dlpRootAddress) external initializer
```

Initializes the treasury contract.

Parameters:
- `ownerAddress`: Address that will be granted the DEFAULT_ADMIN_ROLE
- `dlpRootAddress`: Address of the DLPRoot contract

Restrictions:
- Can only be called once due to `initializer` modifier
- Both the owner and DLPRoot addresses are granted DEFAULT_ADMIN_ROLE

---

```solidity
function version() external pure returns (uint256)
```

Returns the version of the contract.

Returns:
- `uint256`: The version number (1 for current implementation)

---

```solidity
function dlpRoot() external view returns (IDLPRoot)
```

Returns the address of the DLPRoot contract.

Returns:
- `IDLPRoot`: The DLPRoot contract interface

---

```solidity
function transferVana(address payable to, uint256 value) external returns (bool)
```

Transfers VANA tokens to a specified address.

Parameters:
- `to`: Recipient address
- `value`: Amount of VANA to transfer

Returns:
- `bool`: True if the transfer was successful

Restrictions:
- Can only be called by addresses with DEFAULT_ADMIN_ROLE
- Contract must not be paused

---

```solidity
function updateDlpRoot(address dlpRootAddress) external
```

Updates the DLPRoot contract address.

Parameters:
- `dlpRootAddress`: New DLPRoot contract address

Restrictions:
- Can only be called by addresses with DEFAULT_ADMIN_ROLE

Effects:
- Revokes DEFAULT_ADMIN_ROLE from old DLPRoot address
- Grants DEFAULT_ADMIN_ROLE to new DLPRoot address

---

```solidity
function pause() external
```

Pauses the contract operations.

Restrictions:
- Can only be called by addresses with DEFAULT_ADMIN_ROLE

---

```solidity
function unpause() external
```

Unpauses the contract operations.

Restrictions:
- Can only be called by addresses with DEFAULT_ADMIN_ROLE

---

```solidity
receive() external payable
```

Allows the contract to receive VANA tokens.

Parameters: None

Restrictions: None

---

The treasuries function as secure vaults for different types of funds in the DLP ecosystem:

1. **DLPRootStakesTreasury**:
    - Holds staked VANA tokens from DLP owners and stakers
    - Manages stake withdrawals after delay periods
    - Ensures stake security and withdrawal restrictions

2. **DLPRootRewardsTreasury**:
    - Holds VANA tokens allocated for rewards
    - Distributes rewards to DLPs and their stakers
    - Manages reward calculations and distributions based on performance metrics

Both treasuries are controlled by the DLPRoot contract through the DEFAULT_ADMIN_ROLE, ensuring secure and coordinated fund management in the ecosystem.

___

### 6. Audit

All contracts have been thoroughly audited by two reputable blockchain security firms: Hashlock and Nethermind. Multiple audit rounds have been conducted over time, with each significant smart contract update undergoing its own audit process to ensure security as the protocol evolved and new features were added.

For detailed audit reports, please visit:
- https://hashlock.com/audits/vana
- https://www.nethermind.io/smart-contract-audits