// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "./interfaces/IProtocolConfig.sol";

/**
 * @title ProtocolConfigImplementation
 * @notice Implementation of the ProtocolConfig contract
 * @dev Serves as the canonical source for all protocol-level parameters
 */
contract ProtocolConfigImplementation is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    IProtocolConfig
{
    /// @notice Role for protocol governance operations
    bytes32 public constant PROTOCOL_GOVERNANCE_ROLE =
        keccak256("PROTOCOL_GOVERNANCE_ROLE");

    /// @notice PGE public key for runtime escrow
    bytes private _pgePublicKey;

    /// @notice Address of the attestation policy contract
    address private _attestationPolicy;

    /// @notice Array of PGE recovery committee member addresses
    address[] private _pgeRecoveryCommitteeAddresses;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param admin Address to be granted admin role
     * @param initialPGEPublicKey Initial PGE public key
     * @param initialAttestationPolicy Initial attestation policy address (can be zero initially)
     * @param initialCommitteeAddresses Initial PGE recovery committee addresses
     */
    function initialize(
        address admin,
        bytes memory initialPGEPublicKey,
        address initialAttestationPolicy,
        address[] memory initialCommitteeAddresses
    ) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PROTOCOL_GOVERNANCE_ROLE, admin);

        require(initialPGEPublicKey.length > 0, "Invalid PGE public key");
        // Note: attestation policy can be zero initially and set later via updateAttestationPolicy

        _pgePublicKey = initialPGEPublicKey;
        _attestationPolicy = initialAttestationPolicy;
        _pgeRecoveryCommitteeAddresses = initialCommitteeAddresses;
    }

    /**
     * @notice Returns the public key used to encrypt runtime private keys for PGE escrow
     * @return publicKey The PGE public key
     */
    function getPGEPublicKey()
        external
        view
        override
        returns (bytes memory publicKey)
    {
        return _pgePublicKey;
    }

    /**
     * @notice Returns the address of the current AttestationPolicy contract
     * @return policyAddress The attestation policy contract address
     */
    function getAttestationPolicy()
        external
        view
        override
        returns (address policyAddress)
    {
        return _attestationPolicy;
    }

    /**
     * @notice Returns addresses for all PGE backup committee members
     * @return addresses Array of committee member addresses
     */
    function getPGERecoveryCommitteeAddresses()
        external
        view
        override
        returns (address[] memory addresses)
    {
        return _pgeRecoveryCommitteeAddresses;
    }

    /**
     * @notice Updates the PGE public key
     * @param newPublicKey The new public key to set
     */
    function updatePGEPublicKey(
        bytes memory newPublicKey
    ) external override onlyRole(PROTOCOL_GOVERNANCE_ROLE) {
        require(newPublicKey.length > 0, "Invalid public key");

        _pgePublicKey = newPublicKey;

        emit PGEPublicKeyUpdated(newPublicKey);
    }

    /**
     * @notice Updates the attestation policy address
     * @param newAttestationPolicy The new attestation policy address
     */
    function updateAttestationPolicy(
        address newAttestationPolicy
    ) external override onlyRole(PROTOCOL_GOVERNANCE_ROLE) {
        require(newAttestationPolicy != address(0), "Invalid address");

        _attestationPolicy = newAttestationPolicy;

        emit AttestationPolicyUpdated(newAttestationPolicy);
    }

    /**
     * @notice Updates the PGE recovery committee addresses
     * @param newAddresses The new array of committee addresses
     */
    function updatePGERecoveryCommittee(
        address[] memory newAddresses
    ) external override onlyRole(PROTOCOL_GOVERNANCE_ROLE) {
        require(newAddresses.length > 0, "Empty committee list");

        // Validate no zero addresses
        for (uint256 i = 0; i < newAddresses.length; i++) {
            require(newAddresses[i] != address(0), "Invalid committee address");
        }

        _pgeRecoveryCommitteeAddresses = newAddresses;

        emit PGERecoveryCommitteeUpdated(newAddresses);
    }

    /**
     * @notice Get the complete protocol configuration
     * @return config The protocol configuration structure
     */
    function getConfig()
        external
        view
        override
        returns (Config memory config)
    {
        return
            Config({
                pgePublicKey: _pgePublicKey,
                attestationPolicy: _attestationPolicy,
                pgeRecoveryCommitteeAddresses: _pgeRecoveryCommitteeAddresses
            });
    }

    /**
     * @dev Required override for UUPS upgrades
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     */
    uint256[50] private __gap;
}
