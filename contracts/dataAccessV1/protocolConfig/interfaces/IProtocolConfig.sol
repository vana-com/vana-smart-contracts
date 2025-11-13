// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IProtocolConfig
 * @notice Interface for the ProtocolConfig contract
 * @dev Serves as the canonical source for all protocol-level parameters
 */
interface IProtocolConfig {
    /**
     * @notice Structure holding protocol configuration
     * @param pgePublicKey Public key for PGE escrow
     * @param attestationPolicy Address of the AttestationPolicy contract
     * @param pgeRecoveryCommitteeAddresses Addresses for all PGE backup committee members
     */
    struct Config {
        bytes pgePublicKey;
        address attestationPolicy;
        address[] pgeRecoveryCommitteeAddresses;
    }

    /**
     * @notice Emitted when the PGE public key is updated
     * @param newPublicKey The new PGE public key
     */
    event PGEPublicKeyUpdated(bytes newPublicKey);

    /**
     * @notice Emitted when the attestation policy address is updated
     * @param newAttestationPolicy The new attestation policy address
     */
    event AttestationPolicyUpdated(address indexed newAttestationPolicy);

    /**
     * @notice Emitted when PGE recovery committee addresses are updated
     * @param newAddresses The new array of committee addresses
     */
    event PGERecoveryCommitteeUpdated(address[] newAddresses);

    /**
     * @notice Returns the public key used to encrypt runtime private keys for PGE escrow
     * @return publicKey The PGE public key
     */
    function getPGEPublicKey() external view returns (bytes memory publicKey);

    /**
     * @notice Returns the address of the current AttestationPolicy contract
     * @return policyAddress The attestation policy contract address
     */
    function getAttestationPolicy()
        external
        view
        returns (address policyAddress);

    /**
     * @notice Returns addresses for all PGE backup committee members
     * @return addresses Array of committee member addresses
     */
    function getPGERecoveryCommitteeAddresses()
        external
        view
        returns (address[] memory addresses);

    /**
     * @notice Updates the PGE public key
     * @param newPublicKey The new public key to set
     */
    function updatePGEPublicKey(bytes memory newPublicKey) external;

    /**
     * @notice Updates the attestation policy address
     * @param newAttestationPolicy The new attestation policy address
     */
    function updateAttestationPolicy(address newAttestationPolicy) external;

    /**
     * @notice Updates the PGE recovery committee addresses
     * @param newAddresses The new array of committee addresses
     */
    function updatePGERecoveryCommittee(address[] memory newAddresses) external;

    /**
     * @notice Get the complete protocol configuration
     * @return config The protocol configuration structure
     */
    function getConfig() external view returns (Config memory config);
}
