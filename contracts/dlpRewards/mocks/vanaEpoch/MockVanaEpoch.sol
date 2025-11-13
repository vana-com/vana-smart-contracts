// contracts/mocks/MockVanaEpoch.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title MockVanaEpoch
 * @notice Lightweight mock for testing - skips expensive operations
 */
contract MockVanaEpoch {
    uint256 public epochsCount;
    
    struct Epoch {
        uint256 id;
        bool isFinalized;
    }
    
    mapping(uint256 => Epoch) public epochs;
    
    constructor() {
        // Create initial epoch
        epochsCount = 1;
        epochs[1] = Epoch({
            id: 1,
            isFinalized: true
        });
    }
    
    function createEpochs() external {
        // Mock: Do nothing or create minimal epochs
        // This prevents hanging in tests
    }
    
    function version() external pure returns (uint256) {
        return 1;
    }
}
