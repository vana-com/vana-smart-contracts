// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAttestationPolicy
 * @notice Interface for the AttestationPolicy contract
 * @dev Defines which TEEs and images are trusted by the protocol
 */
interface IAttestationPolicy {
    /**
     * @notice Structure holding attestation policies
     * @param trustedTeePools List of TeePool contract addresses
     * @param trustedVanaRuntimeOCIImages List of trusted Vana Runtime OCI Image versions
     */
    struct Policies {
        address[] trustedTeePools;
        string[] trustedVanaRuntimeOCIImages;
    }

    /**
     * @notice Emitted when a TEE pool is added to the trusted list
     * @param teePool The address of the trusted TEE pool
     */
    event TeePoolTrusted(address indexed teePool);

    /**
     * @notice Emitted when a TEE pool is removed from the trusted list
     * @param teePool The address of the untrusted TEE pool
     */
    event TeePoolUntrusted(address indexed teePool);

    /**
     * @notice Emitted when a Vana Runtime OCI image is added to the trusted list
     * @param imageVersion The OCI image version string
     */
    event VanaRuntimeImageTrusted(string imageVersion);

    /**
     * @notice Emitted when a Vana Runtime OCI image is removed from the trusted list
     * @param imageVersion The OCI image version string
     */
    event VanaRuntimeImageUntrusted(string imageVersion);

    /**
     * @notice Add a TEE pool to the trusted list
     * @param teePool The address of the TEE pool to trust
     */
    function trustTeePool(address teePool) external;

    /**
     * @notice Remove a TEE pool from the trusted list
     * @param teePool The address of the TEE pool to untrust
     */
    function untrustTeePool(address teePool) external;

    /**
     * @notice Add a Vana Runtime OCI image to the trusted list
     * @param imageVersion The OCI image version to trust
     */
    function trustVanaRuntimeImage(string memory imageVersion) external;

    /**
     * @notice Remove a Vana Runtime OCI image from the trusted list
     * @param imageVersion The OCI image version to untrust
     */
    function untrustVanaRuntimeImage(string memory imageVersion) external;

    /**
     * @notice Check if a TEE pool is trusted
     * @param teePool The address to check
     * @return isTrusted True if the TEE pool is trusted
     */
    function isTeePoolTrusted(
        address teePool
    ) external view returns (bool isTrusted);

    /**
     * @notice Check if a Vana Runtime OCI image is trusted
     * @param imageVersion The image version to check
     * @return isTrusted True if the image is trusted
     */
    function isVanaRuntimeImageTrusted(
        string memory imageVersion
    ) external view returns (bool isTrusted);

    /**
     * @notice Get all trusted TEE pools
     * @return teePools Array of trusted TEE pool addresses
     */
    function getTrustedTeePools()
        external
        view
        returns (address[] memory teePools);

    /**
     * @notice Get all trusted Vana Runtime OCI images
     * @return images Array of trusted image version strings
     */
    function getTrustedVanaRuntimeImages()
        external
        view
        returns (string[] memory images);

    /**
     * @notice Get the complete attestation policies
     * @return policies The policies structure
     */
    function getPolicies() external view returns (Policies memory policies);
}
