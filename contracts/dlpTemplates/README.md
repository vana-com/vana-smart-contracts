# DLP Templates Contracts

This folder contains the essential smart contract templates that DataDAO creators must deploy to launch their own Data Liquidity Pools (DLPs) within the Vana ecosystem. These templates provide the foundational implementations for creating DataDAOs - collectively governed datasets that aggregate, verify, and monetize individual user data while maintaining user ownership and control through cryptographic mechanisms.

For a full tutorial about how to create a DataDAO visit: https://docs.vana.org/docs/quick-start-create-a-datadao

### 1. Deploy Smart Contracts

Set up and deploy your DataDAO's smart contracts on the Moksha Testnet. For the complete deployment guide, see [Deploy Smart Contracts](https://docs.vana.org/docs/2-register-datadao).

**Clone and Install:**
```bash
git clone https://github.com/vana-com/vana-smart-contracts.git
cd vana-smart-contracts
npm install
cp .env.example .env
```

**Configure `.env`:**

Edit `.env` with these **required** fields:

```bash
DEPLOYER_PRIVATE_KEY=...           # Your private_key from the previous step, 62-64 letters  
OWNER_ADDRESS=0x...                # Your wallet address from the previous step, 40-42 letters
DLP_NAME=QuickstartDAO             # Name of your DataDAO
DLP_PUBLIC_KEY=045...              # Your wallet public_key from the previous step, 128-132 letters 
DLP_TOKEN_NAME=QuickToken          # Token name
DLP_TOKEN_SYMBOL=QTKN              # Token symbol 
```

🚧 **Security Note:** `.env` files contain sensitive keys. Do **not** commit this file to Git or share it — anyone with access to your `DEPLOYER_PRIVATE_KEY` can take control of your contracts.

**These examples are for format reference only — do not use them in production:**
```bash
DEPLOYER_PRIVATE_KEY=48fe86dc5053bf2c6004a24c0965bd2142fe921a074ffe93b440f0ada662d16d
OWNER_ADDRESS=0x18781A2B6B843E0BBe4F491B28139abb6942d785
DLP_PUBLIC_KEY=04920ff366433d60fcebfa9d072d860e6fd7a482e4c055621ef986025076c9fb6418c15712a22bff61a3add75b645345c7c338f19a8ab0d1a3ac6be1be331eac45
```

You can leave other fields (e.g., `DLP_PROOF_INSTRUCTION`, `DLP_FILE_REWARD_FACTOR`) as defaults for testing.

**Deploy to Moksha Testnet:**

The repository contains many smart contracts used across the Vana ecosystem. The `DLPDeploy` tag deploys only the contracts required to launch your DataDAO:

```bash
npx hardhat deploy --network moksha --tags DLPDeploy
```

After deployment, **save these critical addresses** from the output logs:
- `Token Address` - Your VRC-20 token contract
- `DataLiquidityPoolProxy` - Your main DLP contract
- `Vesting Wallet Address` - Team token vesting contract

You may see error logs related to contract verification. **You can safely ignore those messages** - all contracts will be verified onchain.

**View Your Contracts on Vanascan:**

Visit [moksha.vanascan.io](https://moksha.vanascan.io) and search for each contract address:
- Your **token contract** shows metadata, total supply, and recent token transfers
- Your **DataLiquidityPoolProxy** contract has methods viewable in the **Contract** tab
- Your **VestingWallet** contains the vesting schedule and logic for team token allocation

### 2. Register DataDAO

Now that you've deployed your smart contracts, register your DataDAO onchain in the global DLP registry. For the complete registration guide, see [Register DataDAO](https://docs.vana.org/docs/2-register-datadao).

**Register via DLPRegistryProxy:**

1. Navigate to the [registerDlp](https://moksha.vanascan.io/address/0x4D59880a924526d1dD33260552Ff4328b1E18a43?tab=read_write_proxy&source_address=0x752301d732e3Ef8fbFCAa700e25C3Fa1a6D1629e#0x9d4def70) method in DLPRegistryProxy on Vanascan
2. Fill in the `registrationInfo` fields:
    - `dlpAddress`: The `DataLiquidityPoolProxy` address you saved from deployment
    - `ownerAddress`: Your wallet address
    - `treasuryAddress`: A separate wallet for DLP treasury (can be same as `ownerAddress` for testing)
    - `name`: The `DLP_NAME` you chose (e.g., "QuickstartDAO") - **must be unique**
    - `iconUrl`: Optional logo URL (e.g., `https://example.com/icon.png`)
    - `website`: Optional project link (e.g., `https://example.com`)
    - `metadata`: Optional JSON (e.g., `{"description": "Test DLP"}`)

3. Fill in `Send native VANA (uint256)`:
    - Click the `×10^18` button to set 1 VANA (in wei) - **required deposit**

4. Connect your wallet (`OWNER_ADDRESS`) to Vanascan and submit the transaction

5. **Retrieve your `dlpId`:**
    - Go to the [dlpIds](https://moksha.vanascan.io/address/0x4D59880a924526d1dD33260552Ff4328b1E18a43?tab=read_write_proxy&source_address=0x752301d732e3Ef8fbFCAa700e25C3Fa1a6D1629e#0xc06020b0) method in the DLPRegistryProxy contract
    - Use your `dlpAddress` to query your dlpId from the blockchain

🚧 **Tip:** You can update your registration info later using the `updateDlp` function. All metadata is editable.

## System Architecture

### What is a DataDAO?

DataDAOs are collectively governed datasets that aggregate and verify individual user data, transforming it from isolated information into valuable, liquid assets. They address fundamental challenges in the data economy:

**The Aggregation Challenge:** Individual user data isn't useful on its own - it must be pooled to be valuable for AI training and other applications. While centralized platforms can aggregate user data, DataDAOs enable users to export their data and pool it collectively while maintaining ownership through cryptographic mechanisms.

**Core Problems Solved:**
- **Sybil Resistance**: Proof-of-contribution prevents users from creating fake identities to manipulate datasets
- **Data Valuation**: Dataset-specific validation logic verifies authenticity and assigns value scores to map heterogeneous data contributions to standardized tokens

### Core Components

**Data Liquidity Pool (DLP)** - Smart contracts containing:
- Proof-of-contribution validators that verify data authenticity and assign value scores
- Refinement structures that process raw data into queryable formats
- Access control contracts that enforce data token-gated permissions

**VRC-20 Token Economics** - Dataset-specific tokens earned for validated contributions and burned for access, with ERC-20 compatibility enabling programmable economic logic

**Governance Layer** - Token-weighted decisions on validation criteria, economic parameters, and access policies

### Technical Flow

1. **Data Contribution**: User contributes data → DLP validates and refines → user earns VRC-20 tokens
2. **Data Access**: AI builder burns VANA + VRC-20 tokens → access granted to TEE environment
3. **Secure Computation**: TEE runtime enforces DataDAO permissions during computation (only approved code runs)
4. **Value Distribution**: Value flows to token holders based on ownership stake and actual data usage

### Key Properties

- **Programmable Validation**: Executable proof-of-contribution scripts ensure data quality
- **Cryptographic Attribution**: Tokens are cryptographically linked to wallet contributions
- **Granular Access Control**: TEE-level enforcement of DataDAO-defined permissions
- **Democratic Governance**: Token-weighted governance proportional to contribution volume

## Contract Templates

### dat/ - DAT Token Implementation

Contains the VRC-20 compliant token contract that represents ownership and governance rights within a DataDAO:

**Core Features:**
- **ERC-20 Compatibility**: Standard token functionality with additional governance features
- **Governance Rights**: ERC20Votes integration for on-chain voting capabilities
- **Permit Support**: ERC20Permit for gasless approvals and improved UX
- **Minting Control**: Customizable minting permissions and supply management
- **Access Controls**: Admin roles and address blocking capabilities

**Token Economics:**
- Earned by data contributors for validated submissions
- Burned by data consumers for access rights
- Used for governance voting on DataDAO parameters
- Represents proportional ownership in the dataset's value

**Customization Options:**
- Token name, symbol, and initial supply
- Minting rules and supply caps
- Vesting schedules for team allocations
- Transfer fees and trading restrictions

### dlp/ - Data Liquidity Pool Implementation

Contains the core DLP contract that manages data validation, contributor rewards, and access control:

**Validator Management:**
- **Registration System**: Secure validator onboarding with staking requirements
- **Approval Process**: DataDAO owner controls which validators can participate
- **Performance Tracking**: Nagoya consensus mechanism for validator scoring
- **Reward Distribution**: Automated reward allocation based on validation quality

**Data Processing Pipeline:**
- **Proof-of-Contribution**: Customizable validation logic for different data types
- **Quality Scoring**: Algorithmic assessment of data value and authenticity
- **Refinement Processing**: Transformation of raw data into structured, queryable formats
- **Access Control**: Token-gated permissions for data consumption

**Economic Mechanisms:**
- **Contributor Rewards**: Flexible reward structures based on data quality and usage
- **Validator Incentives**: Performance-based compensation for validation services
- **Fee Management**: Configurable fees for data access and validation services
- **Treasury Operations**: Automated fund management and distribution

**Governance Integration:**
- **Parameter Control**: Community governance over validation criteria and rewards
- **Upgrade Mechanisms**: Safe contract upgrades with proper governance oversight
- **Emergency Controls**: Pause functionality for security incidents
- **Transparency Tools**: Comprehensive event logging and reporting

## Integration Requirements

### VRC Compliance

All DataDAOs must comply with Vana Request for Comments (VRC) standards:

**VRC-14 (Rewards Model):**
- Performance tracking and reward distribution mechanisms
- Integration with Vana's epoch-based reward system
- Compliance with performance metrics for reward eligibility

**VRC-15 (Data Access):**
- Encrypted data storage with secure access controls
- TEE-compatible data refinement and processing
- Verified query permissions and access logging

**VRC-20 (Token Standards):**
- ERC-20 compatibility with governance extensions
- Supply caps, vesting requirements, and transfer restrictions
- 48-hour timelocks for major contract changes

### Core Contract Integration

**DataRegistry Integration:**
- File registration and metadata management
- Proof storage and attestation handling
- Cross-reference with validator assessments

**TEE Pool Integration:**
- Secure data validation through trusted execution environments
- Privacy-preserving computation and analysis
- Cryptographic proof generation and verification

**Root Network Integration:**
- DataDAO registration and reward eligibility
- Performance metrics submission and tracking
- Reward distribution and treasury management

## Economic Model

### Revenue Streams

**Data Access Fees:**
- Primary revenue from AI companies and researchers
- Tiered pricing based on data quality and exclusivity
- Subscription models for ongoing data access

**Token Appreciation:**
- Market-driven token value based on dataset utility
- Deflationary mechanisms through token burning
- Liquidity provision rewards and trading fees

### Reward Distribution

**Contributors:**
- Proportional rewards based on data quality scores
- Governance tokens for ecosystem participation
- Long-term value appreciation through token holdings

**Validators:**
- Performance-based compensation through Nagoya consensus
- Staking rewards for maintaining network security
- Fee sharing from successful data validations

**DataDAO Treasury:**
- Operational funding for continued development
- Marketing and user acquisition budgets
- Reserve funds for ecosystem stability

## Security Considerations

### Smart Contract Security

**Access Controls:**
- Role-based permissions for critical functions
- Multi-signature requirements for treasury operations
- Time-locked upgrades for major changes

**Economic Security:**
- Slashing conditions for malicious validators
- Sybil resistance through proof-of-contribution
- Market manipulation protections

### Data Security

**Privacy Protection:**
- End-to-end encryption for sensitive data
- TEE-based computation without data exposure
- User-controlled access permissions

**Validation Security:**
- Cryptographic proofs for data authenticity
- Consensus mechanisms for validator agreement
- Audit trails for all data operations

## Governance Framework

### Decision-Making Process

**Proposal Submission:**
- Token holders can propose parameter changes
- Minimum token threshold for proposal creation
- Community discussion and feedback periods

**Voting Mechanisms:**
- Token-weighted voting on governance proposals
- Quorum requirements for proposal validity
- Time-locked implementation of approved changes

**Parameter Governance:**
- Validation criteria and quality thresholds
- Reward distribution percentages and mechanisms
- Access fees and pricing structures

### Community Management

**Stakeholder Coordination:**
- Regular community calls and updates
- Transparent reporting on DataDAO performance
- Conflict resolution mechanisms

**Ecosystem Alignment:**
- Coordination with other DataDAOs
- Integration with Vana ecosystem developments
- Compliance with evolving VRC standards

## Future Enhancements

### Planned Features

**Advanced Validation:**
- AI-powered data quality assessment
- Cross-DataDAO validation and verification
- Automated anomaly detection and reporting

**Enhanced Economics:**
- Dynamic pricing based on market demand
- Yield farming and liquidity mining programs
- Cross-chain token bridges and integrations

**Governance Evolution:**
- Delegation mechanisms for token holders
- Specialized working groups for technical decisions
- Integration with broader Vana DAO governance

### Ecosystem Integration

**DeFi Integration:**
- Use of DataDAO tokens as collateral
- Yield-bearing strategies for idle tokens
- Integration with lending and borrowing protocols

**AI Marketplace:**
- Direct integration with AI training platforms
- Automated licensing and usage tracking
- Revenue sharing with AI model creators

---

For detailed technical documentation, deployment guides, and community support, refer to the [Vana Developer Documentation](https://docs.vana.org) or join the [Vana Builders Discord](https://discord.gg/vana) for assistance with DataDAO creation and management.