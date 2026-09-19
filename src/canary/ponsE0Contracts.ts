import { parseAbi } from 'viem';

export const ponsE0CurveTradeAbi = parseAbi([
  'function factory() view returns (address)',
  'function token() view returns (address)',
  'function pairToken() view returns (address)',
  'function graduated() view returns (bool)',
  'function readyToGraduate() view returns (bool)',
  'function sellableTokens() view returns (uint256)',
  'function currentSnipeTaxBps(address recipient) view returns (uint256)',
  'function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)',
  'function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)',
  'event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)',
  'event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)'
]);

export const ponsE0TokenAbi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
]);
