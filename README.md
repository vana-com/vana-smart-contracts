# Data Liquidity Pool (DLP)

## Table of Contents
1. [Introduction](#introduction)
2. [Overview](#overview)
3. [Installation](#installation)
4. [Flow](#flow)
5. [Contracts](#contracts)
    - [Vana Core Contracts](#vana-core-contracts)
      - [DataRegistry](#dataregistry)
      - [TeePool](#teePool)
      - [DLPRoot](#DLPRoot)
      - [Deposit](#deposit)
    - [DLP Template Contracts](#dlp-template-contracts)
      - [DataLiquidityPool](#dataliquiditypool)
      - [DAT (Data Access Token)](#dat-data-access-token)
    - [Utilities Contracts](#utilities-contracts)
      - [Multisend](#multisend) 
6. [Audit](#audit)


## 1. Introduction

Vana turns data into currency to push the frontiers of decentralized AI. It is a layer one blockchain designed for private, user-owned data. It allows users to collectively own, govern, and earn from the AI models trained on their data. For more context see this [docs](https://docs.vana.org/vana).


## 2. Overview

### [Data Registry Contract](https://docs.vana.org/vana/core-concepts/key-elements/smart-contracts#data-registry-contract)

The data registry contract functions as a central repository for managing all data within the network, functioning as a comprehensive file catalog. It allows users to add new files to the system, with each file receiving a unique identifier for future reference.

The contract manages access control for these files, enabling file owners to grant specific addresses permission to access their files. It also handles the storage of file metadata, including any offchain proofs or attestations related to file validation, which can include various metrics such as authenticity, ownership, and quality scores. Users can retrieve detailed information about any file in the registry using its unique identifier, including its permissions and associated proofs.

Moksha: [0xEA882bb75C54DE9A08bC46b46c396727B4BFe9a5](https://moksha.vanascan.io/address/0xEA882bb75C54DE9A08bC46b46c396727B4BFe9a5)

Satori: [0xEA882bb75C54DE9A08bC46b46c396727B4BFe9a5](https://satori.vanascan.io/address/0xEA882bb75C54DE9A08bC46b46c396727B4BFe9a5)

### [TEE Pool Contract](https://docs.vana.org/vana/core-concepts/key-elements/smart-contracts#tee-pool-contract)

The TEE Pool contract manages and coordinates the TEE Validators and serves as an escrow for holding fees associated with validation tasks. Users pay a fee to submit data for validation, and the contract ensures that the validators process the data and provide proof of validation.

Moksha: [0xF084Ca24B4E29Aa843898e0B12c465fAFD089965](https://moksha.vanascan.io/address/0xF084Ca24B4E29Aa843898e0B12c465fAFD089965)

Satori: [0xF084Ca24B4E29Aa843898e0B12c465fAFD089965](https://satori.vanascan.io/address/0xF084Ca24B4E29Aa843898e0B12c465fAFD089965)

### [Root Network Contract](https://docs.vana.org/vana/core-concepts/key-elements/smart-contracts#root-network-contract)

The DLP Root contract manages the registration and reward distribution for Data Liquidity Pools (DLPs) in the Vana ecosystem. It operates on an epoch-based system, where the top 16 most staked DLPs and their stakers receive rewards at the end of each epoch. The contract allows users to stake VANA tokens as guarantors for DLPs, with rewards distributed based on the staking position at the beginning of each epoch.

Moksha:  [0xff14346dF2B8Fd0c95BF34f1c92e49417b508AD5](https://moksha.vanascan.io/address/0xff14346dF2B8Fd0c95BF34f1c92e49417b508AD5)

Satori: [0xff14346dF2B8Fd0c95BF34f1c92e49417b508AD5](https://satori.vanascan.io/address/0xff14346dF2B8Fd0c95BF34f1c92e49417b508AD5)

### [Data Liquidity Pool & DLPToken](https://docs.vana.org/vana/welcome-to-vana/what-is-data-liquidity-pool)

A Data Liquidity Pool (DLP) is a core component of the Vana ecosystem, designed to transform raw data into a liquid asset. It functions as a smart contract on the Vana blockchain that allows users to monetize, control, and govern their data in a decentralized manner. Each DLP can have its own token, providing contributors with ongoing rewards and governance rights.

**DataRegistry**, **TEEPool**, and **RootNetwork** are part of the Vana core smart contracts and do not need to be deployed by DLP builders. For testing and integration, you should use the addresses deployed on Moksha. However, you will need to deploy your own **Data Liquidity Pool** & **DLPToken** (either the template version suggested by us or your own version). Keep in mind that to be part of the Vana ecosystem and qualify for the DLP rewards program, the DLP contract needs to be integrated with **DataRegistry** and **RootNetwork** as shown in the template in this repository.

### Multisend
The multisend contract allows users to send multiple transactions in a single call. This is useful for batch operations such as distributing rewards/gas fees to multiple addresses. The contract is designed to optimize gas usage and reduce the number of transactions required for these operations.

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

1. At the beginning of each epoch, the top 16 DLPs are selected based on their total staked amount.
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
`TRESTED_FORWARDER_ADDRESS`: The address of the trusted forwarder contract. This contract is used for gasless transactions. (E.g. **0x853407D0C625Ce7E43C0a2596fBc470C3a6f8305**). Read [gelato documentation](https://docs.gelato.network/web3-services/relay/supported-networks#new-deployments-oct-2024) for more details.  
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

### DataRegistry

```solidity
function initialize(address ownerAddress) external initializer
```

Initializes the contract.

Parameters:
- `ownerAddress`: Address of the owner.

Restrictions:
- Can only be called once due to the `initializer` modifier.

Events: None.

---

```solidity
function version() external pure returns (uint256)
```

Returns the version of the contract.

Parameters: None.

Return Value:
- `uint256`: The version number (1 for this implementation).

Restrictions: None.

Events: None.

---

```solidity
function pause() external
```

Pauses the contract.

Parameters: None.

Restrictions:
- Can only be called by the contract owner.

Events: None.

---

```solidity
function unpause() external
```

Unpauses the contract.

Parameters: None.

Restrictions:
- Can only be called by the contract owner.

Events: None.

---

```solidity
function files(uint256 fileId) external view returns (FileResponse memory)
```

Returns information about a file.

Parameters:
- `fileId`: ID of the file.

Return Value:
- `FileResponse`: A struct containing file information (id, url, ownerAddress, addedAtBlock).

Restrictions: None.

Events: None.

---

```solidity
function fileProofs(uint256 fileId, uint256 index) external view returns (Proof memory)
```

Returns the proof of a file.

Parameters:
- `fileId`: ID of the file.
- `index`: Index of the proof.

Return Value:
- `Proof`: A struct containing proof information.

Restrictions: None.

Events: None.

---

```solidity
function filePermissions(uint256 fileId, address account) external view returns (string memory)
```

Returns permissions for a file.

Parameters:
- `fileId`: ID of the file.
- `account`: Address of the account.

Return Value:
- `string`: The encryption key for the account.

Restrictions: None.

Events: None.

---

```solidity
function addFile(string memory url) external returns (uint256)
```

Adds a file to the registry.

Parameters:
- `url`: URL of the file.

Return Value:
- `uint256`: ID of the newly added file.

Restrictions:
- Contract must not be paused.

Events:
- `FileAdded(uint256 indexed fileId, address indexed ownerAddress, string url)`

---

```solidity
function addFileWithPermissions(string memory url, address ownerAddress, Permission[] memory permissions) external returns (uint256)
```

Adds a file to the registry with permissions.

Parameters:
- `url`: URL of the file.
- `ownerAddress`: Address of the owner.
- `permissions`: Array of Permission structs containing account addresses and encryption keys.

Return Value:
- `uint256`: ID of the newly added file.

Restrictions: None.

Events:
- `FileAdded(uint256 indexed fileId, address indexed ownerAddress, string url)`
- `PermissionGranted(uint256 indexed fileId, address indexed account)` (for each permission)

---

```solidity
function addProof(uint256 fileId, Proof memory proof) external
```

Adds a proof to a file.

Parameters:
- `fileId`: ID of the file.
- `proof`: Proof struct containing signature and proof data.

Restrictions:
- Contract must not be paused.

Events:
- `ProofAdded(uint256 indexed fileId, uint256 indexed proofIndex)`

---

```solidity
function addFilePermission(uint256 fileId, address account, string memory key) external
```

Adds permissions for an account to access a file.

Parameters:
- `fileId`: ID of the file.
- `account`: Address of the account to grant permission.
- `key`: Encryption key for the account.

Restrictions:
- Contract must not be paused.
- Can only be called by the file owner.

Events:
- `PermissionGranted(uint256 indexed fileId, address indexed account)`

### TeePool

```solidity
function initialize(
    address ownerAddress,
    address dataRegistryAddress,
    uint256 initialCancelDelay
) external initializer
```

Initializes the contract.

Parameters:
- `ownerAddress`: Address of the owner
- `dataRegistryAddress`: Address of the data registry contract
- `initialCancelDelay`: Initial cancel delay

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
function jobs(uint256 jobId) external view returns (Job memory)
```

Returns the details of the job.

Parameters:
- `jobId`: ID of the job

Returns:
- `Job`: Details of the job (struct containing jobId, fileId, bidAmount, status, addedTimestamp, ownerAddress, teeAddress)

---

```solidity
function tees(address teeAddress) public view returns (TeeInfo memory)
```

Returns the details of the TEE.

Parameters:
- `teeAddress`: Address of the TEE

Returns:
- `TeeInfo`: Details of the TEE (struct containing teeAddress, url, status, amount, withdrawnAmount, jobsCount, publicKey)

---

```solidity
function teeJobIdsPaginated(
    address teeAddress,
    uint256 start,
    uint256 limit
) external view returns (uint256[] memory)
```

Returns a paginated list of jobs for the given TEE.

Parameters:
- `teeAddress`: Address of the TEE
- `start`: Start index
- `limit`: Limit of jobs to return

Returns:
- `uint256[]`: List of job IDs

---

```solidity
function teesCount() external view returns (uint256)
```

Returns the number of TEEs.

Returns:
- `uint256`: Number of TEEs

---

```solidity
function teeList() external view returns (address[] memory)
```

Returns the list of TEEs.

Returns:
- `address[]`: List of TEE addresses

---

```solidity
function teeListAt(uint256 index) external view returns (TeeInfo memory)
```

Returns the details of the TEE at the given index.

Parameters:
- `index`: Index of the TEE

Returns:
- `TeeInfo`: Details of the TEE

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

Returns the list of active TEEs.

Returns:
- `address[]`: List of active TEE addresses

---

```solidity
function activeTeeListAt(uint256 index) external view returns (TeeInfo memory)
```

Returns the details of the active TEE at the given index.

Parameters:
- `index`: Index of the active TEE

Returns:
- `TeeInfo`: Details of the active TEE

---

```solidity
function isTee(address teeAddress) external view returns (bool)
```

Checks if the given address is an active TEE.

Parameters:
- `teeAddress`: Address to check

Returns:
- `bool`: True if the address is an active TEE, false otherwise

---

```solidity
function fileJobIds(uint256 fileId) external view returns (uint256[] memory)
```

Returns a list of job IDs for the given file.

Parameters:
- `fileId`: ID of the file

Returns:
- `uint256[]`: List of job IDs

---

```solidity
function pause() external
```

Pauses the contract.

Restrictions:
- Can only be called by the owner

---

```solidity
function unpause() external
```

Unpauses the contract.

Restrictions:
- Can only be called by the owner

---

```solidity
function updateDataRegistry(IDataRegistry newDataRegistry) external
```

Updates the data registry.

Parameters:
- `newDataRegistry`: New data registry address

Restrictions:
- Can only be called by the owner

---

```solidity
function updateTeeFee(uint256 newTeeFee) external
```

Updates the TEE fee.

Parameters:
- `newTeeFee`: New fee amount

Restrictions:
- Can only be called by the owner

---

```solidity
function updateCancelDelay(uint256 newCancelDelay) external
```

Updates the cancel delay.

Parameters:
- `newCancelDelay`: New cancel delay duration

Restrictions:
- Can only be called by the owner

---

```solidity
function addTee(
    address teeAddress,
    string calldata url,
    string calldata publicKey
) external
```

Adds a TEE to the pool.

Parameters:
- `teeAddress`: Address of the TEE
- `url`: URL of the TEE
- `publicKey`: Public key of the TEE

Restrictions:
- Can only be called by the owner

Events emitted:
- `TeeAdded(address indexed teeAddress)`

---

```solidity
function removeTee(address teeAddress) external
```

Removes a TEE from the pool.

Parameters:
- `teeAddress`: Address of the TEE to remove

Restrictions:
- Can only be called by the owner

Events emitted:
- `TeeRemoved(address indexed teeAddress)`

---

```solidity
function requestContributionProof(uint256 fileId) public payable
```

Adds a contribution proof request.

Parameters:
- `fileId`: ID of the file

Restrictions:
- Requires payment of at least the TEE fee
- At least one active TEE must exist

Events emitted:
- `JobSubmitted(uint256 indexed jobId, uint256 indexed fileId, address teeAddress, uint256 bidAmount)`

---

```solidity
function submitJob(uint256 fileId) external payable
```

Submits a contribution proof request (alias for `requestContributionProof`).

Parameters:
- `fileId`: ID of the file

---

```solidity
function cancelJob(uint256 jobId) external
```

Cancels a contribution proof request.

Parameters:
- `jobId`: ID of the job to cancel

Restrictions:
- Can only be called by the job owner
- Job must be in Submitted status
- Cancel delay must have passed

Events emitted:
- `JobCanceled(uint256 indexed jobId)`

---

```solidity
function addProof(uint256 jobId, IDataRegistry.Proof memory proof) external payable
```

Adds a proof to the file.

Parameters:
- `jobId`: ID of the job
- `proof`: Proof for the file

Restrictions:
- Can only be called by an active TEE
- Job must be in Submitted status
- Caller must be the assigned TEE for the job

Events emitted:
- `ProofAdded(address indexed attestator, uint256 indexed jobId, uint256 indexed fileId)`

---

```solidity
function claim() external
```

Method used by TEEs for claiming their rewards.

Restrictions:
- Can only be called by a TEE with unclaimed rewards

Events emitted:
- `Claimed(address indexed teeAddress, uint256 amount)`

### DLPRoot

```solidity
function version() external pure returns (uint256)
```

Returns the version of the contract.

**Returns:**
- `uint256`: The version number of the contract.

---

```solidity
function numberOfTopDlps() external view returns (uint256)
```

Returns the number of top DLPs.

**Returns:**
- `uint256`: The number of top DLPs.

---

```solidity
function maxNumberOfRegisteredDlps() external view returns (uint256)
```

Returns the maximum number of registered DLPs.

**Returns:**
- `uint256`: The maximum number of registered DLPs.

---

```solidity
function epochSize() external view returns (uint256)
```

Returns the size of each epoch in blocks.

**Returns:**
- `uint256`: The size of each epoch in blocks.

---

```solidity
function registeredDlps() external view returns (uint256[] memory)
```

Returns an array of registered DLP IDs.

**Returns:**
- `uint256[] memory`: An array containing the IDs of registered DLPs.

---

```solidity
function epochsCount() external view returns (uint256)
```

Returns the total number of epochs.

**Returns:**
- `uint256`: The total number of epochs.

---

```solidity
function epochs(uint256 epochId) external view returns (EpochInfo memory)
```

Returns information about a specific epoch.

**Parameters:**
- `epochId`: The ID of the epoch to query.

**Returns:**
- `EpochInfo memory`: A struct containing epoch information (startBlock, endBlock, reward, isFinalised, dlpIds).

---

```solidity
function minDlpStakeAmount() external view returns (uint256)
```

Returns the minimum stake amount required for a DLP.

**Returns:**
- `uint256`: The minimum stake amount for a DLP.

---

```solidity
function totalDlpsRewardAmount() external view returns (uint256)
```

Returns the total reward amount for all DLPs.

**Returns:**
- `uint256`: The total reward amount for all DLPs.

---

```solidity
function epochRewardAmount() external view returns (uint256)
```

Returns the reward amount for each epoch.

**Returns:**
- `uint256`: The reward amount for each epoch.

---

```solidity
function ttfPercentage() external view returns (uint256)
```

Returns the percentage for Total Transactions Facilitated (TTF) in performance calculation.

**Returns:**
- `uint256`: The TTF percentage.

---

```solidity
function tfcPercentage() external view returns (uint256)
```

Returns the percentage for Total Transaction Fees Created (TFC) in performance calculation.

**Returns:**
- `uint256`: The TFC percentage.

---

```solidity
function vduPercentage() external view returns (uint256)
```

Returns the percentage for Verified Data Uploads (VDU) in performance calculation.

**Returns:**
- `uint256`: The VDU percentage.

---

```solidity
function uwPercentage() external view returns (uint256)
```

Returns the percentage for Unique Wallets (UW) in performance calculation.

**Returns:**
- `uint256`: The UW percentage.

---

```solidity
function dlpsCount() external view returns (uint256)
```

Returns the total number of DLPs.

**Returns:**
- `uint256`: The total number of DLPs.

---

```solidity
function dlps(uint256 index) external view returns (DlpResponse memory)
```

Returns information about a DLP by its index.

**Parameters:**
- `index`: The index of the DLP.

**Returns:**
- `DlpResponse memory`: A struct containing DLP information.

---

```solidity
function dlpsByAddress(address dlpAddress) external view returns (DlpResponse memory)
```

Returns information about a DLP by its address.

**Parameters:**
- `dlpAddress`: The address of the DLP.

**Returns:**
- `DlpResponse memory`: A struct containing DLP information.

---

```solidity
function dlpIds(address dlpAddress) external view returns (uint256)
```

Returns the ID of a DLP given its address.

**Parameters:**
- `dlpAddress`: The address of the DLP.

**Returns:**
- `uint256`: The ID of the DLP.

---

```solidity
function dlpEpochs(uint256 dlpId, uint256 epochId) external view returns (DlpEpochInfo memory)
```

Returns information about a DLP's performance in a specific epoch.

**Parameters:**
- `dlpId`: The ID of the DLP.
- `epochId`: The ID of the epoch.

**Returns:**
- `DlpEpochInfo memory`: A struct containing DLP epoch information.

---

```solidity
function stakerDlpsListCount(address stakerAddress) external view returns (uint256)
```

Returns the number of DLPs a staker has staked in.

**Parameters:**
- `stakerAddress`: The address of the staker.

**Returns:**
- `uint256`: The number of DLPs the staker has staked in.

---

```solidity
function stakerDlpsList(address stakerAddress) external view returns (StakerDlpInfo[] memory)
```

Returns information about all DLPs a staker has staked in.

**Parameters:**
- `stakerAddress`: The address of the staker.

**Returns:**
- `StakerDlpInfo[] memory`: An array of structs containing staker DLP information.

---

```solidity
function stakerDlps(address stakerAddress, uint256 dlpId) external view returns (StakerDlpInfo memory)
```

Returns information about a specific DLP a staker has staked in.

**Parameters:**
- `stakerAddress`: The address of the staker.
- `dlpId`: The ID of the DLP.

**Returns:**
- `StakerDlpInfo memory`: A struct containing staker DLP information.

---

```solidity
function stakerDlpEpochs(address stakerAddress, uint256 dlpId, uint256 epochId) external view returns (StakerDlpEpochInfo memory)
```

Returns information about a staker's performance in a specific DLP and epoch.

**Parameters:**
- `stakerAddress`: The address of the staker.
- `dlpId`: The ID of the DLP.
- `epochId`: The ID of the epoch.

**Returns:**
- `StakerDlpEpochInfo memory`: A struct containing staker DLP epoch information.

---

```solidity
function topDlpIds(uint256 numberOfDlps) external returns (uint256[] memory)
```

Returns the IDs of the top performing DLPs.

**Parameters:**
- `numberOfDlps`: The number of top DLPs to return.

**Returns:**
- `uint256[] memory`: An array of top DLP IDs.

---

```solidity
function unstakebleAmount(address stakerAddress, uint256 dlpId) external returns (uint256)
```

Returns the amount a staker can unstake from a specific DLP.

**Parameters:**
- `stakerAddress`: The address of the staker.
- `dlpId`: The ID of the DLP.

**Returns:**
- `uint256`: The amount that can be unstaked.

---

```solidity
function claimableAmount(address stakerAddress, uint256 dlpId) external returns (uint256)
```

Returns the amount of rewards a staker can claim from a specific DLP.

**Parameters:**
- `stakerAddress`: The address of the staker.
- `dlpId`: The ID of the DLP.

**Returns:**
- `uint256`: The amount of rewards that can be claimed.

---

```solidity
function pause() external
```

Pauses the contract. Can only be called by the owner.

**Emits:** `Paused` event

---

```solidity
function unpause() external
```

Unpauses the contract. Can only be called by the owner.

**Emits:** `Unpaused` event

---

```solidity
function updateNumberOfTopDlps(uint256 newNumberOfTopDlps) external
```

Updates the number of top DLPs. Can only be called by the owner.

**Parameters:**
- `newNumberOfTopDlps`: The new number of top DLPs.

**Emits:** `NumberOfTopDlpsUpdated` event

---

```solidity
function updateMaxNumberOfRegisteredDlps(uint256 newMaxNumberOfRegisteredDlps) external
```

Updates the maximum number of registered DLPs. Can only be called by the owner.

**Parameters:**
- `newMaxNumberOfRegisteredDlps`: The new maximum number of registered DLPs.

**Emits:** `MaxNumberOfRegisteredDlpsUpdated` event

---

```solidity
function updateEpochSize(uint256 newEpochSize) external
```

Updates the epoch size. Can only be called by the owner.

**Parameters:**
- `newEpochSize`: The new epoch size in blocks.

**Emits:** `EpochSizeUpdated` event

---

```solidity
function updateEpochRewardAmount(uint256 newEpochRewardAmount) external
```

Updates the epoch reward amount. Can only be called by the owner.

**Parameters:**
- `newEpochRewardAmount`: The new epoch reward amount.

**Emits:** `EpochRewardAmountUpdated` event

---

```solidity
function updateMinDlpStakeAmount(uint256 newMinStakeAmount) external
```

Updates the minimum DLP stake amount. Can only be called by the owner.

**Parameters:**
- `newMinStakeAmount`: The new minimum stake amount for DLPs.

**Emits:** `MinDlpStakeAmountUpdated` event

---

```solidity
function updatePerformancePercentages(uint256 newTtfPercentage, uint256 newTfcPercentage, uint256 newVduPercentage, uint256 newUwPercentage) external
```

Updates the performance percentages. Can only be called by the owner.

**Parameters:**
- `newTtfPercentage`: The new TTF percentage.
- `newTfcPercentage`: The new TFC percentage.
- `newVduPercentage`: The new VDU percentage.
- `newUwPercentage`: The new UW percentage.

**Restrictions:**
- The sum of all percentages must equal 100e18.

**Emits:** `PerformancePercentagesUpdated` event

---

```solidity
function createEpochs() external
```

Creates epochs until the current block number.

**Emits:** `EpochCreated` event for each new epoch

---

```solidity
function createEpochsUntilBlockNumber(uint256 blockNumber) external
```

Creates epochs until a specific block number.

**Parameters:**
- `blockNumber`: The block number to create epochs until.

**Emits:** `EpochCreated` event for each new epoch

---

```solidity
function registerDlp(address dlpAddress, address payable ownerAddress, uint256 stakersPercentage) external payable
```

Registers a new DLP.

**Parameters:**
- `dlpAddress`: The address of the DLP.
- `ownerAddress`: The address of the DLP owner.
- `stakersPercentage`: The percentage of rewards to be distributed to stakers.

**Restrictions:**
- The contract must not be paused.
- The number of registered DLPs must be less than the maximum allowed.
- The stake amount must be greater than or equal to the minimum required.

**Emits:** `DlpRegistered` event

---

```solidity
function registerDlpWithGrant(address dlpAddress, address payable ownerAddress, uint256 stakersPercentage) external payable
```

Registers a new DLP with a grant.

**Parameters:**
- `dlpAddress`: The address of the DLP.
- `ownerAddress`: The address of the DLP owner.
- `stakersPercentage`: The percentage of rewards to be distributed to stakers.

**Restrictions:**
- The contract must not be paused.
- The number of registered DLPs must be less than the maximum allowed.
- The stake amount must be greater than or equal to the minimum required.

**Emits:** `DlpRegistered` event

---

```solidity
function updateDlpStakersPercentage(uint256 dlpId, uint256 stakersPercentage) external
```

Updates the stakers percentage for a DLP. Can only be called by the DLP owner.

**Parameters:**
- `dlpId`: The ID of the DLP.
- `stakersPercentage`: The new percentage of rewards to be distributed to stakers.

**Restrictions:**
- Can only be called by the DLP owner.
- The new percentage must be less than or equal to 100e18.

**Emits:** `DlpStakersPercentageUpdated` event

---

```solidity
function deregisterDlp(uint256 dlpId) external
```

Deregisters a DLP. Can only be called by the DLP owner.

**Parameters:**
- `dlpId`: The ID of the DLP to deregister.

**Restrictions:**
- Can only be called by the DLP owner.
- The DLP must be in the Registered status.

**Emits:** `DlpDeregistered` event

---

```solidity
function distributeStakeAfterDeregistration(uint256 dlpId, uint256 dlpOwnerAmount) external
```

Distributes the stake after deregistration of a granted DLP. Can only be called by the contract owner.

**Parameters:**
- `dlpId`: The ID of the deregistered DLP.
- `dlpOwnerAmount`: The amount to distribute to the DLP owner.

**Restrictions:**
- Can only be called by the contract owner.
- The DLP must be in the Deregistered status.

---

```solidity
function saveEpochPerformances(uint256 epochId, DlpPerformance[] memory dlpPerformances, bool isFinalised) external
```

Saves the performances of top DLPs for a specific epoch and calculates the rewards. Can only be called by the contract owner.

**Parameters:**
- `epochId`: The ID of the epoch.
- `dlpPerformances`: An array of DLP performance structs.
- `isFinalised`: Whether the epoch is being finalised.

**Restrictions:**
- Can only be called by the contract owner.
- The epoch must not be already finalised.
- If finalising, the previous epoch must be finalised and the current epoch must have ended.

**Emits:** `EpochPerformancesSaved` event

---

```solidity
function addRewardForDlps() external payable
```

Adds rewards for DLPs.

**Restrictions:**
- The contract must not be paused.

---

```solidity
function claimRewardUntilEpoch(uint256 dlpId, uint256 lastEpochToClaim) external
```

Claims rewards for a DLP until a specific epoch.

**Parameters:**
- `dlpId`: The ID of the DLP.
- `lastEpochToClaim`: The last epoch to claim rewards for.

**Restrictions:**
- The contract must not be paused.
- There must be rewards to claim.

**Emits:** `StakerDlpEpochRewardClaimed` event for each claimed epoch

---

```solidity
function claimReward(uint256 dlpId) external
```

Claims all available rewards for a DLP.

**Parameters:**
- `dlpId`: The ID of the DLP.

**Restrictions:**
- The contract must not be paused.
- There must be rewards to claim.

**Emits:** `StakerDlpEpochRewardClaimed` event for each claimed epoch

---

```solidity
function stake(uint256 dlpId) external payable
```

Stakes tokens for a specific DLP.

**Parameters:**
- `dlpId`: The ID of the DLP to stake for.

**Restrictions:**
- The DLP must be in the Registered status.
- The current epoch must be created.

**Emits:** `Staked` event

---

```solidity
function unstake(uint256 dlpId, uint256 amount) external
```

Unstakes tokens from a specific DLP.

**Parameters:**
- `dlpId`: The ID of the DLP to unstake from.
- `amount`: The amount of tokens to unstake.

**Restrictions:**
- The amount must be less than or equal to the unstakeable amount.
- The current epoch must be created.

**Emits:** `Unstaked` event

---

```solidity
function estimatedDlpReward(uint256 dlpId) external view returns (uint256 historyRewardEstimation, uint256 stakeRewardEstimation)
```

Gets the estimated rewards for a DLP's stakes.

**Parameters:**
- `dlpId`: The ID of the DLP.

**Returns:**
- `historyRewardEstimation`: Percentage estimated reward per epoch based on the data from the last epoch in which the DLP was part of.
- `stakeRewardEstimation`: Percentage estimated reward per epoch based on the total stake amount and reward from the current epoch.

**Note:** Percentages are scaled by 1e18.

---

```solidity
function initialize(InitParams memory params) external initializer
```

Initializes the contract. Can only be called once.

**Parameters:**
- `params`: A struct containing initialization parameters including owner address, max number of registered DLPs, number of top DLPs, minimum DLP stake amount, start block, epoch size, epoch reward amount, and performance percentages.

**Restrictions:**
- Can only be called once due to the `initializer` modifier.
- The sum of all performance percentages must equal 100e18.

---

```solidity
function _authorizeUpgrade(address newImplementation) internal virtual override onlyOwner
```

Internal function to authorize an upgrade to a new implementation. Can only be called by the owner.

**Parameters:**
- `newImplementation`: The address of the new implementation contract.

**Restrictions:**
- Can only be called by the contract owner.

---  
  

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
    - `ownerAddress`: The address of the contract owner
    - `tokenAddress`: The address of the ERC20 token used for rewards
    - `dataRegistryAddress`: The address of the data registry contract
    - `teePoolAddress`: The address of the TEE pool contract
    - `name`: The name of the data liquidity pool
    - `publicKey`: The public key for the pool
    - `proofInstruction`: The instruction for generating proofs
    - `fileRewardFactor`: The factor used to calculate file rewards

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
- `newProofInstruction`: The new proof instruction

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
- `newPublicKey`: The new public key

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

### DAT (Data Access Token)


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

## 6. Audit

https://hashlock.com/audits/vana
