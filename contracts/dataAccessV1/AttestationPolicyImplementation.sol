// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "./interfaces/IAttestationPolicy.sol";

/**
 * @title AttestationPolicyImplementation
 * @notice Implementation of the AttestationPolicy contract
 * @dev Defines which TEEs and images are trusted by the protocol
 */
contract AttestationPolicyImplementation is
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    IAttestationPolicy
{
    /// @notice Role for security council operations
    bytes32 public constant SECURITY_COUNCIL_ROLE =
        keccak256("SECURITY_COUNCIL_ROLE");

    /// @notice Array of trusted TEE pool addresses
    address[] private _trustedTeePools;

    /// @notice Array of trusted Vana Runtime OCI image versions
    string[] private _trustedVanaRuntimeImages;

    /// @notice Mapping to quickly check if a TEE pool is trusted
    mapping(address => bool) private _isTeePoolTrusted;

    /// @notice Mapping to quickly check if an image version is trusted
    mapping(bytes32 => bool) private _isImageTrusted;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param admin Address to be granted admin role
     * @param securityCouncil Address to be granted security council role
     */
    function initialize(
        address admin,
        address securityCouncil
    ) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SECURITY_COUNCIL_ROLE, securityCouncil);
    }

    /**
     * @notice Add a TEE pool to the trusted list
     * @param teePool The address of the TEE pool to trust
     */
    function trustTeePool(
        address teePool
    ) external override onlyRole(SECURITY_COUNCIL_ROLE) {
        require(teePool != address(0), "Invalid TEE pool address");
        require(!_isTeePoolTrusted[teePool], "TEE pool already trusted");

        _isTeePoolTrusted[teePool] = true;
        _trustedTeePools.push(teePool);

        emit TeePoolTrusted(teePool);
    }

    /**
     * @notice Remove a TEE pool from the trusted list
     * @param teePool The address of the TEE pool to untrust
     */
    function untrustTeePool(
        address teePool
    ) external override onlyRole(SECURITY_COUNCIL_ROLE) {
        require(_isTeePoolTrusted[teePool], "TEE pool not trusted");

        _isTeePoolTrusted[teePool] = false;

        // Remove from array
        for (uint256 i = 0; i < _trustedTeePools.length; i++) {
            if (_trustedTeePools[i] == teePool) {
                _trustedTeePools[i] = _trustedTeePools[
                    _trustedTeePools.length - 1
                ];
                _trustedTeePools.pop();
                break;
            }
        }

        emit TeePoolUntrusted(teePool);
    }

    /**
     * @notice Add a Vana Runtime OCI image to the trusted list
     * @param imageVersion The OCI image version to trust
     */
    function trustVanaRuntimeImage(
        string memory imageVersion
    ) external override onlyRole(SECURITY_COUNCIL_ROLE) {
        require(bytes(imageVersion).length > 0, "Invalid image version");

        bytes32 imageHash = keccak256(bytes(imageVersion));
        require(!_isImageTrusted[imageHash], "Image already trusted");

        _isImageTrusted[imageHash] = true;
        _trustedVanaRuntimeImages.push(imageVersion);

        emit VanaRuntimeImageTrusted(imageVersion);
    }

    /**
     * @notice Remove a Vana Runtime OCI image from the trusted list
     * @param imageVersion The OCI image version to untrust
     */
    function untrustVanaRuntimeImage(
        string memory imageVersion
    ) external override onlyRole(SECURITY_COUNCIL_ROLE) {
        bytes32 imageHash = keccak256(bytes(imageVersion));
        require(_isImageTrusted[imageHash], "Image not trusted");

        _isImageTrusted[imageHash] = false;

        // Remove from array
        for (uint256 i = 0; i < _trustedVanaRuntimeImages.length; i++) {
            if (
                keccak256(bytes(_trustedVanaRuntimeImages[i])) == imageHash
            ) {
                _trustedVanaRuntimeImages[i] = _trustedVanaRuntimeImages[
                    _trustedVanaRuntimeImages.length - 1
                ];
                _trustedVanaRuntimeImages.pop();
                break;
            }
        }

        emit VanaRuntimeImageUntrusted(imageVersion);
    }

    /**
     * @notice Check if a TEE pool is trusted
     * @param teePool The address to check
     * @return isTrusted True if the TEE pool is trusted
     */
    function isTeePoolTrusted(
        address teePool
    ) external view override returns (bool) {
        return _isTeePoolTrusted[teePool];
    }

    /**
     * @notice Check if a Vana Runtime OCI image is trusted
     * @param imageVersion The image version to check
     * @return isTrusted True if the image is trusted
     */
    function isVanaRuntimeImageTrusted(
        string memory imageVersion
    ) external view override returns (bool) {
        bytes32 imageHash = keccak256(bytes(imageVersion));
        return _isImageTrusted[imageHash];
    }

    /**
     * @notice Get all trusted TEE pools
     * @return teePools Array of trusted TEE pool addresses
     */
    function getTrustedTeePools()
        external
        view
        override
        returns (address[] memory)
    {
        return _trustedTeePools;
    }

    /**
     * @notice Get all trusted Vana Runtime OCI images
     * @return images Array of trusted image version strings
     */
    function getTrustedVanaRuntimeImages()
        external
        view
        override
        returns (string[] memory)
    {
        return _trustedVanaRuntimeImages;
    }

    /**
     * @notice Get the complete attestation policies
     * @return policies The policies structure
     */
    function getPolicies()
        external
        view
        override
        returns (Policies memory policies)
    {
        return
            Policies({
                trustedTeePools: _trustedTeePools,
                trustedVanaRuntimeOCIImages: _trustedVanaRuntimeImages
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
