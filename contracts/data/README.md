# Data Contracts

This folder contains the core smart contracts for data management, validation, and access control within the Vana network. These contracts work together to provide a comprehensive data infrastructure that enables secure, private, and transparent data operations.

## Overview

The data contracts form the backbone of Vana's data ecosystem, providing essential services for data registration, validation, refinement, job execution, and access control. All contracts are deployed as part of the Vana core infrastructure and integrate seamlessly with Data Liquidity Pools (DLPs).

## Contract Components

### Data Registry
**Main Entry Point for Data in the Vana Network**

The Data Registry contract serves as the central repository for managing all data within the network, functioning as a comprehensive file catalog. Key features include:

- **File Management**: Add new files to the system with unique identifiers for future reference
- **Access Control**: Manage permissions, allowing file owners to grant specific addresses access to their files
- **Metadata Storage**: Store file metadata, including off-chain proofs and attestations related to file validation
- **Quality Metrics**: Handle various metrics such as authenticity, ownership, and quality scores
- **Content ID Storage**: Store encrypted, normalized, and queryable content IDs (CIDs) for individual files to enable later retrieval and re-indexing by the Query Engine

**Deployed Addresses:**
- Moksha: `0xEA882bb75C54DE9A08bC46b46c396727B4BFe9a5`
- Vana Mainnet: `0xEA882bb75C54DE9A08bC46b46c396727B4BFe9a5`

### TEE Pool
**Trusted Execution Environment Orchestration**

The TEE Pool manages Trusted Execution Environments (TEEs) in the Satya Network, specializing in the validation of data contributions to DataDAOs through their Proof of Contribution mechanism. Features include:

- **Privacy-Preserving Validation**: Validators operate within TEEs, ensuring data can be validated securely and privately
- **Validator Management**: Add, remove, and coordinate TEE validators
- **Fee Escrow**: Hold and disburse fees associated with validation tasks
- **Proof Generation**: Process data and provide cryptographic proof of validation
- **Secure Processing**: Shield data from both validators and external parties during processing

**Deployed Addresses:**
- Moksha: `0xF084Ca24B4E29Aa843898e0B12c465fAFD089965`
- Vana Mainnet: `0xF084Ca24B4E29Aa843898e0B12c465fAFD089965`

### Job Registry *(New)*
**Compute Engine Job Management**

The Job Registry contract manages Compute Engine job executions, providing:

- **Job Definition**: Define pre-configured jobs that can be run through the Compute Engine (such as basic data query jobs)
- **Job Submission**: Submit new jobs for application builders with pre-deposited payment amounts in $VANA
- **Payment Processing**: Consume deposited $VANA tokens as job runs are successfully completed
- **Job Management**: Cancel jobs or retrieve the status of existing jobs
- **Execution Tracking**: Monitor job progress and completion status

### Query Engine *(New)*
**Data Access Gateway with Pricing Transparency**

The Query Engine contract serves as the primary gateway for permissioning data access with transparent pricing:

- **Permission Requests**: DataDAOs submit and approve new general permission requests on behalf of application builders
- **Pricing Management**: Provide generalized pricing for all potential data consumers
- **Access Control**: Approve, reject, revoke, or check permission requests
- **Transparency**: Ensure clear pricing models for data access
- **Consumer Management**: Handle relationships between DataDAOs and data consumers

### Data Refiner Registry *(New)*
**Data Refinement Infrastructure**

The Data Refiner Registry contract maintains the comprehensive list of all known data refiner types and instructions used in the data refinement process during a DataDAO's Proof-of-Contribution (PoC) step:

- **Schema Management**: Store references to off-chain schema definitions that clearly denote the normalized structure of refined data
- **Refinement Instructions**: Maintain off-chain refinement instructions in the form of container URLs used for data refinement
- **Ownership Information**: Track on-chain owner information, including the relevant DataDAO
- **Type Registry**: Catalog all available data refiner types
- **Integration Support**: Enable seamless integration with DataDAO PoC workflows

## Integration

These contracts are part of the Vana core smart contracts and are **automatically deployed** - DataDAO builders do not need to deploy them manually. For development and testing:

- **Testing Environment**: Use the addresses deployed on Moksha testnet
- **Production Environment**: Use the addresses deployed on Vana mainnet
- **DLP Integration**: Ensure your Data Liquidity Pool contracts integrate with DataRegistry and RootNetwork for ecosystem compatibility

## Key Features

### Security & Privacy
- TEE-based validation ensures data privacy during processing
- Access control mechanisms protect data integrity
- Cryptographic proofs validate data authenticity

### Transparency
- Clear pricing models for data access
- Transparent job execution tracking
- Public registry of data refinement capabilities

### Scalability
- Efficient job queue management
- Optimized data storage and retrieval
- Streamlined permission management

### Interoperability
- Standard interfaces for DataDAO integration
- Compatible with existing Vana ecosystem tools
- Support for various data refinement types

## Usage Notes

- All contracts follow OpenZeppelin standards for security and upgradeability
- Gas optimization has been implemented across all contract interactions
- Events are emitted for all major state changes to support off-chain monitoring
- Role-based access control ensures proper permission management

## Network Information

**Moksha Testnet (Testing)**
- RPC URL: `https://rpc.moksha.vana.org`
- Explorer: `https://moksha.vanascan.io`

**Vana Mainnet (Production)**
- RPC URL: `https://rpc.vana.org`
- Explorer: `https://vanascan.io`

---

For more information about integrating with these contracts, refer to the [Vana Documentation](https://docs.vana.org) or explore the contract interfaces in the respective contract files.