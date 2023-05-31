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
import { ISetToken } from "../../../interfaces/ISetToken.sol";
import { IAuctionPriceAdapterV1 } from "../../../interfaces/IAuctionPriceAdapterV1.sol";

/**
 * @title ConstantPriceAdapter
 * @author Index Coop
 * @notice Price adapter for the AuctionRebalanceModuleV1 that returns a constant price
 */
contract ConstantPriceAdapter is IAuctionPriceAdapterV1 {

    /**
     * @dev Returns the constant price decoded from the priceAdapterData
     * 
     * @param priceAdapterData     Bytes encoded constant price
     */
    function getPrice(
        ISetToken /* setToken */,
        IERC20 /* component */,
        uint256 /* componentQuantity */,
        uint256 /* timeElapsed */,
        uint256 /* duration */,
        bytes memory priceAdapterData
    )
        external
        view
        override
        returns (uint256 price)
    {
        price = _getDecodedData(priceAdapterData);
    }

    /**
     * @dev Returns the constant price decoded from bytes
     * 
     * @param _data     Bytes encoded constant price
     */
    function getDecodedData(bytes memory _data) external pure returns (uint256) {
        return _getDecodedData(_data);
    }

    /**
     * @dev Returns the constant price encoded in bytes
     * 
     * @param _price     Constant price
     */
    function getEncodedData(uint256 _price) external pure returns (bytes memory) {
        return abi.encode(_price);
    }

    /**
     * @dev Helper to decode constant price from bytes
     * 
     * @param _data     Bytes encoded constant price
     */
    function _getDecodedData(bytes memory _data) internal pure returns (uint256) {
        return abi.decode(_data, (uint256));
    }
}
