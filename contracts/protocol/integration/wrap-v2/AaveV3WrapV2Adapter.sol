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

    SPDX-License-Identifier: Apache License, Version 2.0
*/

pragma solidity 0.6.10;
pragma experimental "ABIEncoderV2";

import { IAToken } from "../../../interfaces/external/aave-v2/IAToken.sol";
import { IPool } from "../../../interfaces/external/aave-v3/IPool.sol";

/**
 * @title AaveV3WrapV2Adapter
 * @author Index Cooperative
 *
 * Wrap adapter for Aave V3 that returns data for wraps/unwraps of tokens
 */
contract AaveV3WrapV2Adapter {

    /* ============ Modifiers ============ */

    /**
     * Throws if the underlying/wrapped token pair is not valid
     */
    modifier _onlyValidTokenPair(address _underlyingToken, address _wrappedToken) {
        require(validTokenPair(_underlyingToken, _wrappedToken), "Must be a valid token pair");
        _;
    }

    /* ========== State Variables ========= */

    // Address of the Aave Pool contract
    IPool public pool;

    /* ============ Constructor ============ */

    constructor(IPool _pool) public {
        pool = _pool;
    }

    /* ============ External Getter Functions ============ */

    /**
     * Generates the calldata to wrap an underlying asset into a wrappedToken.
     *
     * @param _underlyingToken      Address of the component to be wrapped
     * @param _wrappedToken         Address of the desired aToken
     * @param _underlyingUnits      Total quantity of underlying units to wrap
     * @param _to                   Address to send the aTokens to
     *
     * @return address              Target contract address
     * @return uint256              Total quantity of underlying units (if underlying is ETH)
     * @return bytes                Wrap calldata
     */
    function getWrapCallData(
        address _underlyingToken,
        address _wrappedToken,
        uint256 _underlyingUnits,
        address _to,
        bytes memory /* _wrapData */
    )
        external
        view
        _onlyValidTokenPair(_underlyingToken, _wrappedToken)
        returns (address, uint256, bytes memory)
    {
        bytes memory callData = abi.encodeWithSignature(
            "deposit(address,uint256,address,uint16)",
            _underlyingToken,
            _underlyingUnits,
            _to,
            0
        );

        return (address(pool), 0, callData);
    }

    /**
     * Generates the calldata to unwrap a wrapped asset into its underlying.
     *
     * @param _underlyingToken      Address of the underlying asset
     * @param _wrappedToken         Address of the aToken to be unwrapped
     * @param _wrappedTokenUnits    Total quantity of aToken units to unwrap
     * @param _to                   Address to send the unwrapped tokens to
     *
     * @return address              Target contract address
     * @return uint256              Total quantity of aToken units to unwrap. This will always be 0 for unwrapping
     * @return bytes                Unwrap calldata
     */
    function getUnwrapCallData(
        address _underlyingToken,
        address _wrappedToken,
        uint256 _wrappedTokenUnits,
        address _to,
        bytes memory /* _wrapData */
    )
        external
        view
        _onlyValidTokenPair(_underlyingToken, _wrappedToken)
        returns (address, uint256, bytes memory)
    {
        bytes memory callData = abi.encodeWithSignature(
            "withdraw(address,uint256,address)",
            _underlyingToken,
            _wrappedTokenUnits,
            _to
        );

        return (address(pool), 0, callData);
    }

    /**
     * Returns the address to approve source tokens for wrapping.
     *
     * @return address        Address of the contract to approve tokens to
     */
    function getSpenderAddress(address /* _underlyingToken */, address  /* _wrappedToken */) external view returns(address) {
        return address(pool);
    }

    /* ============ Internal Functions ============ */

    /**
     * Validates the underlying and wrapped token pair
     *
     * @param _underlyingToken     Address of the underlying asset
     * @param _wrappedToken        Address of the aToken
     *
     * @return bool                Whether or not the aToken accepts the underlying token as collateral
     */
    function validTokenPair(address _underlyingToken, address _wrappedToken) internal view returns(bool) {
        return IAToken(_wrappedToken).UNDERLYING_ASSET_ADDRESS() == _underlyingToken;
    }
}
