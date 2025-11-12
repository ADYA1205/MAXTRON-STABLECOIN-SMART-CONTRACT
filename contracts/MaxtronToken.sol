// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MaxtronToken is ERC20, ERC20Burnable, Ownable {
    uint8 private constant _DECIMALS = 18;
    uint256 public constant INITIAL_SUPPLY = 75_000_000 * (10 ** uint256(_DECIMALS));

    constructor(address treasury) ERC20("Maxtron", "MAXTRON") Ownable(msg.sender) {
        require(treasury != address(0), "treasury=0");
        _mint(treasury, INITIAL_SUPPLY);
    }

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }
}