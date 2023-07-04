/*
    Copyright 2023 Index Coop

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

    SPDX-License-Identifier: Apache License, Version 2.0
*/
pragma solidity 0.6.10;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ISetToken } from "./ISetToken.sol";

/**
 * @title  IAuctionPriceAdapterV1
 * @author Index Coop
 * @notice Interface for price adapter implementations for AuctionRebalanceModuleV1.
 *         Implementations provide a custom price curve for an auction based on various parameters such as
 *         target auction, time, quantity, and adapter-specific parameters.
 */
interface IAuctionPriceAdapterV1 {

    /**
     * @dev Calculates and returns the current price of a component based on the given parameters.
     *
     * @param _setToken                 Instance of the SetToken being rebalanced.
     * @param _component                Instance of the component token being priced.
     * @param _componentQuantity        Quantity of the component being priced.
     * @param _timeElapsed              Time elapsed in seconds since the start of the auction.
     * @param _duration                 Duration of the auction in seconds.
     * @param _priceAdapterConfigData   Encoded data for configuring the price adapter.
     *
     * @return price                    Calculated current component price.
     */
    function getPrice(
        ISetToken _setToken,
        IERC20 _component,
        uint256 _componentQuantity,
        uint256 _timeElapsed,
        uint256 _duration,
        bytes memory _priceAdapterConfigData
    )
        external
        view
        returns (uint256 price);

    /**
     * @dev Returns true if the price adapter is valid for the given parameters.
     * 
     * @param _priceAdapterConfigData   Encoded data for configuring the price adapter.
     * 
     * @return isValid                  Whether the price adapter is valid.
     */
    function isPriceAdapterConfigDataValid(
        bytes memory _priceAdapterConfigData
    )
        external
        view
        returns (bool isValid);
}
