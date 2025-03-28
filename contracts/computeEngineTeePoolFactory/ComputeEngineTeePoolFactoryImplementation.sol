// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "../computeEngineTeePool/ComputeEngineTeePoolImplementation.sol";

import "./interfaces/ComputeEngineTeePoolFactoryStorageV1.sol";

contract ComputeEngineTeePoolFactoryImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ComputeEngineTeePoolFactoryStorageV1
{
    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    uint80 public constant DEDICATED_TIMEOUT = type(uint80).max;

    event TeePoolCreated(
        address indexed teePoolAddress,
        IComputeEngineTeePool.TeePoolType teePoolType,
        IComputeEngineTeePool.HardwareType hardwareType,
        uint80 maxTimeout
    );

    error InvalidTeePoolParams();
    error TeePoolAlreadyCreated();
    error InvalidTimeout();

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
        ComputeEngineTeePoolFactoryBeacon _teePoolFactoryBeacon,
        uint80 _ephemeralTimeout,
        uint80 _persistentTimeout
    ) external initializer {
        __UUPSUpgradeable_init();
        __Pausable_init();
        __AccessControl_init();

        teePoolFactoryBeacon = _teePoolFactoryBeacon;
        ephemeralTimeout = _ephemeralTimeout;
        persistentTimeout = _persistentTimeout;

        _setRoleAdmin(MAINTAINER_ROLE, DEFAULT_ADMIN_ROLE);
        _grantRole(DEFAULT_ADMIN_ROLE, ownerAddress);
        _grantRole(MAINTAINER_ROLE, ownerAddress);
    }

    /**
     * @notice Upgrades the contract
     * This function is required by OpenZeppelin's UUPSUpgradeable
     *
     * @param newImplementation                  new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal virtual override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /// @inheritdoc IComputeEngineTeePoolFactory
    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    /// @inheritdoc IComputeEngineTeePoolFactory
    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    /// @inheritdoc IComputeEngineTeePoolFactory
    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    /// @inheritdoc IComputeEngineTeePoolFactory
    function updateTeePoolFactoryBeacon(
        ComputeEngineTeePoolFactoryBeacon _teePoolFactoryBeacon
    ) external override onlyRole(MAINTAINER_ROLE) {
        teePoolFactoryBeacon = _teePoolFactoryBeacon;
    }

    /// @inheritdoc IComputeEngineTeePoolFactory
    function updateComputeEngine(address _computeEngine) external override onlyRole(MAINTAINER_ROLE) {
        computeEngine = _computeEngine;
    }

    ///////////////////////////
    ///// TeePool Factory /////
    ///////////////////////////

    /// @inheritdoc IComputeEngineTeePoolFactory
    function createTeePool(
        IComputeEngineTeePool.TeePoolType teePoolType,
        IComputeEngineTeePool.HardwareType hardwareType
    ) external override onlyRole(MAINTAINER_ROLE) returns (address) {
        if (
            teePoolType == IComputeEngineTeePool.TeePoolType.None ||
            hardwareType == IComputeEngineTeePool.HardwareType.None
        ) {
            revert InvalidTeePoolParams();
        }

        bytes32 teePoolTypeId = _typePoolTypeId(teePoolType, hardwareType);
        if (address(_teePools[teePoolTypeId]) != address(0)) {
            revert TeePoolAlreadyCreated();
        }

        uint80 maxTimeout = _maxTimeout(teePoolType);

        address teePoolImpl = teePoolFactoryBeacon.implementation();
        address teePoolProxy = teePoolFactoryBeacon.createBeaconProxy(
            abi.encodeCall(
                ComputeEngineTeePoolImplementation(teePoolImpl).initialize,
                (msg.sender, computeEngine, teePoolType, hardwareType, maxTimeout)
            )
        );

        _teePools[teePoolTypeId] = IComputeEngineTeePool(teePoolProxy);

        emit TeePoolCreated(teePoolProxy, teePoolType, hardwareType, maxTimeout);

        return teePoolProxy;
    }

    function teePools(
        IComputeEngineTeePool.TeePoolType teePoolType,
        IComputeEngineTeePool.HardwareType hardwareType
    ) public view returns (IComputeEngineTeePool) {
        return _teePools[_typePoolTypeId(teePoolType, hardwareType)];
    }

    function _typePoolTypeId(
        IComputeEngineTeePool.TeePoolType teePoolType,
        IComputeEngineTeePool.HardwareType hardwareType
    ) internal pure returns (bytes32 teePoolTypeId) {
        return keccak256(abi.encodePacked(teePoolType, hardwareType));
    }

    function _maxTimeout(IComputeEngineTeePool.TeePoolType teePoolType) internal view returns (uint80 maxTimeout) {
        maxTimeout = teePoolType == IComputeEngineTeePool.TeePoolType.Ephemeral
            ? ephemeralTimeout
            : (teePoolType == IComputeEngineTeePool.TeePoolType.Persistent ? persistentTimeout : DEDICATED_TIMEOUT);
    }

    function updateEphemeralTimeout(uint80 timeout) external override onlyRole(MAINTAINER_ROLE) {
        if (timeout >= persistentTimeout || timeout == 0) {
            revert InvalidTimeout();
        }
        ephemeralTimeout = timeout;
        IComputeEngineTeePool ephemeralStandardTeePool = teePools(
            IComputeEngineTeePool.TeePoolType.Ephemeral,
            IComputeEngineTeePool.HardwareType.Standard
        );
        if (address(ephemeralStandardTeePool) != address(0)) {
            ephemeralStandardTeePool.updateMaxTimeout(timeout);
        }
        IComputeEngineTeePool ephemeralGPUTeePool = teePools(
            IComputeEngineTeePool.TeePoolType.Ephemeral,
            IComputeEngineTeePool.HardwareType.GPU
        );
        if (address(ephemeralGPUTeePool) != address(0)) {
            ephemeralGPUTeePool.updateMaxTimeout(timeout);
        }
    }

    function updatePersistentTimeout(uint80 timeout) external override onlyRole(MAINTAINER_ROLE) {
        if (timeout <= ephemeralTimeout || timeout == DEDICATED_TIMEOUT) {
            revert InvalidTimeout();
        }
        persistentTimeout = timeout;
        IComputeEngineTeePool persistentStandardTeePool = teePools(
            IComputeEngineTeePool.TeePoolType.Persistent,
            IComputeEngineTeePool.HardwareType.Standard
        );
        if (address(persistentStandardTeePool) != address(0)) {
            persistentStandardTeePool.updateMaxTimeout(timeout);
        }
        IComputeEngineTeePool persistentGPUTeePool = teePools(
            IComputeEngineTeePool.TeePoolType.Persistent,
            IComputeEngineTeePool.HardwareType.GPU
        );
        if (address(persistentGPUTeePool) != address(0)) {
            persistentGPUTeePool.updateMaxTimeout(timeout);
        }
    }

    function _teePoolType(uint80 maxTimeout) internal view returns (IComputeEngineTeePool.TeePoolType teePoolType) {
        teePoolType = maxTimeout <= ephemeralTimeout
            ? IComputeEngineTeePool.TeePoolType.Ephemeral
            : (
                maxTimeout <= persistentTimeout
                    ? IComputeEngineTeePool.TeePoolType.Persistent
                    : IComputeEngineTeePool.TeePoolType.Dedicated
            );
    }

    function getTeePoolAddress(uint80 maxTimeout, bool gpuRequired) external view override returns (IComputeEngineTeePool) {
        IComputeEngineTeePool.HardwareType hardwareType = gpuRequired
            ? IComputeEngineTeePool.HardwareType.GPU
            : IComputeEngineTeePool.HardwareType.Standard;

        IComputeEngineTeePool.TeePoolType teePoolType = _teePoolType(uint80(maxTimeout));

        return teePools(teePoolType, hardwareType);
    }
}
