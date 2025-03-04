// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/DLPRootCoreStorageV1.sol";
import {IDLPRootOld} from "../root/interfaces/IDLPRootOld.sol";
import {IVeVANA} from "../veVANA/interfaces/IVeVANA.sol";

contract DLPRootCoreImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    DLPRootCoreStorageV1
{
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;
    using Checkpoints for Checkpoints.Trace208;
    using SafeERC20 for IVeVANA;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant DLP_ROOT_ROLE = keccak256("DLP_ROOT_ROLE");

    uint256 public constant NEW_MULTIPLIER_EPOCH = 3;

    // Key events for DLP lifecycle and operations
    event DlpRegistered(
        uint256 indexed dlpId,
        address indexed dlpAddress,
        address ownerAddress,
        address treasuryAddress,
        uint256 stakersPercentage,
        string name,
        string iconUrl,
        string website,
        string metadata
    );

    event DlpUpdated(
        uint256 indexed dlpId,
        address indexed dlpAddress,
        address ownerAddress,
        address treasuryAddress,
        uint256 stakersPercentage,
        string name,
        string iconUrl,
        string website,
        string metadata
    );

    event DlpStatusUpdated(uint256 indexed dlpId, DlpStatus newStatus);
    event DlpVerificationUpdated(uint256 indexed dlpId, bool verified);
    event MinDlpStakersPercentageUpdated(uint256 newMinDlpStakersPercentage);
    event MaxDlpStakersPercentageUpdated(uint256 newMaxDlpStakersPercentage);
    event MinStakeAmountUpdated(uint256 newMinStakeAmount);
    event DlpEligibilityThresholdUpdated(uint256 newDlpEligibilityThreshold);
    event DlpSubEligibilityThresholdUpdated(uint256 newDlpSubEligibilityThreshold);
    event MinDlpRegistrationStakeUpdated(uint256 newMinDlpRegistrationStake);

    // Custom errors
    error InvalidParam();
    error InvalidStakeAmount();
    error StakeAlreadyWithdrawn();
    error StakeNotClosed();
    error StakeAlreadyClosed();
    error StakeWithdrawalTooEarly();
    error InvalidDlpId();
    error InvalidDlpStatus();
    error InvalidAddress();
    error InvalidName();
    error NotDlpOwner();
    error NotStakeOwner();
    error NothingToClaim();
    error InvalidStakersPercentage();
    error DlpAddressCannotBeChanged();
    error TransferFailed();
    error EpochNotEnded();
    error EpochDlpScoreAlreadySaved();
    error EpochRewardsAlreadyDistributed();
    error LastEpochMustBeFinalised();

    modifier onlyDlpOwner(uint256 dlpId) {
        if (_dlps[dlpId].ownerAddress != msg.sender) {
            revert NotDlpOwner();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address ownerAddress, address dlpRootAddress) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        dlpRoot = IDLPRoot(dlpRootAddress);

        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
        _grantRole(MANAGER_ROLE, ownerAddress);
        _grantRole(DLP_ROOT_ROLE, dlpRootAddress);
    }

    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    /**
     * @notice Gets DLP information including current stake and status
     */
    function dlps(uint256 dlpId) public view override returns (DlpInfo memory) {
        Dlp storage dlp = _dlps[dlpId];

        uint256 epochsCount = _dlpRootEpoch().epochsCount();
        return
            DlpInfo({
                id: dlp.id,
                dlpAddress: dlp.dlpAddress,
                ownerAddress: dlp.ownerAddress,
                treasuryAddress: dlp.treasuryAddress,
                stakersPercentage: dlp.stakersPercentageCheckpoints.latest(),
                stakersPercentageEpoch: dlp.stakersPercentageCheckpoints.upperLookup(
                    epochsCount > 0 ? uint48(epochsCount - 1) : 0
                ),
                name: dlp.name,
                iconUrl: dlp.iconUrl,
                website: dlp.website,
                metadata: dlp.metadata,
                status: dlp.status,
                registrationBlockNumber: dlp.registrationBlockNumber,
                stakeAmount: dlp.stakeAmountCheckpoints.latest(),
                isVerified: dlp.isVerified
            });
    }

    function dlpEpochStakeAmount(uint256 dlpId, uint256 epochId) external view override returns (uint256) {
        return _dlps[dlpId].stakeAmountCheckpoints.upperLookup(uint48(epochId));
    }

    function dlpsByAddress(address dlpAddress) external view override returns (DlpInfo memory) {
        return dlps(dlpIds[dlpAddress]);
    }

    function dlpsByName(string calldata dlpName) external view override returns (DlpInfo memory) {
        return dlps(dlpNameToId[dlpName]);
    }

    function eligibleDlpsListValues() external view override returns (uint256[] memory) {
        return _eligibleDlpsList.values();
    }

    function eligibleDlpsListCount() external view override returns (uint256) {
        return _eligibleDlpsList.length();
    }

    function eligibleDlpsListAt(uint256 index) external view override returns (uint256) {
        return _eligibleDlpsList.at(index);
    }

    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function updateDlpStakersPercentages(
        uint256 newMinDlpStakersPercentage,
        uint256 newMaxDlpStakersPercentage
    ) external override onlyRole(MAINTAINER_ROLE) {
        if (newMinDlpStakersPercentage < 1e16 || newMinDlpStakersPercentage > newMaxDlpStakersPercentage) {
            revert InvalidParam();
        }

        minDlpStakersPercentage = newMinDlpStakersPercentage;
        maxDlpStakersPercentage = newMaxDlpStakersPercentage;

        emit MinDlpStakersPercentageUpdated(newMinDlpStakersPercentage);
        emit MaxDlpStakersPercentageUpdated(newMaxDlpStakersPercentage);

        uint256 _dlpsCount = dlpsCount;
        for (uint256 i = 1; i <= _dlpsCount; ) {
            Dlp storage dlp = _dlps[i];
            if (dlp.status != DlpStatus.Deregistered) {
                uint256 stakersPercentage = dlp.stakersPercentageCheckpoints.latest();
                if (stakersPercentage < newMinDlpStakersPercentage) {
                    _checkpointPush(
                        dlp.stakersPercentageCheckpoints,
                        _dlpRootEpoch().epochsCount(),
                        newMinDlpStakersPercentage
                    );
                    emit DlpUpdated(
                        i,
                        dlp.dlpAddress,
                        dlp.ownerAddress,
                        dlp.treasuryAddress,
                        newMinDlpStakersPercentage,
                        dlp.name,
                        dlp.iconUrl,
                        dlp.website,
                        dlp.metadata
                    );
                } else if (stakersPercentage > newMaxDlpStakersPercentage) {
                    _checkpointPush(
                        dlp.stakersPercentageCheckpoints,
                        _dlpRootEpoch().epochsCount(),
                        newMaxDlpStakersPercentage
                    );
                    emit DlpUpdated(
                        i,
                        dlp.dlpAddress,
                        dlp.ownerAddress,
                        dlp.treasuryAddress,
                        newMaxDlpStakersPercentage,
                        dlp.name,
                        dlp.iconUrl,
                        dlp.website,
                        dlp.metadata
                    );
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function updateMinDlpRegistrationStake(
        uint256 newMinDlpRegistrationStake
    ) external override onlyRole(MAINTAINER_ROLE) {
        if (
            dlpRoot.minStakeAmount() > newMinDlpRegistrationStake ||
            newMinDlpRegistrationStake > dlpSubEligibilityThreshold
        ) {
            revert InvalidParam();
        }
        minDlpRegistrationStake = newMinDlpRegistrationStake;
        emit MinDlpRegistrationStakeUpdated(newMinDlpRegistrationStake);
    }

    /**
     * @notice Updates eligibility thresholds
     */
    function updateDlpEligibilityThresholds(
        uint256 newDlpSubEligibilityThreshold,
        uint256 newDlpEligibilityThreshold
    ) external override onlyRole(MAINTAINER_ROLE) {
        if (newDlpSubEligibilityThreshold > newDlpEligibilityThreshold) {
            revert InvalidParam();
        }

        dlpSubEligibilityThreshold = newDlpSubEligibilityThreshold;
        dlpEligibilityThreshold = newDlpEligibilityThreshold;

        emit DlpSubEligibilityThresholdUpdated(newDlpSubEligibilityThreshold);
        emit DlpEligibilityThresholdUpdated(newDlpEligibilityThreshold);
    }

    function updateDlpRoot(address newDlpRootAddress) external override onlyRole(MAINTAINER_ROLE) {
        dlpRoot = IDLPRoot(newDlpRootAddress);
    }

    /**
     * @notice Registers a new DLP with initial stake
     */
    function registerDlp(
        DlpRegistration calldata registrationInfo
    ) external payable override whenNotPaused nonReentrant {
        _dlpRootEpoch().createEpochs();
        _registerDlp(registrationInfo, msg.value);
    }

    /**
     * @notice Registers a new DLP with initial stake in veVANA
     */
    function registerDlpWithVeVANA(
        DlpRegistration calldata registrationInfo,
        uint256 amount
    ) external override whenNotPaused nonReentrant {
        _dlpRootEpoch().createEpochs();
        _registerDlp(registrationInfo, amount);
    }

    function updateDlpVerification(uint256 dlpId, bool isVerified) external override onlyRole(MAINTAINER_ROLE) {
        Dlp storage dlp = _dlps[dlpId];
        dlp.isVerified = isVerified;

        if (dlp.status == DlpStatus.None || dlp.status == DlpStatus.Deregistered) {
            revert InvalidDlpStatus();
        }

        emit DlpVerificationUpdated(dlpId, isVerified);

        if (dlp.stakeAmountCheckpoints.latest() >= dlpEligibilityThreshold) {
            if (isVerified) {
                _eligibleDlpsList.add(dlpId);
                dlp.status = DlpStatus.Eligible;
                emit DlpStatusUpdated(dlpId, DlpStatus.Eligible);
            } else {
                _eligibleDlpsList.remove(dlpId);
                dlp.status = DlpStatus.Registered;
                emit DlpStatusUpdated(dlpId, DlpStatus.Registered);
            }
        }
    }

    /**
     * @notice Updates DLP information
     * @dev Only DLP owner can update
     */
    function updateDlp(
        uint256 dlpId,
        DlpRegistration calldata dlpUpdateInfo
    ) external override whenNotPaused nonReentrant onlyDlpOwner(dlpId) {
        _dlpRootEpoch().createEpochs();

        if (dlpUpdateInfo.ownerAddress == address(0) || dlpUpdateInfo.treasuryAddress == address(0)) {
            revert InvalidAddress();
        }

        if (
            dlpUpdateInfo.stakersPercentage < minDlpStakersPercentage ||
            dlpUpdateInfo.stakersPercentage > maxDlpStakersPercentage
        ) {
            revert InvalidStakersPercentage();
        }

        Dlp storage dlp = _dlps[dlpId];

        //this validation will be removed in the future
        if (dlp.dlpAddress != dlpUpdateInfo.dlpAddress) {
            revert DlpAddressCannotBeChanged();
        }

        dlp.ownerAddress = dlpUpdateInfo.ownerAddress;
        dlp.treasuryAddress = dlpUpdateInfo.treasuryAddress;
        if (dlp.stakersPercentageCheckpoints.latest() != dlpUpdateInfo.stakersPercentage) {
            _checkpointPush(
                dlp.stakersPercentageCheckpoints,
                _dlpRootEpoch().epochsCount(),
                dlpUpdateInfo.stakersPercentage
            );
        }

        if (keccak256(bytes(dlpUpdateInfo.name)) != keccak256(bytes(dlp.name))) {
            if (dlpNameToId[dlpUpdateInfo.name] != 0 || !_validateDlpNameLength(dlpUpdateInfo.name)) {
                revert InvalidName();
            }

            dlpNameToId[dlp.name] = 0;
            dlpNameToId[dlpUpdateInfo.name] = dlpId;
        }

        dlp.name = dlpUpdateInfo.name;
        dlp.iconUrl = dlpUpdateInfo.iconUrl;
        dlp.website = dlpUpdateInfo.website;
        dlp.metadata = dlpUpdateInfo.metadata;

        dlpIds[dlpUpdateInfo.dlpAddress] = dlpId;

        emit DlpUpdated(
            dlpId,
            dlpUpdateInfo.dlpAddress,
            dlpUpdateInfo.ownerAddress,
            dlpUpdateInfo.treasuryAddress,
            dlpUpdateInfo.stakersPercentage,
            dlpUpdateInfo.name,
            dlpUpdateInfo.iconUrl,
            dlpUpdateInfo.website,
            dlpUpdateInfo.metadata
        );
    }

    /**
     * @notice Deregisters a DLP
     * @dev Only owner can deregister, must be in valid status
     */
    function deregisterDlp(uint256 dlpId) external override whenNotPaused nonReentrant onlyDlpOwner(dlpId) {
        _dlpRootEpoch().createEpochs();

        Dlp storage dlp = _dlps[dlpId];

        if (dlp.status == DlpStatus.None || dlp.status == DlpStatus.Deregistered) {
            revert InvalidDlpStatus();
        }

        dlp.status = DlpStatus.Deregistered;
        _eligibleDlpsList.remove(dlpId);

        uint256 epochsCount = _dlpRootEpoch().epochsCount();
        if (epochsCount > 1 && !_dlpRootEpoch().epochs(epochsCount - 1).isFinalised) {
            revert LastEpochMustBeFinalised();
        }

        emit DlpStatusUpdated(dlpId, DlpStatus.Deregistered);
    }

    function addDlpStake(uint256 dlpId, uint256 amount) external override onlyRole(DLP_ROOT_ROLE) {
        Dlp storage dlp = _dlps[dlpId];
        _checkpointAdd(dlp.stakeAmountCheckpoints, _dlpRootEpoch().epochsCount(), amount);

        // Check if DLP becomes eligible
        if (
            dlp.isVerified &&
            (dlp.status == DlpStatus.Registered || dlp.status == DlpStatus.SubEligible) &&
            dlp.stakeAmountCheckpoints.latest() >= dlpEligibilityThreshold
        ) {
            _eligibleDlpsList.add(dlpId);
            dlp.status = DlpStatus.Eligible;

            uint256 epochsCount = _dlpRootEpoch().epochsCount();
            if (epochsCount > 1 && !_dlpRootEpoch().epochs(epochsCount - 1).isFinalised) {
                revert LastEpochMustBeFinalised();
            }

            emit DlpStatusUpdated(dlpId, DlpStatus.Eligible);
        }
    }

    function removeDlpStake(uint256 dlpId, uint256 amount) external override onlyRole(DLP_ROOT_ROLE) {
        Dlp storage dlp = _dlps[dlpId];
        _checkpointSub(dlp.stakeAmountCheckpoints, _dlpRootEpoch().epochsCount(), amount);

        uint256 dlpStake = dlp.stakeAmountCheckpoints.latest();

        // Update DLP status based on remaining stake
        if (
            dlpStake < dlpSubEligibilityThreshold &&
            (dlp.status == DlpStatus.SubEligible || dlp.status == DlpStatus.Eligible)
        ) {
            dlp.status = DlpStatus.Registered;
            _eligibleDlpsList.remove(dlpId);

            uint256 epochsCount = _dlpRootEpoch().epochsCount();
            if (epochsCount > 1 && !_dlpRootEpoch().epochs(epochsCount - 1).isFinalised) {
                revert LastEpochMustBeFinalised();
            }

            emit DlpStatusUpdated(dlpId, DlpStatus.Registered);
        } else if (dlpStake < dlpEligibilityThreshold && dlp.status == DlpStatus.Eligible) {
            dlp.status = DlpStatus.SubEligible;

            emit DlpStatusUpdated(dlpId, DlpStatus.SubEligible);
        }
    }

    /**
     * @notice Internal function to register a new DLP
     */
    function _registerDlp(DlpRegistration calldata registrationInfo, uint256 amount) internal {
        if (registrationInfo.ownerAddress == address(0) || registrationInfo.treasuryAddress == address(0)) {
            revert InvalidAddress();
        }

        if (dlpIds[registrationInfo.dlpAddress] != 0) {
            revert InvalidDlpStatus();
        }

        if (dlpNameToId[registrationInfo.name] != 0 || !_validateDlpNameLength(registrationInfo.name)) {
            revert InvalidName();
        }

        if (
            registrationInfo.stakersPercentage < minDlpStakersPercentage ||
            registrationInfo.stakersPercentage > maxDlpStakersPercentage
        ) {
            revert InvalidStakersPercentage();
        }

        if (amount < minDlpRegistrationStake) {
            revert InvalidStakeAmount();
        }

        Dlp storage dlp = _dlps[++dlpsCount];

        uint256 epochsCount = _dlpRootEpoch().epochsCount();

        dlp.id = dlpsCount;
        dlp.dlpAddress = registrationInfo.dlpAddress;
        dlp.ownerAddress = registrationInfo.ownerAddress;
        dlp.treasuryAddress = registrationInfo.treasuryAddress;
        _checkpointPush(
            dlp.stakersPercentageCheckpoints,
            epochsCount > 0 ? epochsCount - 1 : 0,
            registrationInfo.stakersPercentage
        );
        dlp.name = registrationInfo.name;
        dlp.iconUrl = registrationInfo.iconUrl;
        dlp.website = registrationInfo.website;
        dlp.metadata = registrationInfo.metadata;
        dlp.registrationBlockNumber = block.number;
        dlp.status = DlpStatus.Registered;

        dlpIds[registrationInfo.dlpAddress] = dlp.id;

        dlpNameToId[registrationInfo.name] = dlp.id;

        emit DlpRegistered(
            dlp.id,
            registrationInfo.dlpAddress,
            registrationInfo.ownerAddress,
            registrationInfo.treasuryAddress,
            registrationInfo.stakersPercentage,
            registrationInfo.name,
            registrationInfo.iconUrl,
            registrationInfo.website,
            registrationInfo.metadata
        );

        emit DlpStatusUpdated(dlp.id, DlpStatus.Registered);
        if (msg.value > 0) {
            dlpRoot.createStakeOnBehalf{value: msg.value}(dlp.id, registrationInfo.ownerAddress);
        } else {
            IVeVANA veVANA = dlpRoot.dlpRootStakesTreasury().veVANA();
            veVANA.safeTransferFrom(msg.sender, address(this), amount);
            veVANA.approve(address(dlpRoot), amount);
            dlpRoot.createStakeOnBehalfWithVeVANA(dlp.id, registrationInfo.ownerAddress, amount);
        }
        
    }

    function _dlpRootEpoch() internal view returns (IDLPRootEpoch) {
        return dlpRoot.dlpRootEpoch();
    }

    function _dlpRootMetrics() internal view returns (IDLPRootMetrics) {
        return dlpRoot.dlpRootMetrics();
    }

    /**
     * @notice Helper function to set checkpoint value
     */
    function _checkpointPush(
        Checkpoints.Trace208 storage store,
        uint256 key,
        uint256 value
    ) private returns (uint208, uint208) {
        return store.push(uint48(key), uint208(value));
    }

    function _checkpointAdd(
        Checkpoints.Trace208 storage store,
        uint256 key,
        uint256 delta
    ) private returns (uint208, uint208) {
        return store.push(uint48(key), store.latest() + uint208(delta));
    }

    function _checkpointSub(
        Checkpoints.Trace208 storage store,
        uint256 epochId,
        uint256 delta
    ) private returns (uint208, uint208) {
        return store.push(uint48(epochId), store.latest() - uint208(delta));
    }

    function _validateDlpNameLength(string memory str) internal pure returns (bool) {
        bytes memory strBytes = bytes(str);
        uint256 count = 0;

        for (uint256 i = 0; i < strBytes.length; i++) {
            if (strBytes[i] != 0x20) {
                // 0x20 is the ASCII space character
                count++;
            }
        }

        return count > 3;
    }

    function migrateParametersData() external onlyRole(MANAGER_ROLE) {
        IDLPRootOld dlpRootOld = IDLPRootOld(address(dlpRoot));
        minDlpStakersPercentage = dlpRootOld.minDlpStakersPercentage();
        maxDlpStakersPercentage = dlpRootOld.maxDlpStakersPercentage();
        minDlpRegistrationStake = dlpRootOld.minDlpRegistrationStake();
        dlpEligibilityThreshold = dlpRootOld.dlpEligibilityThreshold();
        dlpSubEligibilityThreshold = dlpRootOld.dlpSubEligibilityThreshold();
    }

    function migrateDlpData(uint256 startDlpId, uint256 endDlpId) external onlyRole(MANAGER_ROLE) {
        IDLPRootOld dlpRootOld = IDLPRootOld(address(dlpRoot));

        uint256 epochsCount = dlpRootOld.epochsCount();
        for (uint256 dlpId = startDlpId; dlpId <= endDlpId; ) {
            IDLPRootOld.DlpInfo memory dlpInfo = dlpRootOld.dlps(dlpId);
            Dlp storage dlp = _dlps[dlpId];

            dlp.id = dlpInfo.id;
            dlp.dlpAddress = dlpInfo.dlpAddress;
            dlp.ownerAddress = dlpInfo.ownerAddress;
            dlp.treasuryAddress = payable(dlpInfo.treasuryAddress);
            dlp.name = dlpInfo.name;
            dlp.iconUrl = dlpInfo.iconUrl;
            dlp.website = dlpInfo.website;
            dlp.metadata = dlpInfo.metadata;
            dlp.status = DlpStatus(uint256(dlpInfo.status));
            dlp.registrationBlockNumber = dlpInfo.registrationBlockNumber;
            dlp.isVerified = dlpInfo.isVerified;

            for (uint256 epochId = 0; epochId <= epochsCount; ) {
                IDLPRootOld.DlpEpochInfo memory dlpEpochInfo = dlpRootOld.dlpEpochs(dlpId, epochId);

                _checkpointPush(dlp.stakersPercentageCheckpoints, epochId, dlpEpochInfo.stakersPercentage);
                _checkpointPush(dlp.stakeAmountCheckpoints, epochId, dlpEpochInfo.stakeAmount);

                unchecked {
                    ++epochId;
                }
            }

            dlpIds[dlpInfo.dlpAddress] = dlpId;
            dlpNameToId[dlpInfo.name] = dlpId;

            if (DlpStatus(uint256(dlpInfo.status)) == DlpStatus.Eligible) {
                _eligibleDlpsList.add(dlpId);
            }

            dlpsCount++;

            unchecked {
                ++dlpId;
            }
        }
    }

    function migrateLastEpochDlpStakeData(uint256 startDlpId, uint256 endDlpId) external onlyRole(MANAGER_ROLE) {
        IDLPRootOld dlpRootOld = IDLPRootOld(address(dlpRoot));

        uint256 epochsCount = dlpRootOld.epochsCount();
        for (uint256 dlpId = startDlpId; dlpId <= endDlpId; ) {
            Dlp storage dlp = _dlps[dlpId];

            IDLPRootOld.DlpEpochInfo memory dlpEpochInfo = dlpRootOld.dlpEpochs(dlpId, epochsCount);

            _checkpointPush(dlp.stakeAmountCheckpoints, epochsCount, dlpEpochInfo.stakeAmount);

            unchecked {
                ++dlpId;
            }
        }
    }
}
