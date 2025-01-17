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

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MorphoMigrationWrapV2Adapter
 * @author Index Cooperative
 *
 * Wrap adapter that allows for migration of legacy Morpho token to new Morpho token
 * https://docs.morpho.org/governance/morpho-token/wrapping-tutorial
 */
contract MorphoMigrationWrapV2Adapter {

    address public immutable morphoWrapper;
    address public immutable legacyMorphoToken;
    address public immutable newMorphoToken;

    constructor(
        address _morphoWrapper,
        address _legacyMorphoToken,
        address _newMorphoToken
    )
        public
    {
        morphoWrapper = _morphoWrapper;
        legacyMorphoToken = _legacyMorphoToken;
        newMorphoToken = _newMorphoToken;
    }

    /* ============ External Getter Functions ============ */

    /**
     * Generates the calldata to wrap an underlying asset into a wrappedToken.
     *
     * @param _underlyingToken      Address of the legacy Morpho token
     * @param _wrappedToken         Address of the new Morpho token
     * @param _underlyingUnits      Amount of underlying units to wrap
     * @param _to                   Address to send the new Morpho tokens to
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
        returns (address, uint256, bytes memory)
    {
        require(_underlyingToken == legacyMorphoToken, "Must be a valid legacy Morpho token");
        require(_wrappedToken == newMorphoToken, "Must be a valid new Morpho token");

        bytes memory callData = abi.encodeWithSignature(
            "depositFor(address,uint256)",
            address(_to),
            _underlyingUnits
        );

        return (morphoWrapper, 0, callData);
    }

    /**
     * Returns the address to approve source tokens for wrapping.
     * @return address         Address of MORPHO wrapper
     */
    function getSpenderAddress(address /* _underlyingToken */, address /* _wrappedToken */) external view returns(address) {
        return morphoWrapper;
    }
}
