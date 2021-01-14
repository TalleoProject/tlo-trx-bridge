// SPDX-License-Identifier: LGPL-2.0-or-later
pragma solidity >= 0.5.0 <0.7.0;

import "SafeMath.sol";
import "ITRC20.sol";

contract WrappedTalleoToken is ITRC20 {

using SafeMath for uint256;

string tokenName;
string tokenSymbol;
uint8 tokenDecimals;
address payable owner;
uint256 tokenTotalSupply;
mapping(address => uint256) balances;
mapping(address => mapping(address => uint256)) allowed;

modifier onlyOwner() {
    require(msg.sender == owner, "Only owner can call this function.");
    _;
}

constructor(string memory _name, string memory _symbol, uint8 _decimals, uint256 _totalSupply) public {
    owner = msg.sender;
    tokenName = _name;
    tokenSymbol = _symbol;
    tokenDecimals = _decimals;
    tokenTotalSupply = _totalSupply;
    balances[owner] = _totalSupply;
    emit Transfer(address(0), owner, _totalSupply);
}

function name() public view returns (string memory) {
    return tokenName;
}

function symbol() public view returns (string memory) {
    return tokenSymbol;
}

function decimals() public view returns (uint8) {
    return tokenDecimals;
}

function totalSupply() public view returns (uint256) {
    return tokenTotalSupply;
}

function circulatingSupply() public view returns (uint256) {
    return tokenTotalSupply.sub(balances[owner]).sub(balances[address(this)]).sub(balances[address(0)]);
}

function balanceOf(address _owner) public view returns (uint256) {
    return balances[_owner];
}

function _transfer(address _from, address _to, uint256 _value) internal {
    require(balances[_from] >= _value);

    balances[_from] = balances[_from].sub(_value);
    balances[_to] = balances[_to].add(_value);

    emit Transfer(_from, _to, _value);
}

function transfer(address _to, uint256 _value) public returns (bool) {
    _transfer(msg.sender, _to, _value);
    return true;
}

function allowance(address _owner, address _spender) public view returns (uint256) {
    return allowed[_owner][_spender];
}

function increaseAllowance(address _spender, uint256 _addedValue) public returns (bool) {
    uint256 _value = allowed[msg.sender][_spender].add(_addedValue);
    _approve(msg.sender, _spender, _value);
    return true;
}

function decreaseAllowance(address _spender, uint256 _subtractedValue) public returns (bool) {
    uint256 _value = allowed[msg.sender][_spender].sub(_subtractedValue, "TRC20: Can't decrease allowance below zero");
    _approve(msg.sender, _spender, _value);
    return true;
}

function _approve(address _owner, address _spender, uint256 _value) internal {
    require(_owner != address(0));
    require(_spender != address(0));
    require(balances[_owner] >= _value);

    allowed[_owner][_spender] = _value;
    emit Approval(_owner, _spender, _value);
}

function approve(address _spender, uint256 _value) public returns (bool) {
    _approve(msg.sender, _spender, _value);
    return true;
}

function transferFrom(address _from, address _to, uint256 _value) public returns (bool) {
    require(allowed[_from][msg.sender] >= _value);
    _transfer(_from, _to, _value);
    allowed[_from][msg.sender] = allowed[_from][msg.sender].sub(_value);
    return true;
}

function withdrawTRC20(uint256 _value) public onlyOwner returns (bool) {
    address myAddress = address(this);
    _transfer(myAddress, msg.sender, _value);
    return true;
}

function withdrawTRC20(ITRC20 _token, uint256 _value) public onlyOwner returns (bool) {
    return _token.transfer(msg.sender, _value);
}

function withdrawTRX() public onlyOwner returns (bool) {
    require(address(this).balance > 0);
    owner.transfer(address(this).balance);
    return true;
}

function withdrawTRX(uint256 _value) public onlyOwner returns (bool) {
    require(address(this).balance >= _value);
    require(_value > 0);
    owner.transfer(_value);
    return true;
}

function sendTRX(address payable _to, uint256 _value) public onlyOwner returns (bool) {
    require(address(this).balance >= _value);
    require(_value > 0);
    _to.transfer(_value);
    return true;
}

function sendTRC20(ITRC20 _token, address _to, uint256 _value) public onlyOwner returns (bool) {
    return _token.transfer(_to, _value);
}

function Selfdestructs() public onlyOwner {
    selfdestruct(owner);
}

function convertTo(bytes memory _to, uint256 _value) public returns (bool) {
    require(_to.length == 71);
    _transfer(msg.sender, owner, _value);
    emit ConversionTo(msg.sender, _to, _value);
    return true;
}

function convertTo(address _from, bytes memory _to, uint256 _value) public onlyOwner returns (bool) {
    require(_to.length == 71);
    _transfer(_from, owner, _value);
    emit ConversionTo(_from, _to, _value);
    return true;
}

function convertFrom(bytes memory _from, address _to, uint256 _value) public onlyOwner returns (bool) {
    require(_from.length == 71);
    _transfer(owner, _to, _value);
    emit ConversionFrom(_from, _to, _value);
    return true;
}

event ConversionTo(address indexed _from, bytes _to, uint256 _value);

event ConversionFrom(bytes _from, address indexed _to, uint256 _value);
}
