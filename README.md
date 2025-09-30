# Vana Smart Contracts

[![semantic-release: angular](https://img.shields.io/badge/semantic--release-conventionalcommits-e10079?logo=semantic-release)](https://github.com/semantic-release/semantic-release)

## About Vana

Vana is an open and decentralized protocol for data sovereignty that unlocks user-owned data as a new digital asset class in the global AI economy. The Vana network is an EVM-compatible layer-1 blockchain designed to restore individual control over personal data and enable user-owned AI through private and secure data transactions at individual and collective levels.

In an era where artificial intelligence is driving immense value from user data, Vana ensures that data creators—individuals—capture a fair share of the value generated while enabling researchers to access unique datasets. By combining blockchain coordination, privacy-preserving technologies, and tokenized economic incentives, Vana enables users to maintain full control over their data while contributing to collective data assets that power AI and other applications.

## Repository Overview

This repository contains the smart contracts that power the Vana ecosystem. These contracts enable users to monetize, control, and govern their data in a decentralized manner while facilitating the creation of Data Liquidity Pools (DLPs) and managing reward distribution mechanisms.

## Smart Contract Categories

The smart contracts are organized into distinct categories, each located in its own folder with dedicated documentation:

### [DlpTemplates](/contracts/dlpTemplates/)
The DLP Templates contracts provide the foundational smart contract implementations that DataDAO creators must deploy to launch their own Data Liquidity Pools within the Vana ecosystem. Unlike the core Vana infrastructure contracts (DataRegistry, TEEPool, and RootNetwork) which are pre-deployed and maintained by the Vana team, these template contracts must be customized and deployed by each individual DataDAO creator to establish their specific data marketplace. The templates include both the Data Liquidity Pool (DLP) contract that handles validator registration, data validation, and reward distribution, as well as the accompanying VRC-20 token contract that enables tokenized data contributions and governance rights.

These templates serve as the technical foundation for DataDAOs - collectively governed datasets that aggregate and verify individual user data while solving critical challenges of sybil resistance through proof-of-contribution mechanisms and data valuation through dataset-specific validation logic. The repository provides example implementations that developers are encouraged to customize for their specific use cases, whether creating a standard DLP or developing highly customized solutions, while ensuring integration with the core Vana contracts to qualify for the DataDAO rewards program. Each deployment creates a unique data marketplace with its own validation logic, reward mechanisms, and governance structure, enabling diverse data types and business models within the broader Vana ecosystem.

The dat and dlp subfolders contain the specific contract implementations and deployment configurations needed to create functional DataDAOs, including comprehensive validator management systems, proof-of-contribution validation mechanisms, and VRC-20 compliant token economics. These contracts handle the complete lifecycle of data monetization - from initial data contribution and validation to reward distribution and governance participation - while maintaining compliance with VRC standards (VRC-14 for rewards, VRC-15 for data access, and VRC-20 for token standards) required for ecosystem participation and reward eligibility.

DataDAO creators deploy these contracts to establish their position in the data economy, where contributors earn dataset-specific tokens for validated data contributions, AI builders burn VANA plus DataDAO tokens for secure data access through TEE environments, and value flows back to token holders based on actual data usage and market demand. This creates a permissionless system where anyone can create a DataDAO around any data source without requiring approval from original platforms, leveraging existing data privacy regulations that guarantee users the right to export and control their personal data.

### [Data](/contracts/data/)
The data contracts form the foundational infrastructure for data management, validation, and access control within the Vana network. These core smart contracts work together to provide a comprehensive ecosystem that enables secure, private, and transparent data operations across the entire platform.

At the heart of this system is the Data Registry, which serves as the central repository and file catalog for all data in the network, managing unique identifiers, access permissions, and metadata storage. The TEE Pool orchestrates Trusted Execution Environments in the Satya Network, enabling privacy-preserving validation of data contributions through Proof of Contribution mechanisms while ensuring data remains shielded from validators and external parties during processing.

This category includes contracts for job execution management, data access permissions with transparent pricing, and data refinement workflows that support DataDAO operations. Together, these contracts provide the essential building blocks for data liquidity and monetization within the Vana ecosystem.

### [DlpRewards](/contracts/dlpRewards/)

The DLP Rewards contracts form a sophisticated ecosystem for managing and distributing rewards across Data Liquidity Pools (DLPs) and DataDAOs within the Vana network. This system operates on a quarterly epoch-based model where rewards are allocated based on three key performance metrics: Token Trading Volume (30%), Unique Data Contributors (20%), and Data Access Fees (50%), with the total reward pool starting at 0.5% of VANA supply and increasing by 0.5% for every $500M in Total Data Value Locked (TDVL) . The architecture includes specialized contracts for performance tracking, reward calculation, treasury management, and automated token swapping to ensure efficient distribution and market liquidity.

The system features a modular architecture with DLPRootMetrics handling performance calculations and rating systems, while treasury contracts manage reward pools independently. Rewards are deployed daily through automated VANA token buy-ins that purchase DataDAO tokens and add liquidity to DEX pools, with sophisticated slippage protection mechanisms that pause transactions if slippage would exceed 2% and implement gradual deployment over 3-month periods to prevent market manipulation . The reward deployer contracts orchestrate the distribution process, while swap helper contracts facilitate seamless token exchanges between VANA and DataDAO tokens in the marketplace.

The dlpPerformance contract tracks real-time metrics including data access fees, unique contributor activity, and trading volume, feeding this data into reward calculation algorithms that determine epoch-based distributions. The system has eliminated previous staking requirements, moving to a performance-based model where any DataDAO meeting eligibility requirements can qualify for rewards without the previous Top 16 constraint. The treasury contract manages reward allocations while ensuring compliance with VRC-14, VRC-15, and VRC-20 standards.

To maintain ecosystem health, the system includes comprehensive eligibility requirements and mechanisms to return unclaimed rewards to the global pool if DataDAOs fail to maintain sufficient liquidity or compliance standards. This creates a sustainable, market-driven approach to data monetization where rewards align with real utility and foster long-term growth of the DataFi ecosystem, focusing purely on performance metrics.

### [VanaStaking](/contracts/vanaStaking/)
The VanaPool protocol offers a flexible, yield-generating staking ecosystem built on the Vana blockchain that creates a marketplace where users can stake their VANA tokens into various entities, each with its own risk profile, APY settings, and reward structure, allowing for diversification across investment options while maintaining liquidity. This system has evolved beyond the previous DataDAO-specific staking model to provide a more comprehensive and secure staking infrastructure that supports multiple entity types and use cases across the Vana ecosystem.

The architecture centers around VanaPoolStaking as the user-facing interface that manages the issuance and redemption of entity shares representing proportional ownership in staking pools, while VanaPoolEntity serves as the central registry maintaining entity status, reward pools, and configuration settings with sophisticated continuous compounding formulas. VanaPoolTreasury acts as the secure vault for all protocol assets, implementing strict access controls and accurate accounting to ensure only authorized contracts can withdraw funds, while the system supports flexible staking options including delegation and custody solutions with comprehensive slippage protection mechanisms. This modular design ensures security, scalability, and fair reward distribution while enabling users to diversify their staking positions across different entities within the Vana ecosystem.

### [Chain](/contracts/chain/)
The chain contracts provide essential blockchain infrastructure and utility functions that support the core operations of the Vana network. These contracts include Multicall3 for batching multiple smart contract calls into single transactions to reduce gas costs and improve efficiency, and the multisend contract that allows users to send multiple transactions in a single call for batch operations such as distributing rewards or gas fees to multiple addresses . Additionally, the l1deposit contract manages layer-1 blockchain deposit operations, ensuring seamless interaction between different network layers.

These infrastructure contracts are designed to optimize gas usage, reduce transaction overhead, and provide sophisticated call aggregation patterns with configurable error handling . They serve as fundamental building blocks that enable more complex operations across the Vana ecosystem, supporting everything from reward distributions to cross-chain functionality while maintaining the security and efficiency standards required for a robust blockchain network.

### [Utils](/contracts/utils/)
The Utils contracts folder contains utility smart contracts that provide supporting functionality and shared services used across other contract categories within the Vana ecosystem. These contracts implement common patterns, helper functions, and reusable components that enhance the functionality of the core data, chain, staking, and reward systems, ensuring code efficiency, standardization, and maintainability throughout the smart contract architecture.RetryClaude can make mistakes. Please double-check responses.

### [DlpRoot - deprecated](/contracts/dlpRoot/)
Core DLP management system handling registration, staking, epoch-based operations, and reward distribution across the Vana ecosystem. The contracts were deprecated in favor of the new Data Validator Staking model and DlpRewards system.

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- Yarn package manager
- Hardhat development environment

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/vana-com/vana-smart-contracts.git
   cd vana-smart-contracts
   ```

2. **Install dependencies**
   ```bash
   yarn install
   ```

3. **Set up environment variables**

   Copy the `.env.example` file and rename it to `.env`:
   ```bash
   cp .env.example .env
   ```

### Usage

Run tests:
```bash
npx hardhat test
```

Deploy to Moksha testnet:
```bash
npx hardhat deploy --network moksha --tags DLPDeploy
```


## Security & Audits

All smart contracts have undergone comprehensive security audits by:

- **[Hashlock](https://hashlock.com/audits/vana)**
- **[Nethermind](https://github.com/NethermindEth/PublicAuditReports)**

Each major contract update receives its own audit to ensure continued security as the protocol evolves.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with appropriate tests
4. Submit a pull request with detailed description

## License

This project is licensed under the MIT License - see the LICENSE file for details.


## Links

- **Website**: https://www.vana.org
- **Documentation**: https://docs.vana.org
- **Block Explorer**: https://vanascan.io
- **GitHub**: https://github.com/vana-com