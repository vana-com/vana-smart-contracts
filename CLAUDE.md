# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Vana Smart Contracts repository - a comprehensive ecosystem of smart contracts powering the Vana blockchain network. Vana is an EVM-compatible layer-1 blockchain for data sovereignty that enables users to monetize, control, and govern their data through Data Liquidity Pools (DLPs) and DataDAOs.

## Key Commands

### Development Commands
- `yarn install` - Install dependencies
- `npx hardhat compile` - Compile smart contracts
- `npx hardhat test` - Run test suite
- `npx hardhat test test/specific/test.ts` - Run specific test file
- `npx hardhat node` - Start local hardhat node
- `npx hardhat clean` - Clean artifacts and cache

### Network Operations
- `npx hardhat deploy --network moksha --tags DLPDeploy` - Deploy to Moksha testnet
- `npx hardhat deploy --network vana --tags DLPDeploy` - Deploy to Vana mainnet
- `npx hardhat verify --network moksha <contract-address>` - Verify contracts on Moksha

### Testing & Coverage
- `npx hardhat coverage` - Generate coverage report
- `npx hardhat test --grep "specific test"` - Run specific test pattern

## Smart Contract Architecture

### Core Contract Categories

**Data Contracts** (`/contracts/data/`):
- DataRegistry: Central repository for data files and metadata
- ComputeEngine: Orchestrates TEE-based data processing
- TeePool: Manages Trusted Execution Environment pools
- QueryEngine: Handles data queries and access control
- DataRefinerRegistry: Manages data refinement services

**DLP Templates** (`/contracts/dlpTemplates/`):
- DataLiquidityPool: Template for creating DataDAOs
- DAT (Data Autonomous Token): VRC-20 compliant token template
- DATFactory: Factory for deploying DAT tokens with vesting

**DLP Rewards** (`/contracts/dlpRewards/`):
- DLPRegistry: Registry and performance tracking for DLPs
- DLPRewardDeployer: Automated reward distribution system
- VanaEpoch: Epoch-based reward calculation
- SwapHelper: DEX integration for token swaps

**Vana Staking** (`/contracts/vanaStaking/`):
- VanaPoolStaking: User interface for staking operations
- VanaPoolEntity: Entity registry and reward management
- VanaPoolTreasury: Secure treasury for staked assets

**Chain Utilities** (`/contracts/chain/`):
- Multicall3: Batch transaction execution
- Multisend: Multiple transaction broadcasting
- L1Deposit: Cross-chain deposit management

**Data Portability** (`/contracts/dataPortability/`):
- DataPortabilityPermissions: Manages data export permissions
- DataPortabilityGrantees: Handles grantee access rights
- DataPortabilityServers: Server registry for data portability

### Key Design Patterns

**Proxy Pattern**: All main contracts use OpenZeppelin's upgradeable proxy pattern:
- Implementation contracts contain the logic
- Proxy contracts handle storage and delegate calls
- Enables upgrades while preserving state

**Factory Pattern**: Used for deploying standardized contract instances:
- DATFactory for token deployment
- ComputeEngineTeePoolFactory for TEE pool creation
- ProxyFactory patterns for beacon proxies

**Treasury Pattern**: Separate treasury contracts manage funds:
- Isolates financial logic from business logic
- Enables secure fund management
- Supports multiple treasury types (rewards, stakes, etc.)

## Development Guidelines

### Network Configuration
- **Hardhat Local**: chainId 1480 (matches Vana mainnet)
- **Moksha Testnet**: chainId 14800
- **Vana Mainnet**: chainId 1480
- **Satori**: chainId 14801

### Environment Setup
- Copy `.env.example` to `.env` and configure:
  - `DEPLOYER_PRIVATE_KEY`: Private key for deployments
  - `VANA_RPC_URL`: Vana mainnet RPC endpoint
  - `MOKSHA_RPC_URL`: Moksha testnet RPC endpoint
  - Network-specific API URLs for verification

### Testing Structure
- Unit tests in `/test/` directory organized by contract category
- Integration tests for cross-contract interactions
- Fork tests for mainnet integration testing
- Mock contracts in `/mocks/` for testing edge cases

### Deployment Structure
- Deploy scripts in `/deploy/` directory
- Tagged deployment system using hardhat-deploy
- Network-specific deployment configurations
- Official deployments tracked in `/deployments-official/`

### Key Dependencies
- **Hardhat**: Development framework and testing
- **OpenZeppelin**: Security-audited contract libraries
- **Ethers.js v6**: Ethereum interaction library
- **TypeChain**: TypeScript bindings for contracts
- **Hardhat-deploy**: Deployment management

## Important Notes

### Security Considerations
- All contracts use OpenZeppelin's security patterns
- Comprehensive audit reports available from Hashlock and Nethermind
- Upgradeability managed through secure proxy patterns
- Role-based access control throughout the system

### Gas Optimization
- Compiler settings optimize for deployment size (runs: 1)
- Batch operations available through Multicall3
- Efficient storage patterns in all contracts

### VRC Standards Compliance
- VRC-14: Reward distribution standard
- VRC-15: Data access standard  
- VRC-20: Token standard (extends ERC-20)

### Testing Best Practices
- All tests use Hardhat's time manipulation utilities
- Comprehensive test coverage for all contract functions
- Integration tests verify cross-contract interactions
- Fork testing against live networks when needed