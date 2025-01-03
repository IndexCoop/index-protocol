// SPDX-License-Identifier: Apache License, Version 2.0
pragma solidity 0.6.10;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ISetToken } from "../../interfaces/ISetToken.sol";
import { IClaimV2Adapter } from "../../interfaces/IClaimV2Adapter.sol";

contract ClaimAdapterMockV2 is ERC20, IClaimV2Adapter {
    /* ============ State Variables ============ */
    uint256 public rewards;
    bytes public lastClaimData;

    /* ============ Constructor ============ */
    constructor() public ERC20("ClaimAdapterV2", "CLAIMV2") {}

    /* ============ External Functions ============ */
    function setRewards(uint256 _rewards) external {
        rewards = _rewards;
    }

    function mint(bytes memory _claimData) external {
        lastClaimData = _claimData;
        _mint(msg.sender, rewards);
    }

    function getClaimCallData(
        ISetToken _setToken,
        address _rewardPool,
        bytes memory _claimData
    )
        external
        view
        override
        returns (address _subject, uint256 _value, bytes memory _callData)
    {
        // Quell compiler warnings about unused vars
        _setToken;
        _rewardPool;

        bytes memory callData = abi.encodeWithSignature("mint(bytes)", _claimData);
        return (address(this), 0, callData);
    }

    function getRewardsAmount(
        ISetToken _setToken,
        address _rewardPool
    )
        external
        view
        override
        returns (uint256)
    {
        // Quell compiler warnings about unused vars
        _setToken;
        _rewardPool;

        return rewards;
    }

    function getTokenAddress(address _rewardPool)
        external
        view
        override
        returns (IERC20)
    {
        // Quell compiler warnings about unused vars
        _rewardPool;

        return this;
    }
} 