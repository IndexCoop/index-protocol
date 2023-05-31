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
 * @title IAuctionPriceAdapterV1
 * @author Index Coop
 * @notice Price adapter interface for the AuctionRebalanceModuleV1. Implementations
 * give an arbitrary price curve for an auction which depends on target auction,
 * time, quantity, and arbitrary adapter specific parameters.
 */
interface IAuctionPriceAdapterV1 {

    /**
     * @dev Returns the price based on the target auction, time, quantity, 
     * and price curve parameters decoded from the priceAdapterData
     * 
     * @param setToken             Instance of the SetToken being rebalanced
     * @param component            Instance of the component being priced
     * @param componentQuantity    Amount of component being priced
     * @param timeElapsed          Time elapsed since start of auction
     * @param duration             Length of auction
     * @param priceAdapterData     Bytes encoded auction parameters
     * 
     * @return                     Calculated current component price
     */
    function getPrice(
        ISetToken setToken,
        IERC20 component,
        uint256 componentQuantity,
        uint256 timeElapsed,
        uint256 duration,
        bytes memory priceAdapterData
    )
        external
        view
        returns (uint256);
}
