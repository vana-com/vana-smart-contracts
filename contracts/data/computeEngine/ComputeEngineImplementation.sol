// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "../dataAccessPayment/interfaces/IPaymentRequestor.sol";
import "../dataAccessTreasury/DataAccessTreasuryProxyFactory.sol";
import "../dataAccessTreasury/DataAccessTreasuryImplementation.sol";
import "./interfaces/ComputeEngineStorageV1.sol";

contract ComputeEngineImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    ComputeEngineStorageV1
{
    using SafeERC20 for IERC20;
    using Address for address payable;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    uint80 public constant DEDICATED_TIMEOUT = type(uint80).max;
    address public constant VANA = address(0);

    event JobRegistered(uint256 indexed jobId, address indexed ownerAddress);
    event JobCanceled(uint256 indexed jobId);
    event JobStatusUpdated(uint256 indexed jobId, JobStatus status, string statusMessage);
    event PaymentExecuted(uint256 indexed jobId, address indexed token, uint256 amount);
    event Deposit(address indexed account, address indexed token, uint256 amount);
    event Withdraw(address indexed account, address indexed token, uint256 amount);
    event TeeAssignmentFailed(uint256 indexed jobId, bytes reason);
    event TeeAssignmentSucceeded(uint256 indexed jobId, address indexed teePoolAddress, address teeAddress);

    error NotJobOwner();
    error JobAlreadyDone();
    error JobLifeCycleEnded();
    error OnlyRegisteredJobStatus();
    error NotTee();
    error TeeAlreadyAssigned(uint256 jobId);
    error FailedToAssignTee();
    error NotLongRunningJob();
    error TeePoolNotFound();

    error ZeroTeeAddress();
    error ZeroAddress();
    error InvalidStatusTransition(JobStatus currentStatus, JobStatus newStatus);
    error NotQueryEngine();
    error UnauthorizedPaymentRequestor();
    error InsufficientBalance();
    error InvalidVanaAmount();
    error InvalidAmount();
    error UnexpectedVanaDeposit();
    error JobNotFound(uint256 jobId);
    error JobNotSubmitted(uint256 jobId);
    error InstructionNotFound(uint256 computeInstructionId);

    modifier onlyQueryEngine() {
        if (msg.sender != queryEngine) {
            revert NotQueryEngine();
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
        address initQueryEngine,
        IComputeEngineTeePoolFactory initTeePoolFactory,
        DataAccessTreasuryProxyFactory initDataAccessTreasuryFactory
    ) external initializer {
        __UUPSUpgradeable_init();
        __Pausable_init();
        __AccessControl_init();
        __ReentrancyGuard_init();

        queryEngine = initQueryEngine;

        teePoolFactory = initTeePoolFactory;

        /// @dev Deploy a new data access treasury for the compute engine via beacon proxy
        address proxy = initDataAccessTreasuryFactory.createBeaconProxy(
            abi.encodeCall(
                DataAccessTreasuryImplementation(payable(initDataAccessTreasuryFactory.implementation())).initialize,
                (ownerAddress, address(this))
            )
        );
        computeEngineTreasury = IDataAccessTreasury(proxy);

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

    /// @inheritdoc IComputeEngine
    function version() external pure virtual override returns (uint256) {
        return 1;
    }

    /// @inheritdoc IComputeEngine
    function pause() external override onlyRole(MAINTAINER_ROLE) {
        _pause();
    }

    /// @inheritdoc IComputeEngine
    function unpause() external override onlyRole(MAINTAINER_ROLE) {
        _unpause();
    }

    function updateQueryEngine(address newQueryEngineAddress) external override onlyRole(MAINTAINER_ROLE) {
        queryEngine = newQueryEngineAddress;
    }

    function updateComputeEngineTreasury(
        IDataAccessTreasury newComputeEngineTreasuryAddress
    ) external override onlyRole(MAINTAINER_ROLE) {
        if (address(newComputeEngineTreasuryAddress) == address(0)) {
            revert ZeroAddress();
        }
        computeEngineTreasury = newComputeEngineTreasuryAddress;
    }

    function updateInstructionRegistry(
        IComputeInstructionRegistry newInstructionRegistry
    ) external override onlyRole(MAINTAINER_ROLE) {
        instructionRegistry = newInstructionRegistry;
    }

    function updateTeePoolFactory(
        IComputeEngineTeePoolFactory newTeePoolFactory
    ) external override onlyRole(MAINTAINER_ROLE) {
        teePoolFactory = newTeePoolFactory;
    }

    ////////////////////////
    ///// Job Registry /////
    ////////////////////////

    /// @inheritdoc IComputeEngine
    function jobs(uint256 jobId) external view override returns (Job memory) {
        return _jobs[jobId];
    }

    /// @inheritdoc IComputeEngine
    function submitJob(
        uint80 maxTimeout,
        bool gpuRequired,
        uint256 computeInstructionId
    ) external payable override whenNotPaused {
        uint256 jobId = _registerJob(maxTimeout, gpuRequired, computeInstructionId);

        address teeAddress = _assignJobToTee(jobId);
        if (teeAddress == address(0)) {
            /// @dev The job will be in the Registered state and can be resubmitted later or canceled
            return;
        }
        Job storage job = _jobs[jobId];
        job.teeAddress = teeAddress;
        job.status = JobStatus.Submitted;
    }

    /// @inheritdoc IComputeEngine
    function submitJobWithTee(
        uint80 maxTimeout,
        bool gpuRequired,
        uint256 computeInstructionId,
        address teeAddress
    ) external payable override whenNotPaused {
        /// @dev We don't check if the job is a long-running job.
        /// If an app builder has a dedicated Tee, they can submit any job to it.
        /// The verification of the Tee ownership is performed off-chain.
        /// submitJobWithTee always submits the job to the dedicated Tee pools.

        // if (maxTimeout <= teePoolFactory.persistentTimeout()) {
        //     revert NotLongRunningJob();
        // }

        if (teeAddress == address(0)) {
            revert ZeroTeeAddress();
        }

        uint256 jobId = _registerJob(maxTimeout, gpuRequired, computeInstructionId);
        Job storage job = _jobs[jobId];

        /// @dev Assign the job to the Tee and submit it to the TeePool
        job.teeAddress = teeAddress;
        address assignedTeeAddress = _assignJobToTee(jobId);
        if (assignedTeeAddress != teeAddress) {
            revert FailedToAssignTee();
        }

        job.status = JobStatus.Submitted;
    }

    /// @notice Registers a job
    /// @param maxTimeout The maximum timeout for the job
    /// @param gpuRequired True if the job requires GPU, false otherwise
    /// @param computeInstructionId The ID of the compute instruction
    /// @return jobId The ID of the job
    function _registerJob(
        uint80 maxTimeout,
        bool gpuRequired,
        uint256 computeInstructionId
    ) internal whenNotPaused returns (uint256 jobId) {
        if (!instructionRegistry.isValidInstructionId(computeInstructionId)) {
            revert InstructionNotFound(computeInstructionId);
        }

        /// @dev Deposit the job fee
        if (msg.value > 0) {
            _deposit(msg.sender, VANA, msg.value);
        }

        jobId = ++jobsCount;
        Job storage job = _jobs[jobId];
        job.ownerAddress = msg.sender;
        job.maxTimeout = maxTimeout;
        job.gpuRequired = gpuRequired;
        job.status = JobStatus.Registered;
        job.computeInstructionId = uint32(computeInstructionId);
        job.addedTimestamp = uint48(block.timestamp);

        emit JobRegistered(jobId, msg.sender);
    }

    function resubmitJob(uint256 jobId) external override whenNotPaused {
        _resubmitJobWithTee(jobId, address(0));
    }

    function resubmitJobWithTee(uint256 jobId, address teeAddress) external override whenNotPaused {
        if (teeAddress == address(0)) {
            revert ZeroTeeAddress();
        }
        _resubmitJobWithTee(jobId, teeAddress);
    }

    function _resubmitJobWithTee(uint256 jobId, address teeAddress) internal whenNotPaused {
        if (jobId == 0 || jobId > jobsCount) {
            revert JobNotFound(jobId);
        }

        Job storage job = _jobs[jobId];
        if (job.teeAddress != address(0)) {
            revert TeeAlreadyAssigned(jobId);
        }

        if (job.status != JobStatus.Registered) {
            revert OnlyRegisteredJobStatus();
        }

        // if (teeAddress != address(0) && job.maxTimeout <= teePoolFactory.persistentTimeout()) {
        //     revert NotLongRunningJob();
        // }

        if (teeAddress != address(0)) {
            job.teeAddress = teeAddress;
        }
        address assignedTeeAddress = _assignJobToTee(jobId);
        if (assignedTeeAddress == address(0) || (teeAddress != address(0) && assignedTeeAddress != teeAddress)) {
            revert FailedToAssignTee();
        }

        job.teeAddress = assignedTeeAddress;
        job.status = JobStatus.Submitted;
    }

    function _assignJobToTee(uint256 jobId) internal returns (address) {
        Job storage job = _jobs[jobId];

        address jobTeeAddress = job.teeAddress;
        /// @dev If a non-zero Tee address is provided, the job will be submitted to the dedicated Tee pool.
        uint80 jobMaxTimeout = jobTeeAddress != address(0) ? DEDICATED_TIMEOUT : job.maxTimeout;
        IComputeEngineTeePool teePoolAddress = teePoolFactory.getTeePoolAddress(jobMaxTimeout, job.gpuRequired);
        if (address(teePoolAddress) == address(0)) {
            /**
             * @dev The job will be in the Registered state and can be resubmitted later
             * when a TEE pool is available, or the user can cancel the job.
             */
            emit TeeAssignmentFailed(jobId, abi.encodeWithSelector(TeePoolNotFound.selector));
            return address(0);
        }

        /// @dev submitJob should not revert. If the job cannot be assigned to a Tee,
        /// its status will be Registered.
        bytes memory jobParams = abi.encode(jobId, job.maxTimeout, job.gpuRequired, jobTeeAddress);
        (address assignedTeeAddress, bytes memory reason) = teePoolAddress.submitJob(jobParams);
        if (assignedTeeAddress == address(0)) {
            emit TeeAssignmentFailed(jobId, reason);
            return address(0);
        }
        job.teePoolAddress = address(teePoolAddress);
        emit TeeAssignmentSucceeded(jobId, address(teePoolAddress), assignedTeeAddress);
        return assignedTeeAddress;
    }

    /// @inheritdoc IComputeEngine
    function updateJobStatus(
        uint256 jobId,
        JobStatus status,
        string calldata statusMessage
    ) external override whenNotPaused {
        Job storage job = _jobs[jobId];
        /// @dev Only the Tee assigned to the job can update the status.
        /// If the assigned TEE is not active, it can still update the job status.
        if (msg.sender != job.teeAddress) {
            revert NotTee();
        }

        JobStatus currentStatus = job.status;
        if (currentStatus == JobStatus.Completed || currentStatus == JobStatus.Failed) {
            revert JobAlreadyDone();
        }
        if (status == JobStatus.Canceled || status <= currentStatus) {
            revert InvalidStatusTransition(currentStatus, status);
        }

        job.status = status;
        job.statusMessage = statusMessage;
        emit JobStatusUpdated(jobId, status, statusMessage);

        /// @dev Remove the job from the TeePool if it's completed or failed
        if (status == JobStatus.Completed || status == JobStatus.Failed) {
            IComputeEngineTeePool teePool = IComputeEngineTeePool(job.teePoolAddress);
            if (address(teePool) != address(0)) {
                teePool.removeJob(jobId);
            }
        }
    }

    /// @inheritdoc IComputeEngine
    function cancelJob(uint256 jobId) external override whenNotPaused {
        Job storage job = _jobs[jobId];

        if (job.ownerAddress != msg.sender) {
            revert NotJobOwner();
        }

        JobStatus status = job.status;

        if (status >= JobStatus.Completed) {
            revert JobLifeCycleEnded();
        }

        job.status = JobStatus.Canceled;
        emit JobCanceled(jobId);

        if (status == JobStatus.Submitted || status == JobStatus.Running) {
            IComputeEngineTeePool teePool = IComputeEngineTeePool(job.teePoolAddress);
            if (address(teePool) != address(0)) {
                teePool.removeJob(jobId);
            }
        }
    }

    ///////////////////
    ///// Payment /////
    ///////////////////

    function deposit(address token, uint256 amount) external payable override whenNotPaused {
        _deposit(msg.sender, token, amount);
    }

    function _deposit(address from, address token, uint256 amount) internal {
        if (amount == 0) {
            revert InvalidAmount();
        }

        _accountBalances[from][token] += amount;
        emit Deposit(from, token, amount);

        if (token == VANA) {
            if (msg.value != amount) {
                revert InvalidVanaAmount();
            }
            payable(address(computeEngineTreasury)).sendValue(amount);
        } else {
            /// @dev VANA is not accepted in ERC20 deposits
            if (msg.value > 0) {
                revert UnexpectedVanaDeposit();
            }
            /// @dev We do 2-step transfer to avoid the need of exposing computeEngineTreasury to the user
            IERC20(token).safeTransferFrom(from, address(this), amount);
            IERC20(token).safeTransfer(address(computeEngineTreasury), amount);
        }
    }

    function withdraw(address token, uint256 amount) external override nonReentrant whenNotPaused {
        if (amount == 0) {
            revert InvalidAmount();
        }

        if (_accountBalances[msg.sender][token] < amount) {
            revert InsufficientBalance();
        }

        unchecked {
            _accountBalances[msg.sender][token] -= amount;
        }
        emit Withdraw(msg.sender, token, amount);

        computeEngineTreasury.transfer(msg.sender, token, amount);
    }

    function balanceOf(address account, address token) external view override returns (uint256) {
        return _accountBalances[account][token];
    }

    function executePaymentRequest(
        address token,
        uint256 amount,
        bytes calldata metadata
    ) external override nonReentrant whenNotPaused {
        if (msg.sender == queryEngine) {
            _executePaymentRequestFromQueryEngine(token, amount, metadata);
        } else {
            revert UnauthorizedPaymentRequestor();
        }
    }

    function _executePaymentRequestFromQueryEngine(address token, uint256 amount, bytes calldata metadata) internal {
        (uint256 jobId, uint256 dlpId) = abi.decode(metadata, (uint256, uint256));
        Job storage job = _jobs[jobId];

        address jobOwner = _jobs[jobId].ownerAddress;
        if (jobOwner == address(0)) {
            revert JobNotFound(jobId);
        }

        /// @dev Don't check other job statuses as compute engine may delay the update of the job status
        if (job.status < JobStatus.Submitted) {
            revert JobNotSubmitted(jobId);
        }

        if (_accountBalances[jobOwner][token] < amount) {
            revert InsufficientBalance();
        }
        unchecked {
            _accountBalances[jobOwner][token] -= amount;
        }

        PaymentInfo storage _paymentInfo = _jobPayments[jobId][dlpId];
        _paymentInfo.paidAmounts[token] += amount;
        _paymentInfo.payer = jobOwner;

        emit PaymentExecuted(jobId, token, amount);

        computeEngineTreasury.transfer(msg.sender, token, amount);
    }

    function paymentInfo(uint256 jobId, uint256 dlpId, address token) external view override returns (uint256) {
        return _jobPayments[jobId][dlpId].paidAmounts[token];
    }

    function vanaPaymentInfo(uint256 jobId, uint256 dlpId) external view override returns (uint256) {
        return _jobPayments[jobId][dlpId].paidAmounts[VANA];
    }
}
