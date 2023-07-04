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
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

import { ISetToken } from "../../../interfaces/ISetToken.sol";
import { IAuctionPriceAdapterV1 } from "../../../interfaces/IAuctionPriceAdapterV1.sol";
import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";

/**
 * @title ConstantPriceAdapter
 * @author Index Coop
 * @notice Price adapter contract for AuctionRebalanceModuleV1, returns a constant price.
 */
contract ConstantPriceAdapter is IAuctionPriceAdapterV1 {
    using SafeCast for uint256;
    using SafeMath for uint256;

    /**
     * @dev Calculates and returns the constant price.
     *
     * @param _priceAdapterConfigData   Encoded bytes representing the constant price.
     *
     * @return price                    The constant price decoded from _priceAdapterData.
     */
    function getPrice(
        ISetToken /* _setToken */,
        IERC20 /* _component */,
        uint256 /* _componentQuantity */,
        uint256 /* _timeElapsed */,
        uint256 /* _duration */,
        bytes memory _priceAdapterConfigData
    )
        external
        view
        override
        returns (uint256 price)
    {
        price = _getDecodedData(_priceAdapterConfigData);
    }

    /**
     * @dev Returns true if the price adapter is valid for the given parameters.
     * 
     * @param _priceAdapterConfigData   Encoded data for configuring the price adapter.
     * 
     * @return isValid                  Boolean indicating if the adapter config data is valid.
     */
    function isPriceAdapterConfigDataValid(
        bytes memory _priceAdapterConfigData
    )
        external
        view
        override
        returns (bool isValid)
    {
        uint256 price = _getDecodedData(_priceAdapterConfigData);

        isValid = price > 0;
    }

    /**
     * @dev Decodes the constant price from the provided bytes.
     *
     * @param _data  Encoded bytes representing the constant price.
     *
     * @return       The constant price decoded from bytes.
     */
    function getDecodedData(bytes memory _data) external pure returns (uint256) {
        return _getDecodedData(_data);
    }

    /**
     * @dev Encodes the constant price into bytes.
     *
     * @param _price  The constant price.
     *
     * @return        Encoded bytes representing the constant price.
     */
    function getEncodedData(uint256 _price) external pure returns (bytes memory) {
        return abi.encode(_price);
    }

    /**
     * @dev Helper function to decode the constant price from bytes.
     *
     * @param _data  Encoded bytes representing the constant price.
     *
     * @return       The constant price decoded from bytes.
     */
    function _getDecodedData(bytes memory _data) internal pure returns (uint256) {
        return abi.decode(_data, (uint256));
    }
}
