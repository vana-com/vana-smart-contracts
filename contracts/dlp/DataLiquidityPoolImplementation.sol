// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/DataLiquidityPoolStorageV1.sol";

contract DataLiquidityPoolImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    MulticallUpgradeable,
    ERC2771ContextUpgradeable,
    DataLiquidityPoolStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    using SafeERC20 for IERC20;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    /**
     * @notice Triggered when a reward has been requested for a file
     *
     * @param contributorAddress                 owner of the file
     * @param fileId                             file id from the registryData contract
     * @param proofIndex                         proof index
     * @param proofIndex                         proof index
     * @param rewardAmount                       reward amount
     */
    event RewardRequested(
        address indexed contributorAddress,
        uint256 indexed fileId,
        uint256 indexed proofIndex,
        uint256 rewardAmount
    );

    /**
     * @notice Triggered when a file has been validated
     *
     * @param fileId                             file id
     */
    event FileValidated(uint256 indexed fileId);

    /**
     * @notice Triggered when a file has been invalidated
     *
     * @param fileId                             file id
     */
    event FileInvalidated(uint256 indexed fileId);

    /**
     * @notice Triggered when the fileRewardFactor has been updated
     *
     * @param newFileRewardFactor                new file reward factor
     */
    event FileRewardFactorUpdated(uint256 newFileRewardFactor);

    /**
     * @notice Triggered when the proofInstruction has been updated
     *
     * @param newProofInstruction                new proof instruction
     */
    event ProofInstructionUpdated(string newProofInstruction);

    /**
     * @notice Triggered when the publicKey has been updated
     *
     * @param newPublicKey                new public key
     */
    event PublicKeyUpdated(string newPublicKey);

    /**
     * @notice Triggered when the teePool has been updated
     *
     * @param newTeePool                new tee pool
     */
    event TeePoolUpdated(address newTeePool);

    error FileAlreadyAdded();
    error InvalidScore();
    error InvalidAttestator();
    error InvalidProof();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    struct InitParams {
        address trustedForwarder;
        address ownerAddress;
        address tokenAddress;
        address dataRegistryAddress;
        address teePoolAddress;
        string name;
        string publicKey;
        string proofInstruction;
        uint256 fileRewardFactor;
    }

    /**
     * @notice Initialize the contract
     *
     * @param params                             initialization parameters
     */
    function initialize(InitParams memory params) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        _trustedForwarder = params.trustedForwarder;
        name = params.name;
        dataRegistry = IDataRegistry(params.dataRegistryAddress);
        token = IERC20(params.tokenAddress);
        teePool = ITeePool(params.teePoolAddress);
        publicKey = params.publicKey;
        proofInstruction = params.proofInstruction;
        fileRewardFactor = params.fileRewardFactor;

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, params.ownerAddress);
        _grantRole(MAINTAINER_ROLE, params.ownerAddress);
    }

    /**
     * @notice Upgrades the contract
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
     * returns the version of the contract
     */
    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    /**
     * @notice Gets the file information
     *
     * @param fileId                              file id
     */
    function files(uint256 fileId) public view override returns (FileResponse memory) {
        File storage file = _files[fileId];

        return
            FileResponse({
                fileId: fileId,
                timestamp: file.timestamp,
                proofIndex: file.proofIndex,
                rewardAmount: file.rewardAmount
            });
    }

    /**
     * @notice Gets the files list count
     */
    function filesListCount() external view override returns (uint256) {
        return _filesList.length();
    }

    /**
     * @notice Gets the files list at index
     *
     * @param index                   index of the file
     */
    function filesListAt(uint256 index) external view override returns (uint256) {
        return _filesList.at(index);
    }

    /**
     * @notice Gets the contributor information
     *
     * @param index                   index of the contributor
     * @return ContributorInfoResponse             contributor information
     */
    function contributors(uint256 index) external view override returns (ContributorInfoResponse memory) {
        return contributorInfo(_contributors[index]);
    }

    /**
     * @notice Gets the contributor information
     *
     * @param contributorAddress                   address of the contributor
     * @return ContributorInfoResponse             contributor information
     */
    function contributorInfo(address contributorAddress) public view override returns (ContributorInfoResponse memory) {
        return
            ContributorInfoResponse({
                contributorAddress: contributorAddress,
                filesListCount: _contributorInfo[contributorAddress].filesList.length()
            });
    }

    /**
     * @notice Gets the contributor files
     *
     * @param contributorAddress                   address of the contributor
     * @param index                                index of the file
     * @return uint256                             file id
     */
    function contributorFiles(
        address contributorAddress,
        uint256 index
    ) external view override returns (FileResponse memory) {
        return files(_contributorInfo[contributorAddress].filesList.at(index));
    }

    /**
     * @dev Pauses the contract
     */
    function pause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @dev Unpauses the contract
     */
    function unpause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Updates the fileRewardFactor
     *
     * @param newFileRewardFactor                new file reward factor
     */
    function updateFileRewardFactor(uint256 newFileRewardFactor) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        fileRewardFactor = newFileRewardFactor;

        emit FileRewardFactorUpdated(newFileRewardFactor);
    }

    /**
     * @notice Updates the teePool
     *
     * @param newTeePool                new tee pool
     */
    function updateTeePool(address newTeePool) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        teePool = ITeePool(newTeePool);

        emit TeePoolUpdated(newTeePool);
    }

    /**
     * @notice Updates the proofInstruction
     *
     * @param newProofInstruction                new proof instruction
     */
    function updateProofInstruction(
        string calldata newProofInstruction
    ) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        proofInstruction = newProofInstruction;

        emit ProofInstructionUpdated(newProofInstruction);
    }

    /**
     * @notice Updates the publicKey
     *
     * @param newPublicKey                new public key
     */
    function updatePublicKey(string calldata newPublicKey) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        publicKey = newPublicKey;

        emit PublicKeyUpdated(newPublicKey);
    }

    /**
     * @notice Update the trusted forwarder
     *
     * @param trustedForwarderAddress                  address of the trusted forwarder
     */
    function updateTrustedForwarder(address trustedForwarderAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _trustedForwarder = trustedForwarderAddress;
    }

    /**
     * @notice Requests a reward for a file
     *
     * @param fileId                             file id from the registryData contract
     * @param proofIndex                         proof index
     */
    function requestReward(uint256 fileId, uint256 proofIndex) external override whenNotPaused nonReentrant {
        IDataRegistry.Proof memory fileProof = dataRegistry.fileProofs(fileId, proofIndex);

        if (keccak256(bytes(fileProof.data.instruction)) != keccak256(bytes(proofInstruction))) {
            revert InvalidProof();
        }

        File storage file = _files[fileId];

        if (file.rewardAmount != 0) {
            revert FileAlreadyAdded();
        }

        IDataRegistry.FileResponse memory registryFile = dataRegistry.files(fileId);

        if (fileProof.data.score > 1e18 || fileProof.data.score == 0) {
            revert InvalidScore();
        }

        bytes32 _messageHash = keccak256(
            abi.encodePacked(
                registryFile.url,
                fileProof.data.score,
                fileProof.data.dlpId,
                fileProof.data.metadata,
                fileProof.data.proofUrl,
                fileProof.data.instruction
            )
        );

        address signer = _messageHash.toEthSignedMessageHash().recover(fileProof.signature);

        if (!teePool.isTee(signer)) {
            revert InvalidAttestator();
        }

        file.timestamp = block.timestamp;
        file.proofIndex = proofIndex;
        file.rewardAmount = (fileRewardFactor * fileProof.data.score) / 1e18;

        _filesList.add(fileId);

        Contributor storage contributor = _contributorInfo[registryFile.ownerAddress];
        contributor.filesList.add(fileId);

        token.safeTransfer(registryFile.ownerAddress, file.rewardAmount);

        totalContributorsRewardAmount -= file.rewardAmount;

        if (contributor.filesList.length() == 1) {
            contributorsCount++;
            _contributors[contributorsCount] = registryFile.ownerAddress;
        }

        emit RewardRequested(registryFile.ownerAddress, fileId, proofIndex, file.rewardAmount);
    }

    /**
     * @notice Adds rewards for contributors
     */
    function addRewardsForContributors(uint256 contributorsRewardAmount) external override nonReentrant {
        token.safeTransferFrom(_msgSender(), address(this), contributorsRewardAmount);
        totalContributorsRewardAmount += contributorsRewardAmount;
    }
}
