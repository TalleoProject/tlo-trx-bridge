all: WrappedTalleoToken_sol_WrappedTalleoToken.abi TokenSwap_sol_TokenSwap.abi

SafeMath.sol: ../node_modules/@openzeppelin/contracts/math/SafeMath.sol
	@cp ../node_modules/@openzeppelin/contracts/math/SafeMath.sol SafeMath.sol

WrappedTalleoToken_sol_WrappedTalleoToken.abi: WrappedTalleoToken.sol ITRC20.sol SafeMath.sol
	@../node_modules/solc/solcjs --abi wrappedTalleoToken.sol ITRC20.sol SafeMath.sol

TokenSwap_sol_TokenSwap.abi: TokenSwap.sol ITRC20.sol SafeMath.sol
	@../node_modules/solc/solcjs --abi TokenSwap.sol ITRC20.sol SafeMath.sol
