// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./interfaces/ComputeEngineTeePoolStorageV1.sol";

contract ComputeEngineTeePoolImplementation is
    PausableUpgradeable,
    AccessControlUpgradeable,
    ComputeEngineTeePoolStorageV1
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    event TeePoolTypeUpdated(TeePoolType newTeePoolType);
    event HardwareTypeUpdated(HardwareType newHardwareType);
    event TeeAdded(address indexed teeAddress, string url, string publicKey);
    event TeeRemoved(address indexed teeAddress);
    event JobSubmitted(uint256 indexed jobId, address teeAddress);
    event JobRemoved(uint256 indexed jobId);

    error TeeAlreadyAdded();
    error TeeNotActive(address teeAddress);
    error NoActiveTee(address teePoolAddress);
    error NotComputeEngine();
    error HWRequirementNotMet();
    error MaxTimeoutExceeded();

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    modifier onlyComputeEngine() {
        if (msg.sender != computeEngine) {
            revert NotComputeEngine();
        }
        _;
    }

    modifier onlyTeePoolFactory() {
        if (msg.sender != teePoolFactory) {
            revert NotComputeEngine();
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
    function initialize(
        address ownerAddress,
        address _computeEngine,
        TeePoolType _teePoolType,
        HardwareType _hardwareType,
        uint80 _maxTimeout
    ) external initializer {
        __Pausable_init();
        __AccessControl_init();

        computeEngine = _computeEngine;
        teePoolType = _teePoolType;
        hardwareType = _hardwareType;
        maxTimeout = _maxTimeout;

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    /// @inheritdoc IComputeEngineTeePool
    function updateComputeEngine(address newComputeEngine) external override onlyRole(MAINTAINER_ROLE) {
        computeEngine = newComputeEngine;
    }

    function updateTeePoolFactory(address newTeePoolFactory) external override onlyRole(MAINTAINER_ROLE) {
        teePoolFactory = newTeePoolFactory;
    }

    /// @inheritdoc ITeePool
    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    /// @inheritdoc ITeePool
    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    /// @inheritdoc ITeePool
    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    /// @inheritdoc IComputeEngineTeePool
    function updateTeePoolType(TeePoolType newTeePoolType) external override onlyTeePoolFactory {
        teePoolType = newTeePoolType;
        emit TeePoolTypeUpdated(newTeePoolType);
    }

    /// @inheritdoc IComputeEngineTeePool
    function updateHardwareType(HardwareType newHardwareType) external override onlyTeePoolFactory {
        hardwareType = newHardwareType;
        emit HardwareTypeUpdated(newHardwareType);
    }

    /// @inheritdoc IComputeEngineTeePool
    function updateMaxTimeout(uint80 newMaxTimeout) external override onlyTeePoolFactory {
        maxTimeout = newMaxTimeout;
    }

    /// @inheritdoc ITeePool
    function teeList() external view override returns (address[] memory) {
        return _teeList.values();
    }

    /// @inheritdoc ITeePool
    function activeTeeList() external view override returns (address[] memory) {
        return _activeTeeList.values();
    }

    /// @inheritdoc ITeePool
    function teesCount() external view override returns (uint256) {
        return _teeList.length();
    }

    /// @inheritdoc ITeePool
    function activeTeesCount() external view override returns (uint256) {
        return _activeTeeList.length();
    }

    /// @inheritdoc ITeePool
    function isTee(address teeAddress) public view override returns (bool) {
        return _tees[teeAddress].status == TeeStatus.Active;
    }

    /// @inheritdoc IComputeEngineTeePool
    function tees(address teeAddress) public view override returns (TeeInfo memory) {
        Tee storage tee = _tees[teeAddress];
        return
            TeeInfo({
                teeAddress: teeAddress,
                url: tee.url,
                status: tee.status,
                jobsCount: tee.jobIdsList.length(),
                publicKey: tee.publicKey
            });
    }

    /// @inheritdoc IComputeEngineTeePool
    function teeListAt(uint256 index) external view override returns (TeeInfo memory) {
        return tees(_teeList.at(index));
    }

    /// @inheritdoc IComputeEngineTeePool
    function activeTeeListAt(uint256 index) external view override returns (TeeInfo memory) {
        return tees(_activeTeeList.at(index));
    }

    /// @inheritdoc ITeePool
    function addTee(address teeAddress, bytes calldata params) external override onlyRole(MAINTAINER_ROLE) {
        if (_activeTeeList.contains(teeAddress)) {
            revert TeeAlreadyAdded();
        }

        _teeList.add(teeAddress);
        _activeTeeList.add(teeAddress);

        (string memory url, string memory publicKey) = abi.decode(params, (string, string));
        Tee storage tee = _tees[teeAddress];
        tee.url = url;
        tee.status = TeeStatus.Active;
        tee.publicKey = publicKey;
        emit TeeAdded(teeAddress, url, publicKey);
    }

    /// @inheritdoc ITeePool
    function removeTee(address teeAddress) external override onlyRole(MAINTAINER_ROLE) {
        if (!_activeTeeList.contains(teeAddress)) {
            revert TeeNotActive(teeAddress);
        }

        _tees[teeAddress].status = TeeStatus.Removed;
        _activeTeeList.remove(teeAddress);

        emit TeeRemoved(teeAddress);
    }

    /// @inheritdoc ITeePool
    /// @dev Only the ComputeEngine contract can submit jobs to its TeePool.
    function submitJob(bytes calldata params) external override onlyComputeEngine whenNotPaused returns (address, bytes memory) {
        if (_activeTeeList.length() == 0) {
            return (address(0), abi.encodeWithSelector(NoActiveTee.selector, address(this)));
        }

        /// @dev Decode the parameters
        (uint256 jobId, uint80 jobMaxTimeout, bool gpuRequired, address assignedTee) = abi.decode(
            params,
            (uint256, uint80, bool, address)
        );

        if (gpuRequired && hardwareType != HardwareType.GPU) {
            return (address(0), abi.encodeWithSelector(HWRequirementNotMet.selector));
        }

        if (jobMaxTimeout > maxTimeout) {
            return (address(0), abi.encodeWithSelector(MaxTimeoutExceeded.selector));
        }

        address teeAddress;
        if (teePoolType != TeePoolType.Dedicated) {
            /// @dev The job is assigned to an active Tee in a round-robin fashion
            teeAddress = tees(_activeTeeList.at(_jobsCount % _activeTeeList.length())).teeAddress;
        } else {
            /// @dev If the Tee is not active, it won't accept new jobs
            if (!isTee(assignedTee)) {
                return (address(0), abi.encodeWithSelector(TeeNotActive.selector, assignedTee));
            }
            teeAddress = assignedTee;
        }

        _tees[teeAddress].jobIdsList.add(jobId);
        _jobTee[jobId] = teeAddress;

        /// @dev _jobsCount is an internal job counter of the pool
        /// JobId is assigned by the ComputeEngine contract, via
        /// a universal job counter, accross multiple TeePools.
        _jobsCount += 1;

        emit JobSubmitted(jobId, teeAddress);

        return (teeAddress, new bytes(0));
    }

    /// @inheritdoc ITeePool
    /// @dev Only the ComputeEngine contract can remove jobs from their TeePool.
    function removeJob(uint256 jobId) external override onlyComputeEngine whenNotPaused {
        address teeAddress = _jobTee[jobId];
        if (teeAddress == address(0)) {
            return;
        }
        _jobTee[jobId] = address(0);
        _tees[teeAddress].jobIdsList.remove(jobId);
        emit JobRemoved(jobId);
    }
}
