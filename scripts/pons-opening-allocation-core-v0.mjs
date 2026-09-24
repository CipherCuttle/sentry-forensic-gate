// Read-only, source-bound Pons V2 opening allocation evidence.
// Deliberately NOT a rug score, wallet-clustering claim, or trading authorization.
import {
  decodeEventLog, decodeFunctionData, getAddress, parseAbi, parseAbiItem, zeroAddress
} from 'viem';

const socials = 'struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }';
const tokenParams = 'struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }';
export const PONS_V2_DIRECT_LAUNCH_ABI = parseAbi([
  socials, tokenParams,
  'function launchToken(TokenParams params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)',
  'function launchToken(TokenParams params, uint256 launchConfigId, address pairToken, address[] snipeTaxExemptions) payable returns (address token, address curve)'
]);
export const PONS_V2_FORWARDER_LAUNCH_ABI = parseAbi([
  socials, tokenParams,
  'function launchAndBuy(TokenParams params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] snipeTaxExemptions) payable returns (address token, address curve, uint256 tokensOut)'
]);
export const PONS_V2_CURVE_BUY_EVENT = parseAbiItem(
  'event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)'
);
export const PONS_V2_FACTORY_FORWARDER_ABI = parseAbi([
  'function launchForwarder() view returns (address)'
]);
export const PONS_V2_TOTAL_SUPPLY_ABI = parseAbi([
  'function totalSupply() view returns (uint256)'
]);

function sameAddress(a, b) {
  return typeof a === 'string' && typeof b === 'string' &&
    a.toLowerCase() === b.toLowerCase();
}
function need(check, code) {
  if (!check) throw new Error('PONS_OPENING_' + code);
}
function address(value, label) {
  try { return getAddress(value); } catch { throw new Error('PONS_OPENING_INVALID_' + label); }
}
function key(value) {
  return address(value, 'ADDRESS').toLowerCase();
}
function sameHex(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}
function asBigInt(value, label) {
  need(typeof value === 'bigint' && value >= 0n, 'INVALID_' + label);
  return value;
}

/**
 * Process only evidence from the EXACT launch transaction and chain block.
 * Callers independently pin factory code hash, chain ID, block hash and read
 * both forwarder and factory record at the launch block; this function
 * cross-checks transaction/event/record identities and decodes known routes.
 */
export function attestPonsV2OpeningAllocation({
  transaction, receipt, launchLog, factory, forwarder, factoryRecord, totalSupply
}) {
  const reviewedFactory = address(factory, 'FACTORY');
  const reviewedForwarder = address(forwarder, 'FORWARDER');
  const hash = transaction?.hash;
  need(/^0x[0-9a-fA-F]{64}$/.test(hash ?? ''), 'TX_HASH_INVALID');
  need(sameHex(receipt?.transactionHash, hash), 'RECEIPT_TX_MISMATCH');
  need(receipt?.status === 'success', 'LAUNCH_TX_NOT_SUCCESS');
  need(typeof transaction.blockNumber === 'bigint' && transaction.blockNumber >= 0n, 'TX_BLOCK_MISSING');
  need(receipt.blockNumber === transaction.blockNumber, 'TX_RECEIPT_BLOCK_MISMATCH');
  need(sameHex(receipt.blockHash, launchLog?.blockHash), 'LAUNCH_LOG_BLOCK_MISMATCH');
  need(sameHex(launchLog?.transactionHash, hash), 'LAUNCH_LOG_TX_MISMATCH');
  need(sameAddress(launchLog?.address, reviewedFactory), 'LAUNCH_EVENT_FACTORY_MISMATCH');
  need(Array.isArray(receipt.logs) && receipt.logs.some(log =>
    sameHex(log.transactionHash, hash) &&
    sameAddress(log.address, reviewedFactory) &&
    log.logIndex === launchLog.logIndex &&
    sameHex(log.blockHash, receipt.blockHash)
  ), 'LAUNCH_LOG_NOT_IN_RECEIPT');

  const args = launchLog.args;
  need(args && typeof args === 'object', 'LAUNCH_EVENT_ARGS_MISSING');
  const token = address(args.token, 'TOKEN');
  const curve = address(args.curve, 'CURVE');
  const initiator = address(args.deployer, 'LAUNCHER');
  const pairToken = address(args.pairToken, 'PAIR');
  need(factoryRecord?.exists === true, 'FACTORY_LAUNCH_RECORD_MISSING');
  need(sameAddress(factoryRecord.token, token) &&
    sameAddress(factoryRecord.curve, curve) &&
    sameAddress(factoryRecord.deployer, initiator) &&
    sameAddress(factoryRecord.pairToken, pairToken), 'FACTORY_LAUNCH_RECORD_MISMATCH');
  const feeRecipient = address(factoryRecord.creatorFeeRecipient, 'FEE_RECIPIENT');
  const isDirect = sameAddress(transaction.to, reviewedFactory);
  const isForwarder = sameAddress(transaction.to, reviewedForwarder);
  need(isDirect !== isForwarder, 'UNKNOWN_LAUNCH_ROUTE');
  let decoded;
  try {
    decoded = decodeFunctionData({
      abi: isDirect ? PONS_V2_DIRECT_LAUNCH_ABI : PONS_V2_FORWARDER_LAUNCH_ABI,
      data: transaction.input
    });
  } catch {
    throw new Error('PONS_OPENING_UNKNOWN_CALLDATA');
  }
  need(decoded.functionName === (isDirect ? 'launchToken' : 'launchAndBuy'), 'UNEXPECTED_METHOD');
  const call = decoded.args;
  const params = call[0];
  need(call[1] === args.launchConfigId && sameAddress(call[2], pairToken),
    'LAUNCH_CONFIG_MISMATCH');
  const declaredFeeRecipient = address(params.creatorFeeRecipient, 'DECLARED_FEE_RECIPIENT');
  const effectiveFeeRecipient = isDirect && sameAddress(declaredFeeRecipient, zeroAddress) ?
    initiator : declaredFeeRecipient;
  need(sameAddress(effectiveFeeRecipient, feeRecipient), 'FEE_RECIPIENT_MISMATCH');
  need(isDirect ? (call.length === 3 || call.length === 4) : call.length === 7,
    'UNEXPECTED_CALL_ARITY');
  if (isDirect) need(sameAddress(transaction.from, initiator), 'DIRECT_LAUNCHER_MISMATCH');

  const extra = isDirect ? (call.length === 4 ? call[3] : []) : call[6];
  need(Array.isArray(extra) && extra.length <= 32, 'INVALID_EXEMPTION_LIST');
  const atomicRecipient = isForwarder ? address(call[5], 'ATOMIC_RECIPIENT') : null;
  const exemptAddresses = new Map();
  const addExempt = (who, reason) => {
    const a = address(who, 'EXEMPT_ADDRESS');
    const item = exemptAddresses.get(key(a)) ?? { address: a, reasons: [] };
    if (!item.reasons.includes(reason)) item.reasons.push(reason);
    exemptAddresses.set(key(a), item);
  };
  addExempt(initiator, 'LAUNCHER');
  addExempt(feeRecipient, 'CREATOR_FEE_RECIPIENT');
  for (const e of extra) addExempt(e, 'EXPLICIT_LAUNCH_EXEMPTION');
  if (atomicRecipient) addExempt(atomicRecipient, 'ATOMIC_BUY_RECIPIENT');

  const supply = asBigInt(totalSupply, 'TOTAL_SUPPLY');
  need(supply > 0n, 'EMPTY_TOTAL_SUPPLY');
  const observed = new Map();
  let atomicBuyLogs = 0;
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, curve)) continue;
    let evt;
    try { evt = decodeEventLog({ abi: [PONS_V2_CURVE_BUY_EVENT], data: log.data, topics: log.topics, strict: true }); }
    catch { continue; }
    if (evt.eventName !== 'CurveBuy') continue;
    need(sameHex(log.transactionHash, hash) &&
      sameHex(log.blockHash, receipt.blockHash), 'BUY_LOG_IDENTITY_MISMATCH');
    const recipient = address(evt.args.recipient, 'BUY_RECIPIENT');
    const amount = asBigInt(evt.args.tokensOut, 'BUY_TOKENS');
    need(amount > 0n, 'ZERO_OPENING_BUY');
    const prev = observed.get(key(recipient)) ?? { address: recipient, tokensOut: 0n, buys: 0 };
    prev.tokensOut += amount;
    prev.buys++;
    observed.set(key(recipient), prev);
    atomicBuyLogs++;
  }
  let totalOpeningTokens = 0n;
  const buyers = [...observed.values()].map(v => {
    totalOpeningTokens += v.tokensOut;
    return {
      recipient: v.address,
      tokensOut: v.tokensOut.toString(),
      supplyShareBpsFloor: Number(v.tokensOut * 10_000n / supply),
      transactionsObserved: 1,
      sameTransactionBuyLogs: v.buys,
      exemptionReasons: exemptAddresses.get(key(v.address))?.reasons ?? []
    };
  }).sort((a, b) => a.recipient.localeCompare(b.recipient));
  need(totalOpeningTokens <= supply, 'OPENING_BUYS_EXCEED_SUPPLY');
  if (isForwarder) {
    need(atomicBuyLogs > 0 && observed.has(key(atomicRecipient)),
      'ATOMIC_ROUTE_WITHOUT_RECIPIENT_BUY');
  }
  return {
    schemaVersion: 'PONS_V2_OPENING_ALLOCATION_EVIDENCE_V0',
    chainId: 4663,
    factory: reviewedFactory,
    token,
    curve,
    initiator,
    creatorFeeRecipient: feeRecipient,
    pairToken,
    launchConfigId: String(args.launchConfigId),
    blockNumber: transaction.blockNumber.toString(),
    blockHash: receipt.blockHash,
    launchTransactionHash: hash,
    route: isDirect ? 'DIRECT_FACTORY_LAUNCH' : 'VERIFIED_FACTORY_FORWARDER_ATOMIC_BUY',
    declaredExtraExemptions: extra.length,
    observedExemptAddresses: [...exemptAddresses.values()].sort((a,b) => a.address.localeCompare(b.address)),
    openingSameTransactionBuyLogs: atomicBuyLogs,
    openingSameTransactionRecipients: buyers.length,
    observedOpeningTokens: totalOpeningTokens.toString(),
    observedOpeningSupplyShareBpsFloor: Number(totalOpeningTokens * 10_000n / supply),
    openingBuys: buyers,
    limits: [
      'Only explicitly declared/automatic exemptions and same-launch-transaction CurveBuy logs observed.',
      'Not a census of later buys, beneficial owners, private agreements or coordinated wallets.',
      'Recorded share is opening same-transaction allocation, not all insider holdings.',
      'No risk score, fill guarantee, trading decision or live authority.'
    ]
  };
}
