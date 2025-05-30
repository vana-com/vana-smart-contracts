// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IVanaPoolEntity} from "../../vanaPoolEntity/interfaces/IVanaPoolEntity.sol";
import {IVanaPoolTreasury} from "../../vanaPoolTreasury/interfaces/IVanaPoolTreasury.sol";

interface IVanaPoolStaking {
    struct StakerEntity {
        uint256 shares;
    }

    struct Staker {
        mapping(uint256 entityId => StakerEntity entity) entities;
    }

    function version() external pure returns (uint256);
    function vanaPoolEntity() external view returns (IVanaPoolEntity);
    function vanaPoolTreasury() external view returns (IVanaPoolTreasury);
    function minStakeAmount() external view returns (uint256);

    function stake(uint256 entityId, address recipient, uint256 shareAmountMin) external payable;
    function unstake(uint256 entityId, uint256 amount, uint256 vanaAmountMin) external;

    function activeStakersListCount() external view returns (uint256);
    function activeStakersListValues(uint256 from, uint256 to) external view returns (address[] memory);
    function activeStakersListAt(uint256 index) external view returns (address);
    function inactiveStakersListCount() external view returns (uint256);
    function inactiveStakersListValues(uint256 from, uint256 to) external view returns (address[] memory);
    function inactiveStakersListAt(uint256 index) external view returns (address);
    function stakerEntities(address staker, uint256 entityId) external view returns (StakerEntity memory);

    function pause() external;
    function unpause() external;
    function updateVanaPoolEntity(address newVanaPoolEntityAddress) external;
    function updateVanaPoolTreasury(address newVanaPoolTreasuryAddress) external;
    function updateMinStakeAmount(uint256 newMinStake) external;

    function registerEntityStake(uint256 entityId, address ownerAddress, uint256 registrationStake) external;
}
