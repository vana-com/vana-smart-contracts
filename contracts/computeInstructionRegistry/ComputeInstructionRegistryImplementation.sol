// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./interfaces/ComputeInstructionRegistryStorageV1.sol";

contract ComputeInstructionRegistryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ComputeInstructionRegistryStorageV1
{
    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    event ComputeInstructionAdded(
        uint256 indexed computeInstructionId,
        address indexed owner,
        string computeInstructionUrl,
        bytes32 computeInstructionHash
    );

    event ComputeInstructionUpdated(uint256 indexed computeInstructionId, uint256 indexed dlpId, bool approved);

    error NotDlpOwner();
    error ComputeInstructionNotFound(uint256 instructionId);

    modifier onlyDlpOwner(uint256 dlpId) {
        if (dlpRootCore.dlps(dlpId).ownerAddress != msg.sender) {
            revert NotDlpOwner();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract
     *
     * @param ownerAddress Address of the owner
     */
    function initialize(address ownerAddress, address initDlpRootCoreAddress) external initializer {
        __UUPSUpgradeable_init();
        __Pausable_init();
        __AccessControl_init();

        dlpRootCore = IDLPRootCoreReadOnly(initDlpRootCoreAddress);

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    /**
     * @notice Upgrades the contract
     * This function is required by OpenZeppelin's UUPSUpgradeable
     *
     * @param newImplementation New implementation
     */
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /// @inheritdoc IComputeInstructionRegistry
    function updateDlpRootCore(address newDlpRootCoreAddress) external onlyRole(MAINTAINER_ROLE) {
        dlpRootCore = IDLPRootCoreReadOnly(newDlpRootCoreAddress);
    }

    /// @inheritdoc IComputeInstructionRegistry
    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    /// @inheritdoc IComputeInstructionRegistry
    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    /// @inheritdoc IComputeInstructionRegistry
    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    /// @inheritdoc IComputeInstructionRegistry
    function instructions(uint256 instructionId) external view returns (ComputeInstructionInfo memory) {
        ComputeInstruction storage instruction = _instructions[instructionId];
        return ComputeInstructionInfo(instruction.hash, instruction.owner, instruction.url);
    }

    /// @inheritdoc IComputeInstructionRegistry
    function isApproved(uint256 instructionId, uint256 dlpId) external view returns (bool) {
        return _instructions[instructionId].dlpApprovals[dlpId];
    }

    /// @inheritdoc IComputeInstructionRegistry
    function isValidInstructionId(uint256 instructionId) external view returns (bool) {
        return instructionId > 0 && instructionId <= instructionsCount;
    }

    /// @inheritdoc IComputeInstructionRegistry
    function addComputeInstruction(bytes32 hash, string calldata url) external whenNotPaused returns (uint256 computeInstructionId) {
        computeInstructionId = ++instructionsCount;

        ComputeInstruction storage instruction = _instructions[computeInstructionId];
        instruction.hash = hash;
        instruction.owner = msg.sender;
        instruction.url = url;

        emit ComputeInstructionAdded(computeInstructionId, msg.sender, url, hash);
    }

    /// @inheritdoc IComputeInstructionRegistry
    function updateComputeInstruction(
        uint256 instructionId,
        uint256 dlpId,
        bool approved
    ) external onlyDlpOwner(dlpId) whenNotPaused {
        if (instructionId == 0 || instructionId > instructionsCount) {
            revert ComputeInstructionNotFound(instructionId);
        }
        ComputeInstruction storage instruction = _instructions[instructionId];
        if (instruction.dlpApprovals[dlpId] != approved) {
            instruction.dlpApprovals[dlpId] = approved;
            emit ComputeInstructionUpdated(instructionId, dlpId, approved);
        }
    }
}
