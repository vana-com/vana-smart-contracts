// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ERC3009Mock
 * @notice Minimal EIP-3009 token mirroring Circle FiatTokenV2 semantics for
 *         `receiveWithAuthorization`: EIP-712 signature check, (from, nonce)
 *         replay state, validity window, and the `msg.sender == to` payee guard.
 */
contract ERC3009Mock is ERC20, EIP712 {
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        keccak256(
            "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );

    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    /// @notice Basis points burned from the recipient after an authorized
    ///         transfer — simulates a token where less than `value` arrives,
    ///         to exercise the escrow's balance-diff crediting.
    uint256 public skimBps;

    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error AuthorizationAlreadyUsed();
    error CallerMustBePayee();
    error InvalidAuthorizationSignature();

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    constructor() ERC20("Mock USDC", "mUSDC") EIP712("Mock USDC", "1") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setSkimBps(uint256 skimBps_) external {
        skimBps = skimBps_;
    }

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (msg.sender != to) revert CallerMustBePayee();
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (_authorizationStates[from][nonce]) revert AuthorizationAlreadyUsed();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
            )
        );
        if (ECDSA.recover(digest, v, r, s) != from) revert InvalidAuthorizationSignature();

        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);

        _transfer(from, to, value);

        uint256 skim = (value * skimBps) / 10_000;
        if (skim > 0) {
            _burn(to, skim);
        }
    }
}
