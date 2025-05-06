# Discussion: Immutable vs. Proxy Pattern for Vesting Contracts

## Overview
When designing the vesting mechanism, two primary deployment patterns were considered:

- **Immutable Contracts**: Each VestingWallet is a standalone contract with constructor parameters, making it immutable post-deployment.
- **Proxy-Based Contracts**: Deploying minimal proxy contracts (e.g., EIP-1167) that delegate calls to a shared implementation contract.

The goal was to select a pattern that ensures security, transparency, and aligns with best practices for token vesting.

## 🔍 Comparison

| Aspect | Immutable Contracts | Proxy-Based Contracts |
|--------|---------------------|------------------------|
| Security | ✅ High (immutable logic) | ⚠️ Relies on correct proxy setup |
| Transparency | ✅ Clear, fixed logic per contract | ⚠️ Indirect via implementation contract |
| Gas Efficiency | ⚠️ Higher deployment cost | ✅ Lower deployment cost |
| Etherscan Verification | ❌ Requires per-instance verification | ✅ Shared implementation is verified |
| Upgradability | ❌ Not upgradable | ✅ Upgradable via implementation contract |
| Complexity | ✅ Simple | ⚠️ More complex due to proxy mechanics |

## 🎯 Decision Rationale

- **Security & Trust**: Immutability ensures that once a vesting contract is deployed, its terms cannot be altered, aligning with stakeholders' expectations.
- **Transparency**: Each contract's logic and state are fixed, providing clarity and assurance to beneficiaries.
- **Simplicity**: The straightforward nature of immutable contracts reduces potential bugs and simplifies auditing.
- **Best Practices Alignment**: Industry standards recommend immutability for contracts where upgradeability is unnecessary, especially in financial applications like token vesting.

While proxy patterns offer benefits in terms of upgradeability and gas efficiency, the added complexity and potential security risks outweigh these advantages in the context of token vesting.

## 🛠️ Mitigating Verification Challenges

To address the verification overhead associated with immutable contracts:

1. **Automation**: Implement scripts to automate the verification process on block explorers.
2. **Event Emission**: Emit events during contract deployment to log constructor parameters, aiding in transparency and verification.
3. **Documentation**: Maintain comprehensive documentation detailing the deployment parameters and contract addresses.

## ✅ Conclusion

For the vesting mechanism, prioritizing security, transparency, and adherence to best practices led to adopting the immutable contracts pattern. This approach ensures that vesting terms are unchangeable post-deployment, fostering trust among stakeholders and aligning with the intended purpose of token vesting contracts.