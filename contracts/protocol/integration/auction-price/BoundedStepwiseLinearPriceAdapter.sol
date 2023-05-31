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
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ISetToken } from "../../../interfaces/ISetToken.sol";
import { IAuctionPriceAdapterV1 } from "../../../interfaces/IAuctionPriceAdapterV1.sol";

/**
 * @title BoundedStepwiseLinearPriceAdapter
 * @author Index Coop
 * @notice Price adapter for the AuctionRebalanceModuleV1 that implements a 
 * price curve that increases/decreases linearly in steps over time
 * within a bounded range.
 */
contract BoundedStepwiseLinearPriceAdapter is IAuctionPriceAdapterV1 {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SafeMath for uint256;
    using Math for uint256;

    /**
     * @dev Returns the price based on the timeElapsed and price curve
     * parameters decoded from the priceAdapterData
     * 
     * @param timeElapsed          Time elapsed since start of auction
     * @param priceAdapterData     Bytes encoded auction parameters
     */
    function getPrice(
        ISetToken /* setToken */,
        IERC20 /* component */,
        uint256 /* componentQuantity */,
        uint256 timeElapsed,
        uint256 /*  duration */,
        bytes memory priceAdapterData
    )
        external
        view
        override
        returns (uint256 price)
    {
        (
            uint256 initialPrice,
            uint256 bucketSlope,
            uint256 bucketSize,
            bool isDecreasing,
            uint256 maxPrice,
            uint256 minPrice
        ) = _getDecodedData(priceAdapterData);

        uint256 bucket = timeElapsed.div(bucketSize);
        uint256 priceChange = bucket.mul(bucketSlope);

        price = isDecreasing
            ? initialPrice.sub(priceChange)
            : initialPrice.add(priceChange);

        price = price.max(minPrice).min(maxPrice);
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
        returns (uint256, uint256, uint256, bool, uint256, uint256)
    {
        return _getDecodedData(_data);
    }

    /**
     * @dev Returns the encoded data for the price curve parameters
     * 
     * @param _initialPrice      Initial price of the auction
     * @param _bucketSlope       Amount for the linear price change each bucket
     * @param _bucketSize        Time elapsed between each bucket
     * @param _isDecreasing      Flag for whether the price is decreasing or increasing
     * @param _maxPrice          Maximum price of the auction
     * @param _minPrice          Minimum price of the auction
     */
    function getEncodedData(
        uint256 _initialPrice,
        uint256 _bucketSlope,
        uint256 _bucketSize,
        bool _isDecreasing,
        uint256 _maxPrice,
        uint256 _minPrice
    )
        external 
        pure
        returns (bytes memory) 
    {
        return abi.encode(_initialPrice, _bucketSlope, _bucketSize, _isDecreasing, _maxPrice, _minPrice);
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
        returns (uint256, uint256, uint256, bool, uint256, uint256) 
    {
        return abi.decode(_data, (uint256, uint256, uint256, bool, uint256, uint256));
    }
}
