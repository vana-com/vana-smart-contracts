// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./interfaces/DataRegistryStorageV1.sol";

contract DataRegistryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    MulticallUpgradeable,
    ERC2771ContextUpgradeable,
    DataRegistryStorageV1
{
    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    /**
     * @notice Triggered when a file has been added
     *
     * @param fileId                            id of the file
     * @param ownerAddress                      address of the owner
     * @param url                               url of the file
     */
    event FileAdded(uint256 indexed fileId, address indexed ownerAddress, string url);

    /**
     * @notice Triggered when user has added an proof to the file
     *
     * @param fileId                            id of the file
     * @param proofIndex                        index of the proof
     */
    event ProofAdded(uint256 indexed fileId, uint256 indexed proofIndex);

    /**
     * @notice Triggered when user has authorized an account to access the file
     *
     * @param fileId                            id of the file
     * @param account                        address of the account
     */
    event PermissionGranted(uint256 indexed fileId, address indexed account);

    error NotFileOwner();
    error FileUrlAlreadyUsed();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     *
     * @param ownerAddress                      address of the owner
     */
    function initialize(address trustedForwarderAddress, address ownerAddress) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _trustedForwarder = trustedForwarderAddress;

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    /**
     * @notice Upgrade the contract
     * This function is required by OpenZeppelin's UUPSUpgradeable
     *
     * @param newImplementation                  new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function _msgSender()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (address sender)
    {
        return ERC2771ContextUpgradeable._msgSender();
    }

    function _msgData() internal view override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return ERC2771ContextUpgradeable._msgData();
    }

    function _contextSuffixLength()
        internal
        view
        override(ContextUpgradeable, ERC2771ContextUpgradeable)
        returns (uint256)
    {
        return ERC2771ContextUpgradeable._contextSuffixLength();
    }

    /**
     * @dev Returns the address of the trusted forwarder.
     */
    function trustedForwarder() public view virtual override returns (address) {
        return _trustedForwarder;
    }

    /**
     * @notice Returns the version of the contract
     */
    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    /**
     * @notice Update the trusted forwarder
     *
     * @param trustedForwarderAddress                  address of the trusted forwarder
     */
    function updateTrustedForwarder(address trustedForwarderAddress) external onlyRole(MAINTAINER_ROLE) {
        _trustedForwarder = trustedForwarderAddress;
    }

    /**
     * @dev Pauses the contract
     */
    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    /**
     * @dev Unpauses the contract
     */
    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    /**
     * @notice Returns information about the file
     *
     * @param fileId                            id of the file
     * @return FileResponse                     information about the file
     */
    function files(uint256 fileId) external view returns (FileResponse memory) {
        File storage file = _files[fileId];

        return
            FileResponse({id: fileId, url: file.url, ownerAddress: file.ownerAddress, addedAtBlock: file.addedAtBlock});
    }

    /**
     * @notice Get fileId by URL
     * @param url The URL to look up
     * @return fileId The ID of the file (0 if not found)
     */
    function fileIdByUrl(string memory url) external view override returns (uint256) {
        return _urlHashToFileId[keccak256(abi.encodePacked(url))];
    }

    /**
     * @notice Returns the proof of the file
     *
     * @param fileId                            id of the file
     * @param index                             index of the proof
     * @return Proof                            proof of the file
     */
    function fileProofs(uint256 fileId, uint256 index) external view override returns (Proof memory) {
        return _files[fileId].proofs[index];
    }

    /**
     * @notice Returns permissions for the file
     *
     * @param fileId                            id of the file
     * @param account                        address of the account
     * @return string                           key for the account
     */
    function filePermissions(uint256 fileId, address account) external view override returns (string memory) {
        return _files[fileId].permissions[account];
    }

    /**
     * @notice Adds a file to the registry
     *
     * @param url                               url of the file
     * @return uint256                          id of the file
     */
    function addFile(string memory url) external override whenNotPaused returns (uint256) {
        return _addFile(url, _msgSender());
    }

    /**
     * @notice Adds a file to the registry with permissions
     *
     * @param url                               url of the file
     * @param ownerAddress                      address of the owner
     * @param permissions                       permissions for the file
     * @return uint256                          id of the file
     */
    function addFileWithPermissions(
        string memory url,
        address ownerAddress,
        Permission[] memory permissions
    ) external override whenNotPaused returns (uint256) {
        uint256 fileId = _addFile(url, ownerAddress);

        for (uint256 i = 0; i < permissions.length; i++) {
            _files[fileId].permissions[permissions[i].account] = permissions[i].key;
            emit PermissionGranted(fileId, permissions[i].account);
        }

        return fileId;
    }

    /**
     * @notice Adds an proof to the file
     *
     * @param fileId                            id of the file
     * @param proof                       proof for the file
     */
    function addProof(uint256 fileId, Proof memory proof) external override whenNotPaused {
        uint256 cachedProofCount = ++_files[fileId].proofsCount;

        _files[fileId].proofs[cachedProofCount] = proof;

        emit ProofAdded(fileId, cachedProofCount);
    }

    /**
     * @notice Adds permissions for accounts to access the file
     *
     * @param fileId                            id of the file
     * @param account                           address of the account
     * @param key                               encryption key for the account
     */
    function addFilePermission(uint256 fileId, address account, string memory key) external override whenNotPaused {
        if (_msgSender() != _files[fileId].ownerAddress) {
            revert NotFileOwner();
        }

        _files[fileId].permissions[account] = key;
        emit PermissionGranted(fileId, account);
    }

    /**
     * @notice Adds a file to the registry
     *
     * @param url                               url of the file
     * @param ownerAddress                      address of the owner
     */
    function _addFile(string memory url, address ownerAddress) internal returns (uint256) {
        uint256 cachedFilesCount = ++filesCount;

        bytes32 urlHash = keccak256(abi.encodePacked(url));

        if (_urlHashToFileId[urlHash] != 0) {
            revert FileUrlAlreadyUsed();
        }

        _files[cachedFilesCount].ownerAddress = ownerAddress;
        _files[cachedFilesCount].url = url;
        _files[cachedFilesCount].addedAtBlock = block.number;

        _urlHashToFileId[urlHash] = cachedFilesCount;

        emit FileAdded(cachedFilesCount, ownerAddress, url);

        return cachedFilesCount;
    }
}
