// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "./interfaces/TeePoolStorageV1.sol";

contract TeePoolImplementation is
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    MulticallUpgradeable,
    ERC2771ContextUpgradeable,
    TeePoolStorageV1
{
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");

    /**
     * @notice Triggered when a job has been submitted
     *
     * @param jobId                             id of the job
     * @param fileId                            id of the file
     * @param teeAddress                        address of the tee
     * @param bidAmount                         bid amount
     */
    event JobSubmitted(uint256 indexed jobId, uint256 indexed fileId, address teeAddress, uint256 bidAmount);

    /**
     * @notice Triggered when a job has been cancelled
     *
     * @param jobId                             id of the job
     */
    event JobCanceled(uint256 indexed jobId);

    /**
     * @notice Triggered when a proof has been added
     *
     * @param attestator                         address of the attestator
     * @param jobId                             id of the job
     * @param fileId                            id of the file
     */
    event ProofAdded(address indexed attestator, uint256 indexed jobId, uint256 indexed fileId);

    /**
     * @notice Triggered when a tee has been added
     *
     * @param teeAddress                        address of the tee
     */
    event TeeAdded(address indexed teeAddress);

    /**
     * @notice Triggered when a tee has been removed
     *
     * @param teeAddress                        address of the tee
     */
    event TeeRemoved(address indexed teeAddress);

    /**
     * @notice Triggered when a claim has been made
     *
     * @param teeAddress                        address of the tee
     * @param amount                            amount claimed
     */
    event Claimed(address indexed teeAddress, uint256 amount);

    error TeeAlreadyAdded();
    error TeeNotActive();
    error JobCompleted();
    error InvalidJobStatus();
    error InvalidJobTee();
    error NothingToClaim();
    error InsufficientFee();
    error NoActiveTee();
    error NotJobOwner();
    error CancelDelayNotPassed();
    error TransferFailed();

    modifier onlyActiveTee() {
        if (!(_tees[_msgSender()].status == TeeStatus.Active)) {
            revert TeeNotActive();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() ERC2771ContextUpgradeable(address(0)) {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     *
     * @param trustedForwarderAddress           address of the trusted forwarder
     * @param ownerAddress                      address of the owner
     * @param dataRegistryAddress               address of the data registry contract
     * @param initialCancelDelay                initial cancel delay
     */
    function initialize(
        address trustedForwarderAddress,
        address ownerAddress,
        address dataRegistryAddress,
        uint256 initialCancelDelay
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        _trustedForwarder = trustedForwarderAddress;
        dataRegistry = IDataRegistry(dataRegistryAddress);
        cancelDelay = initialCancelDelay;

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
     * @notice Returns the details of the job
     *
     * @param jobId                             id of the job
     * @return Job                              details of the job
     */
    function jobs(uint256 jobId) external view override returns (Job memory) {
        return _jobs[jobId];
    }

    /**
     * @notice Returns the details of the tee
     *
     * @param teeAddress                        address of the tee
     * @return TeeDetails                       details of the tee
     */
    function tees(address teeAddress) public view override returns (TeeInfo memory) {
        return
            TeeInfo({
                teeAddress: teeAddress,
                url: _tees[teeAddress].url,
                status: _tees[teeAddress].status,
                amount: _tees[teeAddress].amount,
                withdrawnAmount: _tees[teeAddress].withdrawnAmount,
                jobsCount: _tees[teeAddress].jobIdsList.length(),
                publicKey: _tees[teeAddress].publicKey
            });
    }

    /**
     * @notice Returns a paginated list of jobs for the given tee
     *
     * @param teeAddress                        address of the tee
     * @param start                             start index
     * @param limit                             limit
     * @return uint256[]                        list of job ids
     */
    function teeJobIdsPaginated(
        address teeAddress,
        uint256 start,
        uint256 limit
    ) external view override returns (uint256[] memory) {
        EnumerableSet.UintSet storage teeJobs = _tees[teeAddress].jobIdsList;

        uint256 teeJobsCount = teeJobs.length();

        if (start >= teeJobsCount) {
            return new uint256[](0);
        }

        uint256 end = start + limit > teeJobsCount ? teeJobsCount : start + limit;

        uint256[] memory jobList = new uint256[](end - start);
        for (uint256 i = start; i < end; i++) {
            jobList[i - start] = teeJobs.at(i);
        }

        return jobList;
    }

    /**
     * @notice Returns the number of tees
     */
    function teesCount() external view override returns (uint256) {
        return _teeList.length();
    }

    /**
     * @notice Returns the list of tees
     */
    function teeList() external view override returns (address[] memory) {
        return _teeList.values();
    }

    /**
     * @notice Returns the details of the tee at the given index
     *
     * @param index                             index of the tee
     * @return TeeDetails                       details of the tee
     */
    function teeListAt(uint256 index) external view override returns (TeeInfo memory) {
        return tees(_teeList.at(index));
    }

    /**
     * @notice Returns the number of active tees
     */
    function activeTeesCount() external view override returns (uint256) {
        return _activeTeeList.length();
    }

    /**
     * @notice Returns the list of active tees
     */
    function activeTeeList() external view override returns (address[] memory) {
        return _activeTeeList.values();
    }

    /**
     * @notice Returns the details of the active tee at the given index
     *
     * @param index                             index of the tee
     * @return TeeDetails                       details of the tee
     */
    function activeTeeListAt(uint256 index) external view override returns (TeeInfo memory) {
        return tees(_activeTeeList.at(index));
    }

    function isTee(address teeAddress) external view override returns (bool) {
        return _tees[teeAddress].status == TeeStatus.Active;
    }

    /**
     * @notice Returns a list of job ids for the given file
     */
    function fileJobIds(uint256 fileId) external view override returns (uint256[] memory) {
        return _fileJobsIds[fileId].values();
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
     * @notice Updates the file registry
     *
     * @param newDataRegistry                   new file registry
     */
    function updateDataRegistry(IDataRegistry newDataRegistry) external override onlyRole(MAINTAINER_ROLE) {
        dataRegistry = newDataRegistry;
    }

    /**
     * @notice Updates the tee fee
     *
     * @param newTeeFee                         new fee
     */
    function updateTeeFee(uint256 newTeeFee) external override onlyRole(MAINTAINER_ROLE) {
        teeFee = newTeeFee;
    }

    /**
     * @notice Updates the cancel delay
     *
     * @param newCancelDelay                    new cancel delay
     */
    function updateCancelDelay(uint256 newCancelDelay) external override onlyRole(MAINTAINER_ROLE) {
        cancelDelay = newCancelDelay;
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
     * @notice Adds a tee to the pool
     *
     * @param teeAddress                        address of the tee
     * @param url                               url of the tee
     * @param publicKey                         public key of the tee
     */
    function addTee(
        address teeAddress,
        string calldata url,
        string calldata publicKey
    ) external override onlyRole(MAINTAINER_ROLE) {
        if (_activeTeeList.contains(teeAddress)) {
            revert TeeAlreadyAdded();
        }
        _teeList.add(teeAddress);
        _activeTeeList.add(teeAddress);
        _tees[teeAddress].status = TeeStatus.Active;
        _tees[teeAddress].url = url;
        _tees[teeAddress].publicKey = publicKey;

        emit TeeAdded(teeAddress);
    }

    /**
     * @notice Removes a tee from the pool
     *
     * @param teeAddress                        address of the tee
     */
    function removeTee(address teeAddress) external override onlyRole(MAINTAINER_ROLE) {
        if (!_activeTeeList.contains(teeAddress)) {
            revert TeeNotActive();
        }

        _tees[teeAddress].status = TeeStatus.Removed;
        _activeTeeList.remove(teeAddress);

        emit TeeRemoved(teeAddress);
    }

    /**
     * @notice Adds a contribution proof request
     *
     * @param fileId                            id of the file
     */
    function requestContributionProof(uint256 fileId) public payable override whenNotPaused {
        if (msg.value < teeFee) {
            revert InsufficientFee();
        }

        if (_activeTeeList.length() == 0) {
            revert NoActiveTee();
        }

        uint256 jobsCountTemp = ++jobsCount;

        address teeAddress = tees(_activeTeeList.at(jobsCountTemp % _activeTeeList.length())).teeAddress;

        _jobs[jobsCountTemp].fileId = fileId;
        _jobs[jobsCountTemp].bidAmount = msg.value;
        _jobs[jobsCountTemp].addedTimestamp = block.timestamp;
        _jobs[jobsCountTemp].ownerAddress = _msgSender();
        _jobs[jobsCountTemp].status = JobStatus.Submitted;
        _jobs[jobsCountTemp].teeAddress = teeAddress;

        _fileJobsIds[fileId].add(jobsCountTemp);

        _tees[teeAddress].jobIdsList.add(jobsCountTemp);

        emit JobSubmitted(jobsCountTemp, fileId, teeAddress, msg.value);
    }

    /**
     * @notice Submits a contribution proof request
     *
     * @param fileId                            id of the file
     */
    function submitJob(uint256 fileId) external payable override whenNotPaused {
        requestContributionProof(fileId);
    }

    /**
     * @notice Cancels a contribution proof request
     *
     * @param jobId                            id of the job
     */
    function cancelJob(uint256 jobId) external override nonReentrant whenNotPaused {
        Job storage job = _jobs[jobId];
        if (job.ownerAddress != _msgSender()) {
            revert NotJobOwner();
        }

        if (job.status != JobStatus.Submitted) {
            revert InvalidJobStatus();
        }

        if (job.addedTimestamp + cancelDelay > block.timestamp) {
            revert CancelDelayNotPassed();
        }

        job.status = JobStatus.Canceled;
        _tees[job.teeAddress].jobIdsList.remove(jobId);

        (bool success, ) = payable(_msgSender()).call{value: job.bidAmount}("");
        if (!success) {
            revert TransferFailed();
        }

        emit JobCanceled(jobId);
    }

    /**
     * @notice Adds a proof to the file
     *
     * @param jobId                             id of the job
     * @param proof                             proof for the file
     */
    function addProof(uint256 jobId, IDataRegistry.Proof memory proof) external override onlyActiveTee whenNotPaused {
        Job storage job = _jobs[jobId];

        if (job.status != JobStatus.Submitted) {
            revert InvalidJobStatus();
        }

        if (job.teeAddress != _msgSender()) {
            revert InvalidJobTee();
        }

        dataRegistry.addProof(job.fileId, proof);

        _tees[_msgSender()].amount += job.bidAmount;

        _tees[_msgSender()].jobIdsList.remove(jobId);

        job.status = JobStatus.Completed;

        emit ProofAdded(_msgSender(), jobId, job.fileId);
    }

    /**
     * @notice method used by tees for claiming their rewards
     */
    function claim() external nonReentrant whenNotPaused {
        uint256 amount = _tees[_msgSender()].amount - _tees[_msgSender()].withdrawnAmount;

        if (amount == 0) {
            revert NothingToClaim();
        }

        _tees[_msgSender()].withdrawnAmount = _tees[_msgSender()].amount;

        (bool success, ) = payable(_msgSender()).call{value: amount}("");
        if (!success) {
            revert TransferFailed();
        }

        emit Claimed(_msgSender(), amount);
    }
}
