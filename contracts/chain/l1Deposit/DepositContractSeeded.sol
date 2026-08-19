// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IDeposit} from "./interfaces/IDeposit.sol";
import {ERC165} from "./interfaces/ERC165.sol";

/// @notice Port of the canonical Ethereum deposit contract, with one change:
///         the constructor seeds BOTH `deposit_count` and the incremental
///         Merkle `branch`, so the deployed contract reproduces an existing
///         contract's `get_deposit_root()` exactly.
///
///         Seeding the count alone (as in DepositContract.sol) yields a
///         contract that reports the right count but a different root, because
///         the tree holds no leaves. Copying the branch fixes that: for a count
///         of N, `get_deposit_root()` folds branch[h] for every set bit of N,
///         so an identical (count, branch) pair gives an identical root.
contract DepositContractSeeded is Ownable2Step, IDeposit, ERC165 {
    uint constant DEPOSIT_CONTRACT_TREE_DEPTH = 32;
    uint constant MAX_DEPOSIT_COUNT = 2 ** DEPOSIT_CONTRACT_TREE_DEPTH - 1;

    // Ownable/Ownable2Step occupy slots 0 (_owner) and 1 (_pendingOwner), so the
    // deposit state below sits two slots higher than in the canonical contract.
    // That does not affect seeding, which is done via constructor arguments;
    // verify a deployment with `get_deposit_root()` / `get_branch(i)` instead of
    // by comparing raw slots against the source contract.
    bytes32[DEPOSIT_CONTRACT_TREE_DEPTH] branch;       // slots 2..33
    uint256 deposit_count;                             // slot 34
    bytes32[DEPOSIT_CONTRACT_TREE_DEPTH] zero_hashes;  // slots 35..66

    /// @notice Minimum accepted deposit, replacing the canonical hard-coded
    ///         1 ether floor. Settable by the owner; the deposit logic and the
    ///         seeded tree are fixed at deployment, and the contract is not
    ///         upgradeable, so this is the only mutable parameter.
    uint256 public minDepositAmount;                   // slot 67

    /// @notice While true, only allow-listed validator public keys may deposit.
    bool public restricted;                            // slot 68

    struct Validator {
        bool isAllowed;
    }

    /// @notice Allow-list consulted only while `restricted` is true.
    mapping(bytes pubkey => Validator validator) public validators;  // slot 69

    event MinDepositAmountUpdated(uint256 newMinDepositAmount);
    event RestrictedUpdated(bool newRestricted);
    event AllowedValidatorsAdded(bytes validatorPublicKey);
    event AllowedValidatorsRemoved(bytes validatorPublicKey);

    constructor(
        uint256 initial_deposit_count,
        bytes32[DEPOSIT_CONTRACT_TREE_DEPTH] memory initial_branch,
        uint256 _minDepositAmount,
        address ownerAddress,
        bool initialRestricted,
        bytes[] memory initialAllowedValidators
    ) Ownable(ownerAddress) {
        for (uint height = 0; height < DEPOSIT_CONTRACT_TREE_DEPTH - 1; height++)
            zero_hashes[height + 1] = sha256(
                abi.encodePacked(zero_hashes[height], zero_hashes[height])
            );
        deposit_count = initial_deposit_count;
        for (uint i = 0; i < DEPOSIT_CONTRACT_TREE_DEPTH; i++)
            branch[i] = initial_branch[i];
        minDepositAmount = _minDepositAmount;
        restricted = initialRestricted;
        for (uint i = 0; i < initialAllowedValidators.length; ++i)
            validators[initialAllowedValidators[i]].isAllowed = true;
    }

    /**
     * @notice Updates the minDepositAmount
     *
     * @param newMinDepositAmount                  new minDepositAmount
     */
    function updateMinDepositAmount(uint256 newMinDepositAmount) external onlyOwner {
        minDepositAmount = newMinDepositAmount;

        emit MinDepositAmountUpdated(newMinDepositAmount);
    }

    /**
     * @notice Updates the restricted
     *
     * @param _restricted                  new restricted
     */
    function updateRestricted(bool _restricted) external onlyOwner {
        restricted = _restricted;

        emit RestrictedUpdated(_restricted);
    }

    function addAllowedValidators(bytes[] memory validatorPublicKeys) external onlyOwner {
        for (uint i = 0; i < validatorPublicKeys.length; ++i) {
            validators[validatorPublicKeys[i]].isAllowed = true;

            emit AllowedValidatorsAdded(validatorPublicKeys[i]);
        }
    }

    function removeAllowedValidators(bytes[] memory validatorPublicKeys) external onlyOwner {
        for (uint i = 0; i < validatorPublicKeys.length; ++i) {
            validators[validatorPublicKeys[i]].isAllowed = false;

            emit AllowedValidatorsRemoved(validatorPublicKeys[i]);
        }
    }

    function get_deposit_root() external view override returns (bytes32) {
        bytes32 node;
        uint size = deposit_count;
        for (uint height = 0; height < DEPOSIT_CONTRACT_TREE_DEPTH; height++) {
            if ((size & 1) == 1)
                node = sha256(abi.encodePacked(branch[height], node));
            else
                node = sha256(abi.encodePacked(node, zero_hashes[height]));
            size /= 2;
        }
        return sha256(
            abi.encodePacked(node, to_little_endian_64(uint64(deposit_count)), bytes24(0))
        );
    }

    function get_deposit_count() external view override returns (bytes memory) {
        return to_little_endian_64(uint64(deposit_count));
    }

    /// @notice Read a branch slot, for verifying the seed took effect.
    function get_branch(uint i) external view returns (bytes32) {
        return branch[i];
    }

    function deposit(
        bytes calldata pubkey,
        bytes calldata withdrawal_credentials,
        bytes calldata signature,
        bytes32 deposit_data_root
    ) external payable override {
        if (restricted) {
            require(validators[pubkey].isAllowed, "DepositContract: publicKey not allowed");
        }

        require(pubkey.length == 48, "DepositContract: invalid pubkey length");
        require(
            withdrawal_credentials.length == 32,
            "DepositContract: invalid withdrawal_credentials length"
        );
        require(signature.length == 96, "DepositContract: invalid signature length");
        require(msg.value >= minDepositAmount, "DepositContract: deposit value too low");
        require(msg.value % 1 gwei == 0, "DepositContract: deposit value not multiple of gwei");
        uint deposit_amount = msg.value / 1 gwei;
        require(deposit_amount <= type(uint64).max, "DepositContract: deposit value too high");

        bytes memory amount = to_little_endian_64(uint64(deposit_amount));

        emit DepositEvent(
            pubkey,
            withdrawal_credentials,
            amount,
            signature,
            to_little_endian_64(uint64(deposit_count))
        );

        bytes32 pubkey_root = sha256(abi.encodePacked(pubkey, bytes16(0)));
        bytes32 signature_root = sha256(
            abi.encodePacked(
                sha256(abi.encodePacked(signature[:64])),
                sha256(abi.encodePacked(signature[64:], bytes32(0)))
            )
        );
        bytes32 node = sha256(
            abi.encodePacked(
                sha256(abi.encodePacked(pubkey_root, withdrawal_credentials)),
                sha256(abi.encodePacked(amount, bytes24(0), signature_root))
            )
        );

        require(
            node == deposit_data_root,
            "DepositContract: reconstructed DepositData does not match supplied deposit_data_root"
        );
        require(deposit_count < MAX_DEPOSIT_COUNT, "DepositContract: merkle tree full");

        deposit_count += 1;
        uint size = deposit_count;
        for (uint height = 0; height < DEPOSIT_CONTRACT_TREE_DEPTH; height++) {
            if ((size & 1) == 1) {
                branch[height] = node;
                return;
            }
            node = sha256(abi.encodePacked(branch[height], node));
            size /= 2;
        }
        assert(false);
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(ERC165).interfaceId || interfaceId == type(IDeposit).interfaceId;
    }

    function to_little_endian_64(uint64 value) internal pure returns (bytes memory ret) {
        ret = new bytes(8);
        bytes8 bytesValue = bytes8(value);
        ret[0] = bytesValue[7];
        ret[1] = bytesValue[6];
        ret[2] = bytesValue[5];
        ret[3] = bytesValue[4];
        ret[4] = bytesValue[3];
        ret[5] = bytesValue[2];
        ret[6] = bytesValue[1];
        ret[7] = bytesValue[0];
    }
}
