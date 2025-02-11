// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/DLPRootCoreStorageV1.sol";

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

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant DLP_ROOT_METRICS_ROLE = keccak256("DLP_ROOT_METRICS_ROLE");
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
        //        Epoch storage epoch = _epochs[epochsCount];

        //        uint stakersPercentageEpoch = dlp.registrationBlockNumber > epoch.startBlock
        //            ? dlp.stakersPercentageCheckpoints.at(0)._value
        //            : dlp.stakersPercentageCheckpoints.upperLookup(uint48(epoch.startBlock));

        return
            DlpInfo({
                id: dlp.id,
                dlpAddress: dlp.dlpAddress,
                ownerAddress: dlp.ownerAddress,
                treasuryAddress: dlp.treasuryAddress,
                stakersPercentage: dlp.stakersPercentageCheckpoints.latest(),
                stakersPercentageEpoch: dlp.stakersPercentageCheckpoints.latest(), //todo: use stakersPercentageEpoch value after fixing epoch3 values
                name: dlp.name,
                iconUrl: dlp.iconUrl,
                website: dlp.website,
                metadata: dlp.metadata,
                status: dlp.status,
                registrationBlockNumber: dlp.registrationBlockNumber,
                stakeAmount: _dlpComputedStakeAmount(dlpId),
                isVerified: dlp.isVerified
            });
    }

    function dlpComputedStakeAmountByBlock(uint256 dlpId, uint48 checkBlock) external view override returns (uint256) {
        return
            _dlps[dlpId].stakeAmountCheckpoints.upperLookup(checkBlock) -
            _dlps[dlpId].unstakeAmountCheckpoints.upperLookup(checkBlock);
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
                    stakersPercentage = newMinDlpStakersPercentage;
                } else if (stakersPercentage > newMaxDlpStakersPercentage) {
                    stakersPercentage = newMaxDlpStakersPercentage;
                }

                if (stakersPercentage != dlp.stakersPercentageCheckpoints.latest()) {
                    _checkpointPush(dlp.stakersPercentageCheckpoints, stakersPercentage);
                    emit DlpUpdated(
                        i,
                        dlp.dlpAddress,
                        dlp.ownerAddress,
                        dlp.treasuryAddress,
                        stakersPercentage,
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
        _registerDlp(registrationInfo);
    }

    function updateDlpVerification(uint256 dlpId, bool isVerified) external override onlyRole(MAINTAINER_ROLE) {
        Dlp storage dlp = _dlps[dlpId];
        dlp.isVerified = isVerified;

        if (dlp.status == DlpStatus.None || dlp.status == DlpStatus.Deregistered) {
            revert InvalidDlpStatus();
        }

        emit DlpVerificationUpdated(dlpId, isVerified);

        if (_dlpComputedStakeAmount(dlpId) >= dlpEligibilityThreshold) {
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
            _checkpointPush(dlp.stakersPercentageCheckpoints, dlpUpdateInfo.stakersPercentage);
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
        _checkpointAdd(dlp.stakeAmountCheckpoints, amount);

        // Check if DLP becomes eligible
        if (
            dlp.isVerified &&
            (dlp.status == DlpStatus.Registered || dlp.status == DlpStatus.SubEligible) &&
            _dlpComputedStakeAmount(dlpId) >= dlpEligibilityThreshold
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
        _checkpointAdd(dlp.unstakeAmountCheckpoints, amount);

        uint256 dlpStake = _dlpComputedStakeAmount(dlpId);

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
    function _registerDlp(DlpRegistration calldata registrationInfo) internal {
        if (registrationInfo.ownerAddress == address(0) || registrationInfo.treasuryAddress == address(0)) {
            revert InvalidAddress();
        }

        if (dlpIds[registrationInfo.dlpAddress] != 0) {
            revert InvalidDlpStatus();
        }

        if (dlpNameToId[registrationInfo.name] != 0 || bytes(registrationInfo.name).length == 0) {
            revert InvalidName();
        }

        if (
            registrationInfo.stakersPercentage < minDlpStakersPercentage ||
            registrationInfo.stakersPercentage > maxDlpStakersPercentage
        ) {
            revert InvalidStakersPercentage();
        }

        if (msg.value < minDlpRegistrationStake) {
            revert InvalidStakeAmount();
        }

        uint256 dlpId = ++dlpsCount;
        Dlp storage dlp = _dlps[dlpId];

        dlp.id = dlpId;
        dlp.dlpAddress = registrationInfo.dlpAddress;
        dlp.ownerAddress = registrationInfo.ownerAddress;
        dlp.treasuryAddress = registrationInfo.treasuryAddress;
        _checkpointPush(dlp.stakersPercentageCheckpoints, registrationInfo.stakersPercentage);
        dlp.name = registrationInfo.name;
        dlp.iconUrl = registrationInfo.iconUrl;
        dlp.website = registrationInfo.website;
        dlp.metadata = registrationInfo.metadata;
        dlp.registrationBlockNumber = block.number;
        dlp.status = DlpStatus.Registered;

        dlpIds[registrationInfo.dlpAddress] = dlpId;

        dlpNameToId[registrationInfo.name] = dlpId;

        emit DlpRegistered(
            dlpId,
            registrationInfo.dlpAddress,
            registrationInfo.ownerAddress,
            registrationInfo.treasuryAddress,
            registrationInfo.stakersPercentage,
            registrationInfo.name,
            registrationInfo.iconUrl,
            registrationInfo.website,
            registrationInfo.metadata
        );

        emit DlpStatusUpdated(dlpId, DlpStatus.Registered);
        dlpRoot.createStakeOnBehalf{value: msg.value}(dlpId, registrationInfo.ownerAddress);
    }

    /**
     * @notice Helper function to set checkpoint value
     */
    function _checkpointPush(Checkpoints.Trace208 storage store, uint256 delta) private returns (uint208, uint208) {
        return store.push(uint48(block.number), uint208(delta));
    }

    /**
     * @notice Get DLP stake amount at specific block
     */
    function _dlpComputedStakeAmountByBlock(uint256 dlpId, uint48 checkBlock) internal view returns (uint256) {
        return
            _dlps[dlpId].stakeAmountCheckpoints.upperLookup(checkBlock) -
            _dlps[dlpId].unstakeAmountCheckpoints.upperLookup(checkBlock);
    }

    /**
     * @notice Get current DLP stake amount
     */
    function _dlpComputedStakeAmount(uint256 dlpId) internal view returns (uint256) {
        return _dlps[dlpId].stakeAmountCheckpoints.latest() - _dlps[dlpId].unstakeAmountCheckpoints.latest();
    }

    function _dlpRootEpoch() internal view returns (IDLPRootEpoch) {
        return dlpRoot.dlpRootEpoch();
    }

    function _dlpRootMetrics() internal view returns (IDLPRootMetrics) {
        return dlpRoot.dlpRootMetrics();
    }

    /**
     * @notice Helper function to add value to checkpoint
     */
    function _checkpointAdd(Checkpoints.Trace208 storage store, uint256 delta) private returns (uint208, uint208) {
        return store.push(uint48(block.number), store.latest() + uint208(delta));
    }
}
