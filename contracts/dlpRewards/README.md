# DLP Rewards Contracts

This folder contains the comprehensive smart contract ecosystem for managing and distributing rewards across Data Liquidity Pools (DLPs) and DataDAOs within the Vana network. These contracts implement a sophisticated, performance-based reward system that incentivizes data quality, market liquidity, and ecosystem growth through automated token distribution mechanisms.

## Overview

The DLP Rewards system operates on a quarterly epoch-based model where rewards are allocated based on measurable performance metrics rather than staking requirements. The architecture has been designed to create a sustainable, market-driven approach to data monetization that aligns rewards with real utility and fosters long-term growth of the DataFi ecosystem.

## System Architecture

### Core Components

The reward system is built around several specialized contracts that work together to ensure fair, transparent, and efficient reward distribution:

**Performance Tracking & Metrics**
- Real-time monitoring of DataDAO performance across multiple dimensions
- Automated calculation of reward eligibility and distribution amounts
- Integration with market data and trading volume analytics


**Token Exchange & Liquidity**
- Seamless conversion between VANA and DataDAO tokens
- Automated liquidity provision to DEX pools
- Slippage protection and market stability measures

## Contract Components

### dlpPerformance
**Real-Time Performance Tracking**

Monitors and calculates the key performance metrics that determine reward eligibility and distribution amounts:

- **Data Access Fees (50% weight)**: Tracks revenue generated from data queries and access requests
- **Unique Data Contributors (20% weight)**: Counts distinct wallets contributing verified data to each DataDAO
- **Token Trading Volume (30% weight)**: Measures VANA/DataDAO token pair trading activity
- **Performance Scoring**: Aggregates metrics into comprehensive performance ratings
- **Eligibility Validation**: Ensures DataDAOs meet compliance requirements

### dlpRegistry
**DataDAO Registration and Management**

Maintains the authoritative registry of all DataDAOs participating in the reward system:

- **Registration Process**: Handles new DataDAO onboarding and verification
- **Metadata Management**: Stores DataDAO information, token contracts, and configuration
- **Compliance Tracking**: Monitors adherence to VRC-14, VRC-15, and VRC-20 standards
- **Status Management**: Tracks active, inactive, and suspended DataDAOs
- **Integration Points**: Provides interfaces for other reward system components

### dlpRewardDeployer
**Automated Reward Distribution**

Orchestrates the daily deployment of rewards through sophisticated market mechanisms:

- **Daily Buy-ins**: Executes automated VANA token purchases of DataDAO tokens
- **Liquidity Provision**: Adds purchased tokens to DEX pools to enhance market depth
- **Slippage Protection**: Pauses transactions if slippage would exceed 2% threshold
- **Rollover Mechanisms**: Handles failed deployments and reward redistribution
- **Market Stability**: Implements gradual deployment over 3-month periods

### dlpRewardsSwap
**Token Exchange Infrastructure**

Facilitates seamless token conversions and market operations:

- **VANA/DataDAO Swaps**: Handles automated token exchanges for reward distribution
- **Price Discovery**: Integrates with DEX protocols for real-time pricing
- **Transaction Optimization**: Minimizes gas costs and maximizes exchange efficiency
- **Market Impact Mitigation**: Spreads large transactions to reduce price volatility
- **Error Handling**: Robust fallback mechanisms for failed swap operations

### swapHelper
**Exchange Utility Functions**

Provides supporting functionality for token swap operations:

- **Route Optimization**: Finds optimal trading paths across different DEX protocols
- **Gas Estimation**: Calculates transaction costs for swap operations
- **Batch Processing**: Handles multiple swaps efficiently in single transactions
- **Integration Support**: Standardized interfaces for external protocol integration
- **Monitoring Tools**: Real-time tracking of swap performance and success rates

### testHelper
**Development and Testing Support**

Specialized utilities for testing and development environments:

- **Mock Contracts**: Simulated versions of external dependencies
- **Test Scenarios**: Pre-configured test cases for various reward conditions
- **Performance Simulation**: Tools for modeling different performance scenarios
- **Integration Testing**: Comprehensive test suites for multi-contract interactions
- **Debug Utilities**: Enhanced logging and monitoring for development

### treasury
**Reward Pool Management**

Manages the central treasury that funds the entire reward ecosystem:

- **Pool Allocation**: Distributes rewards based on TDVL (Total Data Value Locked) metrics
- **Dynamic Scaling**: Adjusts reward pools from 0.5% base to 5% maximum of VANA supply
- **Epoch Management**: Handles quarterly reward cycles and distribution scheduling
- **Compliance Enforcement**: Ensures all distributions meet regulatory and protocol requirements
- **Reserve Management**: Maintains emergency reserves and handles unclaimed rewards

### vanaEpoch
**Epoch Cycle Management**

Coordinates the timing and lifecycle of reward distribution periods:

- **Epoch Scheduling**: Manages 3-month reward cycles with precise timing
- **Transition Logic**: Handles seamless transitions between reward periods
- **Performance Aggregation**: Consolidates metrics across entire epoch periods
- **Final Distributions**: Executes end-of-epoch reward calculations and payments
- **Historical Tracking**: Maintains comprehensive records of past epochs

## Reward Distribution Model

### Performance Metrics

The system evaluates DataDAOs across three key dimensions:

1. **Data Access Fees (50%)** - Measures real-world utility through actual data usage and revenue generation
2. **Unique Data Contributors (20%)** - Encourages diverse, high-quality data contributions from distinct sources
3. **Token Trading Volume (30%)** - Reflects market confidence and liquidity health of DataDAO tokens

### Reward Pool Dynamics

- **Base Pool**: 0.5% of total VANA supply allocated quarterly
- **Growth Mechanism**: +0.5% increase for every $500M in Total Data Value Locked (TDVL)
- **Maximum Cap**: 5% of VANA supply annually to ensure sustainable tokenomics
- **No Eligibility Limits**: Any DataDAO meeting standards can qualify (removed Top 16 constraint)

### Distribution Process

1. **Daily Deployment**: Rewards are distributed daily rather than in large batches
2. **Market Integration**: VANA tokens are used to buy DataDAO tokens and add DEX liquidity
3. **Slippage Protection**: Automatic pausing if market impact would exceed 2%
4. **Gradual Release**: 3-month deployment periods prevent market manipulation
5. **Compliance Checks**: Continuous monitoring ensures VRC standard adherence

## Key Features

### Performance-Based Allocation
- Eliminates previous staking requirements in favor of utility-driven metrics
- Rewards align with actual data usage and market activity
- Encourages sustainable business models for DataDAOs

### Market-Driven Liquidity
- Automatic liquidity provision enhances token tradability
- Slippage protection maintains price stability
- Gradual deployment prevents market manipulation

### Compliance & Standards
- Full integration with VRC-14 (Rewards Model), VRC-15 (Data Access), and VRC-20 (Token Standards)
- Automated compliance checking and enforcement
- Transparent eligibility requirements and processes

### Scalability & Efficiency
- Modular architecture supports future enhancements
- Gas-optimized operations minimize transaction costs
- Automated processes reduce manual intervention requirements

## Integration Requirements

### VRC Compliance

All participating DataDAOs must meet the following standards:

- **VRC-14**: Reward model compliance including performance tracking and token distribution
- **VRC-15**: Data access architecture with encrypted storage and verified permissions
- **VRC-20**: Token standards including supply caps, vesting, and transfer fees

### Liquidity Requirements

- **Initial Liquidity**: Minimum $10K-$50K in VANA/DataDAO trading pairs
- **Slippage Monitoring**: Maintain below 2% for reward deployment eligibility
- **Market Depth**: Scale liquidity as trading volume increases

### Technical Integration

- **Smart Contract Integration**: Proper interfaces with Data Registry and core contracts
- **Oracle Connectivity**: Real-time data feeds for performance metrics
- **DEX Protocol Support**: Compatible with major decentralized exchanges

## Deployment Information

These contracts are part of the Vana core infrastructure and are pre-deployed on both Moksha testnet and Vana mainnet. DataDAO builders should integrate with existing deployments rather than deploying their own versions.

**Network Addresses:**
- **Moksha Testnet**: Use for development and testing
- **Vana Mainnet**: Production environment for live DataDAOs

## Security Considerations

- All contracts follow OpenZeppelin security standards
- Multi-signature requirements for critical operations
- Time-locked upgrades for major system changes
- Comprehensive audit coverage for all reward mechanisms
- Emergency pause functionality for critical security events

## Future Enhancements

The modular architecture supports planned enhancements including:

- **Dynamic APY Adjustments**: Based on data access fees and query volume
- **Cross-Chain Rewards**: Support for multi-chain DataDAO operations
- **Advanced Analytics**: Enhanced performance tracking and prediction models
- **Governance Integration**: Community-driven parameter adjustments

---

For detailed integration guides and technical documentation, refer to the [Vana Developer Documentation](https://docs.vana.org) or explore individual contract interfaces within this repository.