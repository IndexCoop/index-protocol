/*
    Copyright 2024 Index Cooperative

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

    SPDX-License-Identifier: Apache-2.0	
*/

pragma solidity 0.6.10;
pragma experimental "ABIEncoderV2";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ISetToken } from "../../../interfaces/ISetToken.sol";
import { IClaimV2Adapter } from "../../../interfaces/IClaimV2Adapter.sol";

/**
 * @title MorphoClaimV2Adapter
 * @author Index Cooperative
 *
 * Claim adapter for claiming Morpho rewards using arbitrary claim data from the Morpho API.
 * Integrates with Morpho's Universal Rewards Distributor contract.
 * Documentation: https://docs.morpho.org/rewards/tutorials/claim-rewards
 */
contract MorphoClaimV2Adapter is IClaimV2Adapter {
    /* ============ State Variables ============ */

    // Address of the Morpho Universal Rewards Distributor contract
    address public immutable distributor;
    // Address of the reward token being distributed
    IERC20 public immutable rewardToken;

    /* ============ Constructor ============ */

    /**
     * @param _distributor    Address of Morpho Universal Rewards Distributor
     * @param _rewardToken    Address of reward token being distributed
     */
    constructor(address _distributor, IERC20 _rewardToken) public {
        distributor = _distributor;
        rewardToken = _rewardToken;
    }

    /* ============ External Functions ============ */

    /**
     * Returns the calldata for claiming Morpho rewards using data from the Morpho API
     * Claim data can be obtained from: https://rewards.morpho.org/v1/users/{address}/distributions
     * 
     * @param _setToken     Set token address that will receive the rewards
     * @param _claimData    Raw claim data from Morpho API containing:
     *                      - claimable: Amount of rewards claimable
     *                      - proof: Merkle proof verifying the claim
     *                      Format: abi.encode(uint256 claimable, bytes32[] proof)
     * @return address      The distributor contract address
     * @return uint256      The ETH value to send (always 0)
     * @return bytes        The encoded claim function call
     */
    function getClaimCallData(
        ISetToken _setToken,
        address /* _rewardPool */,
        bytes calldata _claimData
    )
        external
        view
        override
        returns (address, uint256, bytes memory)
    {
        // Decode claim data parameters from Morpho API response
        (uint256 claimable, bytes32[] memory proof) = abi.decode(_claimData, (uint256, bytes32[]));

        // Encode the claim function call with parameters required by the distributor
        bytes memory callData = abi.encodeWithSignature(
            "claim(address,address,uint256,bytes32[])",
            address(_setToken),    // account receiving rewards
            address(rewardToken),  // reward token being claimed
            claimable,            // amount of rewards to claim
            proof                 // merkle proof verifying the claim
        );

        return (distributor, 0, callData);
    }

    /**
     * Returns claimable rewards for SetToken
     * Note: Claimable amounts must be fetched from Morpho API at:
     * https://rewards.morpho.org/v1/users/{address}/distributions
     */
    function getRewardsAmount(
        ISetToken /* _setToken */,
        address /* _rewardPool */
    )
        external
        view
        override
        returns (uint256)
    {
        // Rewards amount must be fetched from Morpho API
        return 0;
    }

    /**
     * Returns the reward token address being distributed
     */
    function getTokenAddress(address /* _rewardPool */)
        external
        view
        override
        returns (IERC20)
    {
        return rewardToken;
    }
}
