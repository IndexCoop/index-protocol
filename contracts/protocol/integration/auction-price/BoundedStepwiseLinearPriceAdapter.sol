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

import { Math } from "@openzeppelin/contracts/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

import { ISetToken } from "../../../interfaces/ISetToken.sol";
import { IAuctionPriceAdapterV1 } from "../../../interfaces/IAuctionPriceAdapterV1.sol";

/**
 * @title BoundedStepwiseLinearPriceAdapter
 * @author Index Coop
 * @notice Price adapter contract for the AuctionRebalanceModuleV1, returns a price that
 * increases or decreases linearly in steps over time, within a bounded range.
 */
contract BoundedStepwiseLinearPriceAdapter is IAuctionPriceAdapterV1 {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SafeMath for uint256;
    using Math for uint256;

    /**
     * @dev Calculates and returns the linear price.
     *
     * @param _timeElapsed              Time elapsed since the start of the auction.
     * @param _priceAdapterConfigData   Encoded bytes representing the linear function parameters.
     *
     * @return price                    The price calculated using the linear function.
     */
    function getPrice(
        ISetToken /* _setToken */,
        IERC20 /* _component */,
        uint256 /* _componentQuantity */,
        uint256 _timeElapsed,
        uint256 /* _duration */,
        bytes memory _priceAdapterConfigData
    )
        external
        view
        override
        returns (uint256 price)
    {
        (
            uint256 initialPrice,
            uint256 slope,
            uint256 bucketSize,
            bool isDecreasing,
            uint256 maxPrice,
            uint256 minPrice
        ) = _getDecodedData(_priceAdapterConfigData);

        uint256 bucket = _timeElapsed.div(bucketSize);
        uint256 priceChange = slope.mul(bucket);

        price = isDecreasing
            ? initialPrice.sub(priceChange)
            : initialPrice.add(priceChange);

        price = price.max(minPrice).min(maxPrice);
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
        (
            uint256 initialPrice,
            ,
            uint256 bucketSize,
            ,
            uint256 maxPrice,
            uint256 minPrice
        ) = _getDecodedData(_priceAdapterConfigData);

        isValid = initialPrice > 0 &&
            bucketSize > 0 &&
            maxPrice > 0 &&
            bucketSize > 0 &&
            maxPrice >= minPrice;
    }

    /**
     * @dev Returns the auction parameters decoded from bytes
     * 
     * @param _data     Bytes encoded auction parameters
     */
    function getDecodedData(
        bytes memory _data
    )
        external
        pure
        returns (uint256 initialPrice, uint256 slope, uint256 bucketSize, bool isDecreasing, uint256 maxPrice, uint256 minPrice)
    {
        return _getDecodedData(_data);
    }

    /**
     * @dev Returns the encoded data for the price curve parameters
     * 
     * @param _initialPrice      Initial price of the auction
     * @param _slope             Slope of the linear price change
     * @param _bucketSize        Time elapsed between each bucket
     * @param _isDecreasing      Flag for whether the price is decreasing or increasing
     * @param _maxPrice          Maximum price of the auction
     * @param _minPrice          Minimum price of the auction
     */
    function getEncodedData(
        uint256 _initialPrice,
        uint256 _slope,
        uint256 _bucketSize,
        bool _isDecreasing,
        uint256 _maxPrice,
        uint256 _minPrice
    )
        external
        pure
        returns (bytes memory data)
    {
        return abi.encode(_initialPrice, _slope, _bucketSize, _isDecreasing, _maxPrice, _minPrice);
    }

    /**
     * @dev Helper to decode auction parameters from bytes
     * 
     * @param _data     Bytes encoded auction parameters
     */
    function _getDecodedData(
        bytes memory _data
    )
        internal
        pure
        returns (uint256 initialPrice, uint256 slope, uint256 bucketSize, bool isDecreasing, uint256 maxPrice, uint256 minPrice)
    {
        return abi.decode(_data, (uint256, uint256, uint256, bool, uint256, uint256));
    }
}
