# Data Liquidity Pool (DLP)

## Table of Contents
1. [Introduction](#1-Introduction)
2. [Overview](#2-overview)
3. [Flow](#3-flow)
4. [Installation](#4-installation)
5. [Contracts](#5-contracts)
   - [Vana Core Contracts](#vana-core-contracts)
      - [DataRegistry](#contracts-data-registry)
      - [TeePool](#contracts-tee-pool)
      - [DLPRootEpoch](#contracts-dlp-root-epoch)
      - [DLPRootCore](#contracts-dlp-root-core)
      - [DLPRoot](#contracts-dlp-root)
      - [DLPRootMetrics](#contracts-dlp-root-metrics)
      - [DLPRootTreasuries](#contracts-dlp-root-treasuries)
      - [Deposit](#contracts-deposit)
   - [DLP Template Contracts](#dlp-template-contracts)
      - [DataLiquidityPool](#contracts-data-liquidity-pool)
      - [DAT (Data Access Token)](##contracts-dat)
   - [Utilities Contracts](#utilities-contracts)
      - [Multisend](#contracts-multisend)
      - [Multicall3](#contracts-multicall3)
6. [Audit](#6-audit)


## 1. Introduction

Vana turns data into currency to push the frontiers of decentralized AI. It is a layer one blockchain designed for private, user-owned data. It allows users to collectively own, govern, and earn from the AI models trained on their data. For more context see this [docs](https://docs.vana.org/vana).


## 2. Overview

### Data Registry Contract

The data registry is the main entry point for data in the Vana network.

The data registry contract functions as a central repository for managing all data within the network, functioning as a comprehensive file catalog. It allows users to add new files to the system, with each file receiving a unique identifier for future reference.

The contract manages access control for these files, enabling file owners to grant specific addresses permission to access their files. It also handles the storage of file metadata, including any offchain proofs or attestations related to file validation, which can include various metrics such as authenticity, ownership, and quality scores. Users can retrieve detailed information about any file in the registry using its unique identifier, including its permissions and associated proofs.

Moksha: [0xEA882bb75C54DE9A08bC46b46c396727B4BFe9a5](https://moksha.vanascan.io/address/0xEA882bb75C54DE9A08bC46b46c396727B4BFe9a5)

Vana mainnet: [0xEA882bb75C54DE9A08bC46b46c396727B4BFe9a5](https://vanascan.io/address/0xEA882bb75C54DE9A08bC46b46c396727B4BFe9a5)

### TEE Pool Contract

The TEE Pool orchestrates TEEs in the Satya Network.

The Satya Network specializes in the validation of data contributions to DataDAOs, running their Proof of Contribution. These validators operate within a Trusted Execution Environment (TEE), ensuring that data can be validated securely and privately. This allows for privacy-preserving validation, where the data being processed is shielded from both the validator and external parties.

The TEE Pool contract manages and coordinates the TEE Validators and serves as an escrow for holding fees associated with validation tasks. Users pay a fee to submit data for validation, and the contract ensures that the validators process the data and provide proof of validation. The contract also allows the owner to add or remove validators, and it securely holds and disburses the fees related to these validation services.

Moksha: [0xF084Ca24B4E29Aa843898e0B12c465fAFD089965](https://moksha.vanascan.io/address/0xF084Ca24B4E29Aa843898e0B12c465fAFD089965)

Vana mainnet: [0xF084Ca24B4E29Aa843898e0B12c465fAFD089965](https://vanascan.io/address/0xF084Ca24B4E29Aa843898e0B12c465fAFD089965)

### Root Epoch Contract

Handles epoch-based operations including creation, finalization, and reward distribution for DLPs across time periods.

The DLPRootEpoch contract manages the temporal structure of the Vana ecosystem through a system of epochs, which are fixed time periods (measured in blocks) during which DLPs can participate and earn rewards. It handles epoch creation, finalization, and the distribution of rewards to eligible DLPs based on their performance and stake amounts within each epoch.

Each epoch has a defined start and end block, a total reward amount to be distributed, and tracks participating DLPs along with their stake scores. The contract enables dynamic epoch creation, ensuring the system always has future epochs available for participation. When an epoch ends, it can be finalized, which locks in the participating DLPs and their metrics, and triggers the reward distribution process based on the stake scores and performance metrics from DLPRootMetrics.

The contract implements sophisticated reward calculation and distribution mechanisms that account for both the stake amount and performance rating of each DLP. It provides functions to query historical data about epochs and DLP participation, allowing for transparent tracking of rewards and performance over time. The epoch structure is configurable, with adjustable parameters like epoch size, reward amount, and maximum DLPs per epoch, providing flexibility to adapt the protocol as the ecosystem grows.

Moksha:  [0xc3d176cF6BccFCB9225b53B87a95147218e1537F](https://moksha.vanascan.io/address/0xc3d176cF6BccFCB9225b53B87a95147218e1537F)

Vana mainnet: [0xc3d176cF6BccFCB9225b53B87a95147218e1537F](https://vanascan.io/address/0xc3d176cF6BccFCB9225b53B87a95147218e1537F)


### Root Core Contract
Manages the DLP (Delegation Liquidity Provider) lifecycle including registration, verification, and stake management with eligibility thresholds.

The DLPRootCore contract manages the lifecycle of Delegation Liquidity Providers (DLPs) in the Vana ecosystem, handling registration, verification, and eligibility status. It serves as the central registry for all DLPs, storing critical information such as their addresses, ownership details, stake amounts, and verification status, which determine their eligibility to participate in the ecosystem.

The contract implements a tiered eligibility system with configurable thresholds that determine whether a DLP can participate in epochs and receive rewards. DLPs can be in various states including Registered, Eligible, SubEligible, or Deregistered, with transitions between these states triggered by changes in stake amounts or administrative actions. The eligibility mechanism ensures that only DLPs meeting minimum stake requirements and verification standards can actively participate in the protocol.

A key feature of the contract is its historical data tracking using checkpoints, which record stake amounts and staker reward percentages at different points in time. This allows for accurate historical queries when calculating rewards for past epochs. The contract also manages the distribution between staker and owner rewards through configurable percentages, balancing incentives for both DLP operators and their stakers while maintaining security through comprehensive role-based access controls.

Moksha:  [0x0aBa5e28228c323A67712101d61a54d4ff5720FD](https://moksha.vanascan.io/address/0x0aBa5e28228c323A67712101d61a54d4ff5720FD)

Vana mainnet: [0x0aBa5e28228c323A67712101d61a54d4ff5720FD](https://vanascan.io/address/0x0aBa5e28228c323A67712101d61a54d4ff5720FD)


### Root Network Contract

Core contract managing staking functionality including stake creation, withdrawal, migration, and reward claiming.  

The DLPRootImplementation contract serves as the central hub of the Vana staking ecosystem, managing the core staking functionality for users who want to support DLPs. It coordinates the interactions between stakers, DLPs, and the various specialized contracts in the system, including DLPRootCore, DLPRootEpoch, DLPRootMetrics, and DLPRootTreasury.  
  
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

### Data Liquidity Pool & DLPToken

A Data Liquidity Pool (DLP) is a core component of the Vana ecosystem, designed to transform raw data into a liquid asset. It functions as a smart contract on the Vana blockchain that allows users to monetize, control, and govern their data in a decentralized manner. Each DLP can have its own token, providing contributors with ongoing rewards and governance rights.

**DataRegistry**, **TEEPool**, and **RootNetwork** are part of the Vana core smart contracts and do not need to be deployed by DLP builders. For testing and integration, you should use the addresses deployed on Moksha. However, you will need to deploy your own **Data Liquidity Pool** & **DLPToken** (either the template version suggested by us or your own version). Keep in mind that to be part of the Vana ecosystem and qualify for the DLP rewards program, the DLP contract needs to be integrated with **DataRegistry** and **RootNetwork** as shown in the template in this repository.

### Multisend
The multisend contract allows users to send multiple transactions in a single call. This is useful for batch operations such as distributing rewards/gas fees to multiple addresses. The contract is designed to optimize gas usage and reduce the number of transactions required for these operations.

Moksha:  [0x8807e8BCDFbaA8c2761760f3FBA37F6f7F2C5b2d](https://moksha.vanascan.io/address/0x8807e8BCDFbaA8c2761760f3FBA37F6f7F2C5b2d)

Vana mainnet: [0x8807e8BCDFbaA8c2761760f3FBA37F6f7F2C5b2d](https://vanascan.io/address/0x8807e8BCDFbaA8c2761760f3FBA37F6f7F2C5b2d)

### Multicall3
The Multicall3 contract is a direct implementation of the widely-used [mds1's Multicall3 contract](#https://github.com/mds1/multicall), enabling batching of multiple smart contract calls into a single transaction to reduce gas costs and improve efficiency. It provides various aggregation methods with configurable error handling and supports value transfers, making it a powerful tool for complex operations within the Vana ecosystem. The contract includes multiple call aggregation patterns - from simple batching requiring all calls to succeed, to sophisticated methods allowing per-call failure handling and ETH value attachments. This makes it particularly valuable for operations requiring interaction with multiple contracts or performing bulk operations like reward distributions and state updates.

Moksha:  [0xD8d2dFca27E8797fd779F8547166A2d3B29d360E](https://moksha.vanascan.io/address/0xD8d2dFca27E8797fd779F8547166A2d3B29d360E)

Vana mainnet: [0xD8d2dFca27E8797fd779F8547166A2d3B29d360E](https://vanascan.io/address/0xD8d2dFca27E8797fd779F8547166A2d3B29d360E)


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

#### Data Contributor Rewards

- Each DLP is responsible for rewarding its data contributors.
- The method and currency for these rewards are at the discretion of each DLP.
- In the DLP template from this repository:
   - The DLP uses its own currency for rewards.
   - Reward amount is proportional to the score of the uploaded file.
   - More details can be found in the specific DLP documentation.

#### Flexibility in Reward Mechanisms

- DLPs can modify their reward mechanism for data contributors:
- They may choose to use VANA tokens instead of a custom currency.
- They could distribute part or all of the rewards received from the RootNetwork to data contributors.
- More complex reward calculation mechanisms can be implemented.

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
- DataRegistry tests: ```npx hardhat test test/dataRegistry.ts```
- TeePool tests: ```npx hardhat test test/teePool.ts```
- DLPRoot tests: ```npx hardhat test test/root.ts```
- DLP tests: ```npx hardhat test test/dlp.ts```
- DLPToken tests: ```npx hardhat test test/token.ts```
- Multisend tests: ```npx hardhat test test/multisend.ts```
- Deposit tests: ```npx hardhat test test/deposit.ts```
- All tests (including dependencies): ```npx hardhat test```

#### 4. Deploy

#### Token & DLP
```bash
npx hardhat deploy --network moksha --tags DLPDeploy  
```

#### DLPRoot
```bash
npx hardhat deploy --network moksha --tags DLPRootDeploy
```

#### DLPRootMetrics
```bash
npx hardhat deploy --network moksha --tags DLPRootMetricsDeploy
```

#### DLPRootMetrics
```bash
npx hardhat deploy --network moksha --tags DLPRootTreasuryDeploy
```

#### DataRegistry
```bash
npx hardhat deploy --network moksha --tags DataRegistryDeploy
```

#### TeePool
```bash
npx hardhat deploy --network moksha --tags TeePoolDeploy
```

#### Deposit
```bash
npx hardhat deploy --network moksha --tags DepositDeploy
```

#### Multisend
```bash
npx hardhat deploy --network moksha --tags MultisendDeploy
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

### Vana Core Contracts

<a id="contracts-data-registry"></a>
### DataRegistry

```solidity
function initialize(address trustedForwarderAddress, address ownerAddress) external initializer
```

Initializes the contract.

Parameters:
- `trustedForwarderAddress`: Address of the trusted forwarder
- `ownerAddress`: Address of the owner

Restrictions:
- Can only be called once due to the `initializer` modifier

Events: None

---

```solidity
function version() external pure returns (uint256)
```

Returns the version of the contract.

Parameters: None

Returns:
- `uint256`: The version number (1 for this implementation)

Restrictions: None

Events: None

---

```solidity
function filesCount() external view returns (uint256)
```

Returns the total number of files in the registry.

Parameters: None

Returns:
- `uint256`: Total number of files

Restrictions: None

Events: None

---

```solidity
function files(uint256 fileId) external view returns (FileResponse memory)
```

Returns information about a file.

Parameters:
- `fileId`: ID of the file

Returns:
- `FileResponse`: Struct containing:
   - id: File ID
   - ownerAddress: Owner's address
   - url: File URL
   - addedAtBlock: Block number when file was added

Restrictions: None

Events: None

---

```solidity
function fileIdByUrl(string memory url) external view returns (uint256)
```

Returns the ID of a file by its URL.

Parameters:
- `url`: URL of the file

Returns:
- `uint256`: File ID (0 if not found)

Restrictions: None

Events: None

---

```solidity
function fileProofs(uint256 fileId, uint256 index) external view returns (Proof memory)
```

Returns the proof for a file at given index.

Parameters:
- `fileId`: ID of the file
- `index`: Index of the proof

Returns:
- `Proof`: Struct containing proof signature and data

Restrictions: None

Events: None

---

```solidity
function filePermissions(uint256 fileId, address account) external view returns (string memory)
```

Returns permissions for a file.

Parameters:
- `fileId`: ID of the file
- `account`: Address of the account

Returns:
- `string`: The encryption key for the account

Restrictions: None

Events: None

---

```solidity
function pause() external
```

Pauses the contract.

Parameters: None

Restrictions:
- Can only be called by address with MAINTAINER_ROLE

Events: None

---

```solidity
function unpause() external
```

Unpauses the contract.

Parameters: None

Restrictions:
- Can only be called by address with MAINTAINER_ROLE

Events: None

---

```solidity
function addFile(string memory url) external returns (uint256)
```

Adds a file to the registry.

Parameters:
- `url`: URL of the file

Returns:
- `uint256`: ID of the newly added file

Restrictions:
- Contract must not be paused
- URL must not already be used

Events:
- `FileAdded(uint256 indexed fileId, address indexed ownerAddress, string url)`

---

```solidity
function addFileWithPermissions(
    string memory url,
    address ownerAddress,
    Permission[] memory permissions
) external returns (uint256)
```

Adds a file to the registry with permissions.

Parameters:
- `url`: URL of the file
- `ownerAddress`: Address of the owner
- `permissions`: Array of Permission structs containing account addresses and encryption keys

Returns:
- `uint256`: ID of the newly added file

Restrictions:
- Contract must not be paused
- URL must not already be used

Events:
- `FileAdded(uint256 indexed fileId, address indexed ownerAddress, string url)`
- `PermissionGranted(uint256 indexed fileId, address indexed account)` for each permission

---

```solidity
function addProof(uint256 fileId, Proof memory proof) external
```

Adds a proof to a file.

Parameters:
- `fileId`: ID of the file
- `proof`: Proof struct containing:
   - signature: Proof signature
   - data: ProofData struct with score, dlpId, metadata, proofUrl, and instruction

Restrictions:
- Contract must not be paused

Events:
- `ProofAdded(uint256 indexed fileId, uint256 indexed proofIndex, uint256 indexed dlpId, uint256 score)`

---

```solidity
function addFilePermission(uint256 fileId, address account, string memory key) external
```

Adds permissions for an account to access a file.

Parameters:
- `fileId`: ID of the file
- `account`: Address of the account to grant permission
- `key`: Encryption key for the account

Restrictions:
- Contract must not be paused
- Can only be called by the file owner

Events:
- `PermissionGranted(uint256 indexed fileId, address indexed account)`

---

```solidity
function updateTrustedForwarder(address trustedForwarderAddress) external
```

Updates the trusted forwarder address.

Parameters:
- `trustedForwarderAddress`: New trusted forwarder address

Restrictions:
- Can only be called by address with MAINTAINER_ROLE

Events: None

---

<a id="contracts-tee-pool"></a>
### TeePool

```solidity
function initialize(
    address trustedForwarderAddress,
    address ownerAddress,
    address dataRegistryAddress,
    uint256 initialCancelDelay
) external initializer
```

Initializes the contract.

Parameters:
- `trustedForwarderAddress`: Address of trusted forwarder for meta-transactions
- `ownerAddress`: Address of the contract owner
- `dataRegistryAddress`: Address of the data registry contract
- `initialCancelDelay`: Initial cancel delay period

Restrictions:
- Can only be called once due to the `initializer` modifier

---

```solidity
function version() external pure returns (uint256)
```

Returns the version of the contract.

Returns:
- `uint256`: The version number

---

```solidity
function dataRegistry() external view returns (IDataRegistry)
```

Returns the address of the data registry contract.

Returns:
- `IDataRegistry`: The data registry contract interface

---

```solidity
function cancelDelay() external view returns (uint256)
```

Returns the delay period required before canceling a job.

Returns:
- `uint256`: The cancel delay period in seconds

---

```solidity
function jobsCount() external view returns (uint256)
```

Returns the total number of jobs created.

Returns:
- `uint256`: Total number of jobs

---

```solidity
function jobs(uint256 jobId) external view returns (Job memory)
```

Returns the details of a specific job.

Parameters:
- `jobId`: ID of the job

Returns:
- Job struct containing:
   - `fileId`: ID of the file to validate
   - `bidAmount`: Amount paid for validation
   - `status`: Current job status
   - `addedTimestamp`: When job was created
   - `ownerAddress`: Job creator address
   - `teeAddress`: Assigned TEE address

---

```solidity
function tees(address teeAddress) external view returns (TeeInfo memory)
```

Returns information about a TEE validator.

Parameters:
- `teeAddress`: Address of the TEE

Returns:
- TeeInfo struct containing:
   - `teeAddress`: TEE's address
   - `url`: TEE's endpoint URL
   - `status`: Current TEE status
   - `amount`: Total earnings
   - `withdrawnAmount`: Withdrawn earnings
   - `jobsCount`: Number of jobs processed
   - `publicKey`: TEE's public key

---

```solidity
function teesCount() external view returns (uint256)
```

Returns the total number of TEEs (both active and removed).

Returns:
- `uint256`: Total number of TEEs

---

```solidity
function teeList() external view returns (address[] memory)
```

Returns the list of all TEE addresses.

Returns:
- `address[]`: Array of all TEE addresses

---

```solidity
function teeListAt(uint256 index) external view returns (TeeInfo memory)
```

Returns information about the TEE at a specific index.

Parameters:
- `index`: Index in the TEE list

Returns:
- `TeeInfo`: Information about the TEE at that index

---

```solidity
function activeTeesCount() external view returns (uint256)
```

Returns the number of active TEEs.

Returns:
- `uint256`: Number of active TEEs

---

```solidity
function activeTeeList() external view returns (address[] memory)
```

Returns the list of active TEE addresses.

Returns:
- `address[]`: Array of active TEE addresses

---

```solidity
function activeTeeListAt(uint256 index) external view returns (TeeInfo memory)
```

Returns information about the active TEE at a specific index.

Parameters:
- `index`: Index in the active TEE list

Returns:
- `TeeInfo`: Information about the active TEE at that index

---

```solidity
function isTee(address teeAddress) external view returns (bool)
```

Checks if an address is an active TEE.

Parameters:
- `teeAddress`: Address to check

Returns:
- `bool`: True if address is an active TEE, false otherwise

---

```solidity
function teeFee() external view returns (uint256)
```

Returns the current fee required for validation requests.

Returns:
- `uint256`: Current TEE fee amount

---

```solidity
function teeJobIdsPaginated(
    address teeAddress,
    uint256 start,
    uint256 limit
) external view returns (uint256[] memory)
```

Returns a paginated list of jobs for a specific TEE.

Parameters:
- `teeAddress`: Address of the TEE
- `start`: Starting index
- `limit`: Maximum number of jobs to return

Returns:
- `uint256[]`: Array of job IDs

---

```solidity
function fileJobIds(uint256 fileId) external view returns (uint256[] memory)
```

Returns all jobs associated with a file.

Parameters:
- `fileId`: ID of the file

Returns:
- `uint256[]`: Array of job IDs for the file

---

```solidity
function pause() external
```

Pauses the contract.

Restrictions:
- Can only be called by MAINTAINER_ROLE

---

```solidity
function unpause() external
```

Unpauses the contract.

Restrictions:
- Can only be called by MAINTAINER_ROLE

---

```solidity
function updateDataRegistry(IDataRegistry dataRegistry) external
```

Updates the data registry contract address.

Parameters:
- `dataRegistry`: New data registry contract address

Restrictions:
- Can only be called by MAINTAINER_ROLE

---

```solidity
function updateTeeFee(uint256 newTeeFee) external
```

Updates the validation fee amount.

Parameters:
- `newTeeFee`: New fee amount

Restrictions:
- Can only be called by MAINTAINER_ROLE

---

```solidity
function updateCancelDelay(uint256 newCancelDelay) external
```

Updates the job cancellation delay period.

Parameters:
- `newCancelDelay`: New delay period in seconds

Restrictions:
- Can only be called by MAINTAINER_ROLE

---

```solidity
function addTee(
    address teeAddress,
    string calldata url,
    string calldata publicKey
) external
```

Registers a new TEE validator.

Parameters:
- `teeAddress`: TEE's address
- `url`: TEE's endpoint URL
- `publicKey`: TEE's public key

Restrictions:
- Can only be called by MAINTAINER_ROLE
- TEE must not already be active

Events:
- `TeeAdded(address indexed teeAddress)`

---

```solidity
function removeTee(address teeAddress) external
```

Removes a TEE validator.

Parameters:
- `teeAddress`: Address of TEE to remove

Restrictions:
- Can only be called by MAINTAINER_ROLE
- TEE must be active

Events:
- `TeeRemoved(address indexed teeAddress)`

---

```solidity
function requestContributionProof(uint256 fileId) external payable
```

Submits a new validation job request.

Parameters:
- `fileId`: ID of file needing validation

Restrictions:
- Contract must not be paused
- Payment must meet minimum fee
- At least one active TEE must exist

Events:
- `JobSubmitted(uint256 indexed jobId, uint256 indexed fileId, address teeAddress, uint256 bidAmount)`

---

```solidity
function submitJob(uint256 fileId) external payable
```

Alias for requestContributionProof.

Parameters:
- `fileId`: ID of file needing validation

---

```solidity
function cancelJob(uint256 jobId) external
```

Cancels a validation job request.

Parameters:
- `jobId`: ID of job to cancel

Restrictions:
- Only callable by job owner
- Job must be in Submitted status
- Cancel delay period must have passed

Events:
- `JobCanceled(uint256 indexed jobId)`

---

```solidity
function addProof(uint256 jobId, IDataRegistry.Proof memory proof) external
```

Submits validation proof for a job.

Parameters:
- `jobId`: ID of the job
- `proof`: Validation proof data

Restrictions:
- Only callable by assigned active TEE
- Job must be in Submitted status
- Caller must be the assigned TEE

Events:
- `ProofAdded(address indexed attestator, uint256 indexed jobId, uint256 indexed fileId)`

---

<a id="contracts-dlp-root"></a>
### DLPRoot

The DLPRoot contract serves as the central hub in the Vana ecosystem, orchestrating a complex system of DataDAO management, staking operations, and reward distribution through its interaction with DLPRootMetrics and specialized treasury contracts. Operating on an epoch-based system, it works in tandem with DLPRootMetrics to identify and reward the most valuable DataDAOs based on both their stake amounts and performance metrics. The contract manages two separate treasury relationships: the DLPRootStakesTreasury for holding staked VANA tokens, and the DLPRootRewardsTreasury for distributing rewards to both DataDAOs and their stakers.

DataDAOs enter the system through a registration process that requires a minimum initial stake, which is held in the DLPRootStakesTreasury. As they accumulate more stake, DataDAOs can progress through three status tiers: Registered, SubEligible, and Eligible, with automatic transitions based on stake thresholds. This tiered system ensures that only DataDAOs with significant skin in the game can compete for top positions and rewards. To maintain flexibility and attract stakers, DataDAO owners can set custom reward percentages within defined bounds, determining how rewards are split between the DataDAO treasury and its stakers.

The epoch mechanism drives the system's dynamics, with each epoch having a fixed duration in blocks. At epoch boundaries, DLPRootMetrics finalizes performance ratings, which combine with stake amounts to determine the epoch's top DataDAOs. The DLPRoot then orchestrates reward distribution through the DLPRootRewardsTreasury, ensuring that both DataDAO treasuries and their stakers receive their designated portions. To prevent exploitation, the system implements stake withdrawal delays and requires manual reward claims, while still allowing users to stake across multiple DataDAOs for portfolio diversification.

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


<a id="contracts-deposit"></a>
### Deposit

This is a rewrite of the Eth2.0 deposit contract in Solidity. It is used to process deposits for validators in the Eth2.0 network.

```solidity
function initialize(
    address ownerAddress,
    uint256 _minDepositAmount,
    uint256 _maxDepositAmount,
    bytes[] memory allowedValidators
) external initializer
```

Initializes the contract with the given parameters.

- `ownerAddress`: The address that will be set as the owner of the contract.
- `_minDepositAmount`: The minimum amount allowed for a deposit.
- `_maxDepositAmount`: The maximum amount allowed for a deposit.
- `allowedValidators`: An array of validator public keys that are initially allowed to make deposits.

Restrictions:
- Can only be called once due to the `initializer` modifier.

---

```solidity
function updateMinDepositAmount(uint256 newMinDepositAmount) external onlyOwner
```

Updates the minimum deposit amount.

- `newMinDepositAmount`: The new minimum deposit amount to set.

Restrictions:
- Can only be called by the contract owner.

Events emitted:
- `MinDepositAmountUpdated(uint256 newMinDepositAmount)`

---

```solidity
function updateMaxDepositAmount(uint256 newMaxDepositAmount) external onlyOwner
```

Updates the maximum deposit amount.

- `newMaxDepositAmount`: The new maximum deposit amount to set.

Restrictions:
- Can only be called by the contract owner.

Events emitted:
- `MaxDepositAmountUpdated(uint256 newMaxDepositAmount)`

---

```solidity
function updateRestricted(bool _restricted) external onlyOwner
```

Updates the restricted status of the contract.

- `_restricted`: The new restricted status to set.

Restrictions:
- Can only be called by the contract owner.

Events emitted:
- `RestrictedUpdated(bool newRestricted)`

---

```solidity
function addAllowedValidators(bytes[] memory validatorPublicKeys) external onlyOwner
```

Adds new validator public keys to the list of allowed validators.

- `validatorPublicKeys`: An array of validator public keys to be added to the allowed list.

Restrictions:
- Can only be called by the contract owner.

Events emitted:
- `AllowedValidatorsAdded(bytes validatorPublicKey)` for each added validator

---

```solidity
function removeAllowedValidators(bytes[] memory validatorPublicKeys) external onlyOwner
```

Removes validator public keys from the list of allowed validators.

- `validatorPublicKeys`: An array of validator public keys to be removed from the allowed list.

Restrictions:
- Can only be called by the contract owner.

Events emitted:
- `AllowedValidatorsRemoved(bytes validatorPublicKey)` for each removed validator

---

```solidity
function get_deposit_root() external view returns (bytes32)
```

Retrieves the current deposit root hash.

Returns:
- `bytes32`: The current deposit root hash.

---

```solidity
function get_deposit_count() external view returns (bytes memory)
```

Retrieves the current deposit count.

Returns:
- `bytes memory`: The deposit count encoded as a little-endian 64-bit number.

---

```solidity
function deposit(
    bytes calldata pubkey,
    bytes calldata withdrawal_credentials,
    bytes calldata signature,
    bytes32 deposit_data_root
) external payable
```

Processes a deposit for a validator.

- `pubkey`: A BLS12-381 public key (48 bytes).
- `withdrawal_credentials`: Commitment to a public key for withdrawals (32 bytes).
- `signature`: A BLS12-381 signature (96 bytes).
- `deposit_data_root`: The SHA-256 hash of the SSZ-encoded DepositData object.

Restrictions:
- If `restricted` is true, the `pubkey` must be in the allowed list and not have made a deposit before.
- `pubkey` must be 48 bytes long.
- `withdrawal_credentials` must be 32 bytes long.
- `signature` must be 96 bytes long.
- The deposit amount (msg.value) must be between `minDepositAmount` and `maxDepositAmount`.
- The deposit amount must be a multiple of 1 gwei.
- The total number of deposits must not exceed `MAX_DEPOSIT_COUNT`.

Events emitted:
- `DepositEvent(bytes pubkey, bytes withdrawal_credentials, bytes amount, bytes signature, bytes index)`

---

```solidity
function supportsInterface(bytes4 interfaceId) external pure returns (bool)
```

Checks if the contract supports a given interface.

- `interfaceId`: The interface identifier to check.

Returns:
- `bool`: True if the contract supports the interface, false otherwise.

### DLP Template Contracts


<a id="contracts-data-liquidity-pool"></a>
### DataLiquidityPool

This contract is designed to be upgradeable using the Universal Upgradeable Proxy Standard (UUPS) pattern. This allows for future improvements while maintaining the contract's state and address.

For more information on the UUPS pattern and how to work with upgradeable contracts, please refer to the OpenZeppelin documentation:
- [Proxy Upgrade Pattern](https://docs.openzeppelin.com/upgrades-plugins/1.x/proxies)
- [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable)

#### Methods

```solidity
function initialize(InitParams memory params) external initializer
```
Initializes the contract with the given parameters.

**Parameters:**
- `params`: A struct containing initialization parameters
   - `trustedForwarder`: The address of the trusted forwarder contract. See [this section](#env-truested_forwarder_address) for more details.
   - `ownerAddress`: The address of the contract owner. (E.g. **0x853407D0C625Ce7E43C0a2596fBc470C3a6f8305**)
   - `tokenAddress`: The address of the ERC20 token used for rewards. (E.g. **0xF3D9A139a7ba707843dD4f1FDfE0F9E55D9D8d6b**)
   - `dataRegistryAddress`: The address of the data registry contract. (E.g. **0xEA882bb75C54DE9A08bC46b46c396727B4BFe9a5**)
   - `teePoolAddress`: The address of the TEE pool contract. (E.g. **0xF084Ca24B4E29Aa843898e0B12c465fAFD089965**)
   - `name`: The name of the data liquidity pool. (E.g. **CookieDLP**)
   - `publicKey`: A public key for your DLP, used for encryption purposes. See [this section](#env-dlp-public-key) for more details.
   - `proofInstruction`: The instruction for generating proofs. (E.g. **https://github.com/vana-com/vana-satya-proof-template/releases/download/v24/gsc-my-proof-24.tar.gz**)
   - `fileRewardFactor`: The factor used to calculate file rewards. (E.g. **2e18** => the reward multiplier is 2)


Tee validators calculate a total score for the files they verify, based on the set of instructions executed to generate the proof. This score ranges between 0 and 1 (i.e., between 0 and 1e18). At the end, the dataContributor will receive a reward. DLP_FILE_REWARD_FACTOR is used to convert the score into the amount of DLP tokens the data contributor receives for their file. Essentially, the reward is calculated using the formula:  
```reward = fileScore * DLP_FILE_REWARD_FACTOR ```

**Restrictions:** Can only be called once during contract deployment

**Events Emitted:** None

**Errors:**
- `InvalidInitialization`: Thrown if the contract has already been initialized

---

```solidity
function version() external pure returns (uint256)
```
Returns the version of the contract.

**Returns:** The version number

**Restrictions:** None

---

```solidity
function files(uint256 fileId) public view returns (FileResponse memory)
```
Retrieves information about a specific file.

**Parameters:**
- `fileId`: The ID of the file

**Returns:** `FileResponse` struct containing:
- `fileId`: The ID of the file
- `timestamp`: The timestamp when the file was added
- `proofIndex`: The index of the proof associated with the file
- `rewardAmount`: The amount of reward for the file

**Restrictions:** None

---

```solidity
function filesListCount() external view returns (uint256)
```
Returns the total number of files in the pool.

**Returns:** The number of files

**Restrictions:** None

---

```solidity
function filesListAt(uint256 index) external view returns (uint256)
```
Retrieves the file ID at a specific index in the files list.

**Parameters:**
- `index`: The index in the files list

**Returns:** The file ID at the given index

**Restrictions:** None

---

```solidity
function contributors(uint256 index) external view returns (ContributorInfoResponse memory)
```
Retrieves information about a contributor at a specific index.

**Parameters:**
- `index`: The index of the contributor

**Returns:** `ContributorInfoResponse` struct containing:
- `contributorAddress`: The address of the contributor
- `filesListCount`: The number of files contributed by this contributor

**Restrictions:** None

---

```solidity
function contributorInfo(address contributorAddress) public view returns (ContributorInfoResponse memory)
```
Retrieves information about a specific contributor.

**Parameters:**
- `contributorAddress`: The address of the contributor

**Returns:** `ContributorInfoResponse` struct (same as `contributors` method)

**Restrictions:** None

---

```solidity
function contributorFiles(address contributorAddress, uint256 index) external view returns (FileResponse memory)
```
Retrieves information about a specific file contributed by a contributor.

**Parameters:**
- `contributorAddress`: The address of the contributor
- `index`: The index of the file in the contributor's files list

**Returns:** `FileResponse` struct (same as `files` method)

**Restrictions:** None

---

```solidity
function pause() external
```
Pauses the contract, preventing certain operations.

**Restrictions:** Can only be called by the contract owner

**Events Emitted:** None (inherited from PausableUpgradeable)

**Errors:**
- `OwnableUnauthorizedAccount`: Thrown if called by any account other than the owner

---

```solidity
function unpause() external
```
Unpauses the contract, re-enabling paused operations.

**Restrictions:** Can only be called by the contract owner

**Events Emitted:** None (inherited from PausableUpgradeable)

**Errors:**
- `OwnableUnauthorizedAccount`: Thrown if called by any account other than the owner

---

```solidity
function updateFileRewardFactor(uint256 newFileRewardFactor) external
```
Updates the file reward factor used to calculate rewards.

**Parameters:**
- `newFileRewardFactor`: The new file reward factor

**Restrictions:** Can only be called by the contract owner

**Events Emitted:** `FileRewardFactorUpdated`

**Errors:**
- `OwnableUnauthorizedAccount`: Thrown if called by any account other than the owner

---

```solidity
function updateTeePool(address newTeePool) external
```
Updates the address of the TEE pool contract.

**Parameters:**
- `newTeePool`: The new TEE pool contract address

**Restrictions:** Can only be called by the contract owner

**Events Emitted:** None

**Errors:**
- `OwnableUnauthorizedAccount`: Thrown if called by any account other than the owner

---

```solidity
function updateProofInstruction(string calldata newProofInstruction) external
```
Updates the proof instruction used for validating proofs.

**Parameters:**
- `newProofInstruction`: The new proof instruction.

**Restrictions:** Can only be called by the contract owner

**Events Emitted:** `ProofInstructionUpdated`

**Errors:**
- `OwnableUnauthorizedAccount`: Thrown if called by any account other than the owner

---

```solidity
function updatePublicKey(string calldata newPublicKey) external
```
Updates the public key of the pool.

**Parameters:**
- `newPublicKey`: The new public key (E.g. **0x04bfcab8282071e4c17b3ae235928ec9dd9fb8e2b2f981c56c4a5215c9e7a1fcf1a84924476b8b56f17f719d3d3b729688bb7c39a60b00414d53ae8491df5791fa**)

**Restrictions:** Can only be called by the contract owner

**Events Emitted:** `PublicKeyUpdated`

**Errors:**
- `OwnableUnauthorizedAccount`: Thrown if called by any account other than the owner

---

```solidity
function requestReward(uint256 fileId, uint256 proofIndex) external
```
Requests a reward for a file based on its proof.

**Parameters:**
- `fileId`: The ID of the file from the data registry
- `proofIndex`: The index of the proof for the file

**Restrictions:**
- Contract must not be paused
- File must not have been already rewarded
- Proof must be valid and signed by a registered TEE

**Events Emitted:** `RewardRequested`

**Errors:**
- `EnforcedPause`: Thrown if the contract is paused
- `FileAlreadyAdded`: Thrown if the file has already been rewarded
- `InvalidProof`: Thrown if the proof instruction doesn't match the contract's proof instruction
- `InvalidAttestator`: Thrown if the proof is not signed by a registered TEE

---

```solidity
function addRewardsForContributors(uint256 contributorsRewardAmount) external
```
Adds rewards to the pool for contributors.

**Parameters:**
- `contributorsRewardAmount`: The amount of rewards to add

**Restrictions:** None

**Events Emitted:** None

**Errors:**
- `ERC20InsufficientAllowance`: Thrown if the caller has not approved enough tokens for transfer
- `ERC20InsufficientBalance`: Thrown if the caller does not have enough tokens to transfer


### 
###

---

<a id="contracts-dat"></a>
### DAT (Data Autonomy Token)


The DAT contract is an ERC20 token with additional governance features, including ERC20Permit for gasless approvals and ERC20Votes for on-chain voting capabilities. It also includes custom functionality for minting control and address blocking.

This contract inherits from OpenZeppelin's ERC20, ERC20Permit, ERC20Votes, and Ownable2Step contracts, providing standard ERC20 functionality along with permit capabilities for gasless approvals, voting mechanisms, and secure ownership management.

###
```solidity
constructor(string memory name, string memory symbol, address ownerAddress)
```

Description: Initializes the contract by setting a name, symbol, and owner address.

Parameters:
- `name`: Name of the token
- `symbol`: Symbol of the token
- `ownerAddress`: Address of the initial owner

Restrictions: None

Events Emitted: None (inherited from ERC20 and Ownable)

###
```solidity
function clock() public view override returns (uint48)
```

Description: Returns the current timestamp, used for ERC20Votes functionality.

Parameters: None

Return Value:
- `uint48`: Current block timestamp

Restrictions: None

Events Emitted: None

###
```solidity
function CLOCK_MODE() public pure override returns (string memory)
```

Description: Returns the mode of the clock (timestamp-based).

Parameters: None

Return Value:
- `string`: "mode=timestamp"

Restrictions: None

Events Emitted: None

###
```solidity
function blockListLength() external view returns (uint256)
```

Description: Returns the number of addresses in the block list.

Parameters: None

Return Value:
- `uint256`: Length of the block list

Restrictions: None

Events Emitted: None

###
```solidity
function blockListAt(uint256 _index) external view returns (address)
```

Description: Returns the address at a given index in the block list.

Parameters:
- `_index`: Index in the block list

Return Value:
- `address`: Address at the specified index

Restrictions: None

Events Emitted: None

###
```solidity
function nonces(address owner) public view virtual override(ERC20Permit, Nonces) returns (uint256)
```

Description: Returns the current nonce for an address, used for ERC20Permit functionality.

Parameters:
- `owner`: Address to check the nonce for

Return Value:
- `uint256`: Current nonce for the address

Restrictions: None

Events Emitted: None

###
```solidity
function mint(address to, uint256 amount) external virtual onlyOwner whenMintIsAllowed
```

Description: Mints new tokens to a specified address.

Parameters:
- `to`: Address to mint tokens to
- `amount`: Amount of tokens to mint

Restrictions:
- Only owner can call
- Minting must not be blocked

Events Emitted: Transfer event (inherited from ERC20)

###
```solidity
function changeAdmin(address newAdmin) external virtual onlyOwner
```

Description: Changes the admin address.

Parameters:
- `newAdmin`: New admin address

Restrictions: Only owner can call

Events Emitted:
- `AdminChanged(address indexed oldAdmin, address indexed newAdmin)`

###
```solidity
function blockMint() external virtual onlyOwner whenMintIsAllowed
```

Description: Blocks further minting of tokens permanently.

Parameters: None

Restrictions:
- Only owner can call
- Minting must not already be blocked

Events Emitted:
- `MintBlocked()`

###
```solidity
function blockAddress(address addressToBeBlocked) external virtual onlyAdmin
```

Description: Adds an address to the block list, preventing it from transferring tokens.

Parameters:
- `addressToBeBlocked`: Address to be blocked

Restrictions: Only admin can call

Events Emitted:
- `AddressBlocked(address indexed blockedAddress)`

###
```solidity
function unblockAddress(address addressToBeUnblocked) external virtual onlyAdmin
```

Description: Removes an address from the block list.

Parameters:
- `addressToBeUnblocked`: Address to be unblocked

Restrictions: Only admin can call

Events Emitted:
- `AddressUnblocked(address indexed unblockedAddress)`


### Utilities Contracts

<a id="contracts-multisend"></a>
### Multisend

```solidity
function initialize(address ownerAddress) external initializer
```

Used to initialize a new Faucet contract.

Parameters:
- `ownerAddress`: Address of the owner

Restrictions:
- Can only be called once due to the `initializer` modifier

---

```solidity
function multisendVana(uint256 amount, address payable[] memory recipients) public payable nonReentrant
```

Sends a specified amount of VANA (native currency) to multiple recipients.

Parameters:
- `amount`: The amount of VANA to send to each recipient
- `recipients`: An array of recipient addresses

Restrictions:
- `nonReentrant` modifier prevents reentrancy
- Requires `msg.value` to be at least `amount * recipients.length`

Errors:
- `InvalidAmount()`: If `msg.value` is less than the total amount to be sent

---

```solidity
function multisendToken(IERC20 token, uint256 amount, address[] memory recipients) public nonReentrant
```

Sends a specified amount of ERC20 tokens to multiple recipients.

Parameters:
- `token`: The IERC20 token contract address
- `amount`: The amount of tokens to send to each recipient
- `recipients`: An array of recipient addresses

Restrictions:
- `nonReentrant` modifier prevents reentrancy
- Requires sender to have sufficient token balance and allowance

Errors:
- `InvalidAmount()`: If sender's token balance is less than the total amount to be sent
- `InvalidAllowance()`: If sender's token allowance for this contract is less than the total amount to be sent

---

```solidity
function _authorizeUpgrade(address newImplementation) internal virtual override onlyOwner
```

Authorizes an upgrade to a new implementation.

Parameters:
- `newImplementation`: Address of the new implementation contract

Restrictions:
- Can only be called by the contract owner (`onlyOwner` modifier)

---

```solidity
function owner() public view virtual returns (address)
```

Returns the address of the current owner.

Returns:
- `address`: The address of the current owner

---

```solidity
function transferOwnership(address newOwner) public virtual onlyOwner
```

Transfers ownership of the contract to a new account.

Parameters:
- `newOwner`: Address of the new owner

Restrictions:
- Can only be called by the current owner (`onlyOwner` modifier)

Errors:
- `OwnableInvalidOwner`: If `newOwner` is the zero address

Events:
- `OwnershipTransferred(address indexed previousOwner, address indexed newOwner)`

---

```solidity
function renounceOwnership() public virtual onlyOwner
```

Leaves the contract without an owner, disabling any functionality that is only available to the owner.

Restrictions:
- Can only be called by the current owner (`onlyOwner` modifier)

Events:
- `OwnershipTransferred(address indexed previousOwner, address indexed newOwner)`

---

```solidity
function pendingOwner() public view virtual returns (address)
```

Returns the address of the pending owner.

Returns:
- `address`: The address of the pending owner

---

```solidity
function acceptOwnership() public virtual
```

Transfers ownership of the contract to the pending owner.

Restrictions:
- Can only be called by the pending owner

Errors:
- `OwnableUnauthorizedAccount`: If called by an account other than the pending owner

Events:
- `OwnershipTransferred(address indexed previousOwner, address indexed newOwner)`


<a id="contracts-multicall3"></a>
### Multicall3

The Multicall3 contract allows batching of multiple smart contract calls into a single transaction, providing gas efficiency and atomicity. It supports various types of batch calls with different failure handling mechanisms.

```solidity
function aggregate(Call[] calldata calls) public payable returns (uint256 blockNumber, bytes[] memory returnData)
```

Executes multiple calls and requires all of them to succeed.

Parameters:
- `calls`: Array of Call structs containing target addresses and call data

Returns:
- `blockNumber`: Block number where calls were executed
- `returnData`: Array of return data from each call

Restrictions:
- All calls must succeed or the entire transaction reverts

---

```solidity
function tryAggregate(bool requireSuccess, Call[] calldata calls) public payable returns (Result[] memory returnData)
```

Executes multiple calls with configurable failure handling.

Parameters:
- `requireSuccess`: If true, requires all calls to succeed
- `calls`: Array of Call structs containing target addresses and call data

Returns:
- `returnData`: Array of Result structs containing success status and return data

---

```solidity
function aggregate3(Call3[] calldata calls) public payable returns (Result[] memory returnData)
```

Enhanced version of aggregate that allows specifying failure handling per call.

Parameters:
- `calls`: Array of Call3 structs containing target address, allowFailure flag, and call data

Returns:
- `returnData`: Array of Result structs containing success status and return data

---

```solidity
function aggregate3Value(Call3Value[] calldata calls) public payable returns (Result[] memory returnData)
```

Executes multiple calls with ETH value attached to each call.

Parameters:
- `calls`: Array of Call3Value structs containing target address, allowFailure flag, value, and call data

Returns:
- `returnData`: Array of Result structs containing success status and return data

Restrictions:
- Total msg.value must match sum of all call values

---

```solidity
function getBlockHash(uint256 blockNumber) public view returns (bytes32 blockHash)
```

Returns the block hash for a given block number.

Parameters:
- `blockNumber`: Block number to get hash for

Returns:
- `blockHash`: Hash of the specified block

---

```solidity
function getCurrentBlockDifficulty() public view returns (uint256 difficulty)
```

Returns the current block difficulty.

Returns:
- `difficulty`: Current block difficulty

---

```solidity
function getCurrentBlockGasLimit() public view returns (uint256 gaslimit)
```

Returns the current block gas limit.

Returns:
- `gaslimit`: Current block gas limit

---

```solidity
function getCurrentBlockCoinbase() public view returns (address coinbase)
```

Returns the current block's coinbase address.

Returns:
- `coinbase`: Current block coinbase address

---

```solidity
function getEthBalance(address addr) public view returns (uint256 balance)
```

Returns the ETH balance of a given address.

Parameters:
- `addr`: Address to check balance for

Returns:
- `balance`: ETH balance of the address

---

```solidity
function getLastBlockHash() public view returns (bytes32 blockHash)
```

Returns the block hash of the previous block.

Returns:
- `blockHash`: Hash of the previous block

---

```solidity
function getBasefee() public view returns (uint256 basefee)
```

Returns the current block's base fee.

Returns:
- `basefee`: Current block base fee

Restrictions:
- Only available on chains that implement the BASEFEE opcode

---

```solidity
function getChainId() public view returns (uint256 chainid)
```

Returns the current chain ID.

Returns:
- `chainid`: Current chain ID

___

### 6. Audit

All contracts have been thoroughly audited by two reputable blockchain security firms: Hashlock and Nethermind. Multiple audit rounds have been conducted over time, with each significant smart contract update undergoing its own audit process to ensure security as the protocol evolved and new features were added.

For detailed audit reports, please visit:
- https://hashlock.com/audits/vana
- https://www.nethermind.io/smart-contract-audits