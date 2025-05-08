// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

interface IDATFactory {
    enum DATType {
        DEFAULT
    }

    function datTemplates(DATType datType) external view returns (address);
    function minCapDefault() external view returns (uint256);
    function maxCapDefault() external view returns (uint256);

    function datListValues() external view returns (address[] memory);
    function datListCount() external view returns (uint256);
    function datListAt(uint256 index) external view returns (address);

    function predictAddress(bytes32 salt) external view returns (address);

    struct VestingParams {
        address beneficiary; // receiver
        uint64 start; // unix, token generation event
        uint64 cliff; // seconds after start before first release
        uint64 duration; // TOTAL seconds for vesting period INCLUDING cliff
        uint256 amount; // token units
    }
    function createToken(
        string calldata name_,
        string calldata symbol_,
        address owner_,
        uint256 cap_,
        VestingParams[] calldata schedules,
        bytes32 salt
    ) external returns (address tokenAddr);
}
