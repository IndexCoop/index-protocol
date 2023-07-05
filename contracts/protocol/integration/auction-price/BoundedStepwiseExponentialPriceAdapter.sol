// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.17;

import { FixedPointMathLib } from "solady/src/utils/FixedPointMathLib.sol";

/**
 * @title BoundedStepwiseExponentialPriceAdapter
 * @author Index Coop
 * @notice Price adapter contract for the AuctionRebalanceModuleV1. It returns a price that
 * increases or decreases exponentially in steps over time, within a bounded range.
 * Rate of change is increasing.
 * price = initialPrice +/- coefficient * e ^ (exponent * bucket)
 */
contract BoundedStepwiseExponentialPriceAdapter {
    using FixedPointMathLib for int256;

    uint256 constant WAD = 1e18;
    int256 constant MAX_EXP_ARG = 100e18;

    /**
     * @dev Calculates and returns the exponential price.
     *
     * @param _timeElapsed              Time elapsed since the start of the auction.
     * @param _priceAdapterConfigData   Encoded bytes representing the exponential function parameters.
     *
     * @return price                    The price calculated using the exponential function.
     */
    function getPrice(
        address /* _setToken */,
        address /* _component */,
        uint256 /* _componentQuantity */,
        uint256 _timeElapsed,
        uint256 /* _duration */,
        bytes memory _priceAdapterConfigData
    )
        external
        pure
        returns (uint256 price)
    {
        (
            uint256 initialPrice,
            uint256 coefficient,
            uint256 exponent,
            uint256 bucketSize,
            bool isDecreasing,
            uint256 maxPrice,
            uint256 minPrice
        ) = getDecodedData(_priceAdapterConfigData);

        require(
            areParamsValid(initialPrice, coefficient, exponent, bucketSize, isDecreasing, maxPrice, minPrice), 
            "BoundedStepwiseExponentialPriceAdapter: Invalid params"
        );

        uint256 bucket = _timeElapsed / bucketSize;

        // Protect against exponential argument overflow
        if (bucket > type(uint256).max / exponent) {
            return _getBoundaryPrice(isDecreasing, maxPrice, minPrice);
        }
        int256 expArgument = int256(bucket * exponent);
        
        // Protect against exponential overflow and increasing relative error
        if (expArgument > MAX_EXP_ARG) {
            return _getBoundaryPrice(isDecreasing, maxPrice, minPrice);
        }
        uint256 expExpression = uint256(FixedPointMathLib.expWad(expArgument));

        // Protect against priceChange overflow
        if (coefficient > type(uint256).max / expExpression) {
            return _getBoundaryPrice(isDecreasing, maxPrice, minPrice);
        }
        uint256 priceChange = coefficient * expExpression - WAD;

        if (isDecreasing) {
            // Protect against price underflow
            if (priceChange > initialPrice) {
                return minPrice;
            }
            return FixedPointMathLib.max(initialPrice - priceChange , minPrice);
        } else {
            // Protect against price overflow
            if (priceChange > type(uint256).max - initialPrice) {
                return maxPrice;
            }
            return FixedPointMathLib.min(initialPrice + priceChange, maxPrice);
        }
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
        pure
        returns (bool isValid)
    {
        (
            uint256 initialPrice,
            uint256 coefficient,
            uint256 exponent,
            uint256 bucketSize,
            bool isDecreasing,
            uint256 maxPrice,
            uint256 minPrice
        ) = getDecodedData(_priceAdapterConfigData);

        return areParamsValid(initialPrice, coefficient, exponent, bucketSize, isDecreasing, maxPrice, minPrice);
    }

    /**
     * @dev Returns true if the price adapter parameters are valid.
     * 
     * @param _initialPrice      Initial price of the auction
     * @param _coefficent        Scaling factor for exponential expression
     * @param _exponent          Exponent factor for exponential expression
     * @param _bucketSize        Time elapsed between each bucket
     * @param _maxPrice          Maximum price of the auction
     * @param _minPrice          Minimum price of the auction
     */
    function areParamsValid(
        uint256 _initialPrice,
        uint256 _coefficent,
        uint256 _exponent,
        uint256 _bucketSize,
        bool /* _isDecreasing */,
        uint256 _maxPrice,
        uint256 _minPrice
    )
        public
        pure
        returns (bool)
    {
        return _initialPrice > 0
            && _coefficent > 0
            && _exponent > 0
            && _bucketSize > 0
            && _initialPrice <= _maxPrice
            && _initialPrice >= _minPrice;
    }

    /**
     * @dev Returns the encoded data for the price curve parameters
     * 
     * @param _initialPrice        Initial price of the auction
     * @param _coefficent          Scaling factor for exponential expression
     * @param _exponent            Exponent factor for exponential expression
     * @param _bucketSize          Time elapsed between each bucket
     * @param _isDecreasing        Flag for whether the price is decreasing or increasing
     * @param _maxPrice            Maximum price of the auction
     * @param _minPrice            Minimum price of the auction
     */
    function getEncodedData(
        uint256 _initialPrice,
        uint256 _coefficent,
        uint256 _exponent,
        uint256 _bucketSize,
        bool _isDecreasing,
        uint256 _maxPrice,
        uint256 _minPrice
    )
        external
        pure
        returns (bytes memory data)
    {
        return abi.encode(_initialPrice, _coefficent, _exponent, _bucketSize, _isDecreasing, _maxPrice, _minPrice);
    }

    /**
     * @dev Decodes the parameters from the provided bytes.
     *
     * @param _data                Bytes encoded auction parameters
     * @return initialPrice        Initial price of the auction
     * @return coefficient         Scaling factor for exponential expression
     * @return exponent            Exponent factor for exponential expression
     * @return bucketSize          Time elapsed between each bucket
     * @return isDecreasing        Flag for whether the price is decreasing or increasing
     * @return maxPrice            Maximum price of the auction
     * @return minPrice            Minimum price of the auction
     */
    function getDecodedData(bytes memory _data)
        public
        pure
        returns (uint256 initialPrice, uint256 coefficient, uint256 exponent, uint256 bucketSize, bool isDecreasing, uint256 maxPrice, uint256 minPrice)
    {
        return abi.decode(_data, (uint256, uint256, uint256, uint256, bool, uint256, uint256));
    }

    function _getBoundaryPrice(bool isDecreasing, uint256 maxPrice, uint256 minPrice) private pure returns (uint256) {
        return isDecreasing ? minPrice : maxPrice;
    }
}
