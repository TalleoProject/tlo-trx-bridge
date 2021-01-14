// SPDX-License-Identifier: LGPL-2.0-or-later
pragma solidity >= 0.5.0 <0.7.0;
import "ITRC20.sol";
import "SafeMath.sol";

contract TokenSwap {

using SafeMath for uint256;

address payable owner;
ITRC20 firstToken;
ITRC20 secondToken;
uint256 public conversionMultiplier;
uint256 public conversionDivisor;

modifier onlyOwner() {
    require(msg.sender == owner, "Only owner can call this function.");
    _;
}

constructor(ITRC20 _first, ITRC20 _second, uint256 _conversionMultiplier, uint256 _conversionDivisor) public {
    owner = msg.sender;
    firstToken = _first;
    secondToken = _second;
    conversionMultiplier = _conversionMultiplier;
    conversionDivisor = _conversionDivisor;
}

function swap(uint256 _value) public returns (bool) {
    uint256 swapBalance = secondToken.balanceOf(address(this));
    uint256 secondValue = _value.mul(conversionMultiplier).div(conversionDivisor);
    require(secondValue > 0, "Nothing to swap");
    require(secondValue <= swapBalance, "Not enough tokens in the reserve");
    uint256 allowance = firstToken.allowance(msg.sender, address(this));
    require(allowance >= _value, "Allowance is too low");
    firstToken.transferFrom(msg.sender, address(this), _value);
    secondToken.transfer(msg.sender, secondValue);
    emit Swapped(msg.sender, _value, secondValue);
    return true;
}

function conversionRate(uint256 _multiplier, uint256 _divisor) public onlyOwner returns (bool) {
    conversionMultiplier = _multiplier;
    conversionDivisor = _divisor;
    return true;
}

event Swapped(address indexed _user, uint256 _firstValue, uint256 _secondValue);
}
