# Data Liquidity Pool (DLP)

## Table of Contents
1. [Introduction](#introduction)
2. [Overview](#overview)
3. [Flow](#flow)
4. [Installation](#installation)
5. [DLP Contracts](#dlp-contracts)
    - [DataLiquidityPool](#dataliquiditypool)
    - [DAT (Data Access Token)](#dat-data-access-token)


## 1. Introduction

Vana turns data into currency to push the frontiers of decentralized AI. It is a layer one blockchain designed for private, user-owned data. It allows users to collectively own, govern, and earn from the AI models trained on their data. For more context see this [docs](https://docs.vana.org/vana).

This repository is designed for DLP (Data Liquidity Pool) creators and developers who want to deploy a DLP and its associated DLP Token on the Vana blockchain. The code provided here serves as an example implementation of a DLP smart contract. It's important to note that this is just one possible implementation – developers are encouraged to customize this contract or create their own versions to suit their specific use cases. Whether you're looking to create a standard DLP or develop a highly customized one, this repo provides a template implementation.

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

Moksha:  [0xf408A064d640b620219F510963646Ed2bD5606BB](https://moksha.vanascan.io/address/0xf408A064d640b620219F510963646Ed2bD5606BB)

Satori: [0xf408A064d640b620219F510963646Ed2bD5606BB](https://satori.vanascan.io/address/0xf408A064d640b620219F510963646Ed2bD5606BB)

### [Data Liquidity Pool & DLPToken](https://docs.vana.org/vana/welcome-to-vana/what-is-data-liquidity-pool)

A Data Liquidity Pool (DLP) is a core component of the Vana ecosystem, designed to transform raw data into a liquid asset. It functions as a smart contract on the Vana blockchain that allows users to monetize, control, and govern their data in a decentralized manner. Each DLP can have its own token, providing contributors with ongoing rewards and governance rights.

**DataRegistry**, **TEEPool**, and **RootNetwork** are part of the Vana core smart contracts and do not need to be deployed by DLP builders. For testing and integration, you should use the addresses deployed on Moksha. However, you will need to deploy your own **Data Liquidity Pool** & **DLPToken** (either the template version suggested by us or your own version). Keep in mind that to be part of the Vana ecosystem and qualify for the DLP rewards program, the DLP contract needs to be integrated with **DataRegistry** and **RootNetwork** as shown in the template in this repository.


## 3. Flow

### Data Contributor Flow

The following describes the process of contributing data to a DLP from a user's perspective:

Bob wants to become a data contributor for DLP1. Here's the step-by-step process:

1. Bob uploads his file to the DataRegistry (a URL with encrypted data).
2. Bob requests an attestation by adding a new job in the TeePool.
3. TEE operators see Bob's job and create an attestation for that file based on the instructions required for validating the file in relation to DLP1.
4. This proof is saved in the DataRegistry.
5. Simultaneously, Bob must grant access to the DLP to read the data (by encrypting the file with the specific masterKey of DLP1).
6. After Bob's file receives the necessary attestation, he must inform DLP1 that he has uploaded a file to the DataRegistry intended for this DLP.
7. DLP1 must verify if it can indeed decrypt the file's content using its master private key.
8. If successful, Bob will be automatically rewarded based on the score obtained from the attestation by the TEE operator.

This process ensures that data is securely contributed, validated, and rewarded within the Vana ecosystem.

It's important to emphasize that this is just an example of Bob's interaction with the smart contracts. In practice, there should be a user interface (UI) that comes packaged with these contracts to assist users. This UI would simplify the process for users, making it easier for them to interact with the DLP ecosystem without needing to directly interact with the smart contracts.

### Reward distribution

The RootNetwork smart contract manages the reward distribution for Data Liquidity Pools (DLPs) in the Vana ecosystem. Here's a detailed explanation of how the reward system works:

#### DLP Registration and Staking

1. Each DLP must register in the RootNetwork contract using the `registerDLP` method.
2. During registration, the DLP specifies a `stakersPercentage`, which determines the proportion of rewards that will go to the DLP's stakers. The remainder goes to the DLP owner.

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

`DLP_NAME`: The name of your Data Liquidity Pool. Choose a descriptive name for your DLP.

`DLP_MASTER_KEY`: A master key for your DLP. This is used for encryption purposes. Make sure to generate a strong, unique key.

`DLP_TOKEN_NAME`: The name of the token associated with your DLP. This will be visible in token listings.

`DLP_TOKEN_SYMBOL`: The symbol of your DLP token. This is typically a short, all-caps code.

`DLP_FILE_REWARD_FACTOR`: A factor used to calculate file rewards. This value determines the reward amount based on the file's score.

#### 2. Install dependencies
```bash
yarn install
```

#### 3. Run tests
- DLP tests: ```npx hardhat test test/dlp.ts```
- DLPToken tests: ```npx hardhat test test/token.ts```
- all tests (including dependencies): ```npx hardhat test```

#### 4. Deploy your own Token & DLP
```bash
npx hardhat deploy --network moksha --tags DLPDeploy  
```

The deployment script will also verify the contract on blockscout.

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

### After Registration

Upon successful registration:
1. The DLP is assigned a unique ID.
2. The DLP's details are stored in the contract.
3. The sent stake amount is recorded for the DLP owner as a stake.
4. The DLP is added to the list of registered DLPs.
5. Users can start staking VANA tokens to the DLP to participate in the reward distribution.


## 5. Dlp Contracts

### DataLiquidityPool

This contract is designed to be upgradeable using the Universal Upgradeable Proxy Standard (UUPS) pattern. This allows for future improvements while maintaining the contract's state and address.

For more information on the UUPS pattern and how to work with upgradeable contracts, please refer to the OpenZeppelin documentation:
- [Proxy Upgrade Pattern](https://docs.openzeppelin.com/upgrades-plugins/1.x/proxies)
- [Writing Upgradeable Contracts](https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable)


###
```solidity
function initialize(InitParams memory params) external initializer
```

Description: Initializes the contract with essential parameters.

Parameters:
- `params`: InitParams struct containing:
    - `ownerAddress`: Address of the contract owner
    - `tokenAddress`: Address of the ERC20 token used for rewards
    - `dataRegistryAddress`: Address of the DataRegistry contract
    - `teePoolAddress`: Address of the TeePool contract
    - `name`: Name of the DataLiquidityPool
    - `masterKey`: Master key for the pool
    - `fileRewardFactor`: Factor used to calculate file rewards

Restrictions: Can only be called once due to the `initializer` modifier

Events Emitted: None

###
```solidity
function version() external pure virtual override returns (uint256)
```

Description: Returns the version of the contract.

Parameters: None

Return Value:
- `uint256`: The version number of the contract

Restrictions: None

Events Emitted: None

###
```solidity
function files(uint256 fileId) public view override returns (FileResponse memory)
```

Description: Gets the file information for a given file ID.

Parameters:
- `fileId`: ID of the file

Return Value:
- `FileResponse`: A struct containing file details (fileId, status, registryId, timestamp, proofIndex, rewardAmount, rewardWithdrawn)

Restrictions: None

Events Emitted: None

###
```solidity
function contributors(uint256 index) external view override returns (ContributorInfoResponse memory)
```

Description: Gets the contributor information for a given index.

Parameters:
- `index`: Index of the contributor

Return Value:
- `ContributorInfoResponse`: A struct containing contributor details (contributorAddress, fileIdsCount)

Restrictions: None

Events Emitted: None

###
```solidity
function contributorInfo(address contributorAddress) public view override returns (ContributorInfoResponse memory)
```

Description: Gets the contributor information for a given address.

Parameters:
- `contributorAddress`: Address of the contributor

Return Value:
- `ContributorInfoResponse`: A struct containing contributor details (contributorAddress, fileIdsCount)

Restrictions: None

Events Emitted: None

###
```solidity
function contributorFiles(address contributorAddress, uint256 index) external view override returns (FileResponse memory)
```

Description: Gets the file information for a contributor's file at a given index.

Parameters:
- `contributorAddress`: Address of the contributor
- `index`: Index of the file

Return Value:
- `FileResponse`: A struct containing file details (fileId, status, registryId, timestamp, proofIndex, rewardAmount, rewardWithdrawn)

Restrictions: None

Events Emitted: None

###
```solidity
function pause() external override onlyOwner
```

Description: Pauses the contract.

Parameters: None

Restrictions: Only owner

Events Emitted: None (inherited from OpenZeppelin's Pausable)

###
```solidity
function unpause() external override onlyOwner
```

Description: Unpauses the contract.

Parameters: None

Restrictions: Only owner

Events Emitted: None (inherited from OpenZeppelin's Pausable)

###
```solidity
function updateFileRewardFactor(uint256 newFileRewardFactor) external override onlyOwner
```

Description: Updates the file reward factor.

Parameters:
- `newFileRewardFactor`: New file reward factor value

Restrictions: Only owner

Events Emitted:
- `FileRewardFactorUpdated(uint256 newFileRewardFactor)`

###
```solidity
function updateTeePool(address newTeePool) external override onlyOwner
```

Description: Updates the TEE pool address.

Parameters:
- `newTeePool`: Address of the new TEE pool

Restrictions: Only owner

Events Emitted: None

###
```solidity
function addFile(uint256 registryId, uint256 proofIndex) external override whenNotPaused
```

Description: Adds a new file to the pool.

Parameters:
- `registryId`: File ID from the DataRegistry contract
- `proofIndex`: Index of the proof in the DataRegistry

Restrictions:
- Contract must not be paused
- Caller must be the owner of the file in the DataRegistry
- Proof must be signed by a valid TEE

Events Emitted:
- `FileAdded(address indexed contributorAddress, uint256 fileId)`

###
```solidity
function addRewardsForContributors(uint256 contributorsRewardAmount) external override nonReentrant
```

Description: Adds rewards for contributors to the pool.

Parameters:
- `contributorsRewardAmount`: Amount of tokens to add as rewards

Restrictions:
- NonReentrant

Events Emitted: None

###
```solidity
function validateFile(uint256 fileId) external override onlyOwner
```

Description: Validates a file and sends the contribution reward.

Parameters:
- `fileId`: ID of the file to validate

Restrictions:
- Only owner
- File must be in 'Added' status
- Sufficient rewards must be available

Events Emitted:
- `FileValidated(uint256 indexed fileId)`

###
```solidity
function invalidateFile(uint256 fileId) external override onlyOwner
```

Description: Invalidates a file.

Parameters:
- `fileId`: ID of the file to invalidate

Restrictions:
- Only owner
- File must be in 'Added' status

Events Emitted:
- `FileInvalidated(uint256 indexed fileId)`

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

---

This README provides a detailed overview of the DLP project's smart contracts. For the most up-to-date information, always refer to the latest contract code and documentation.