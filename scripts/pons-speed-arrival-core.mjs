// Read-only same-process transport-arrival comparison; no execution or risk scoring.
// Block timestamps are deliberately NOT used for subsecond network-latency claims.
export class PonsLaunchArrivalLedger {
  constructor({ maxEvents = 50_000 } = {}) {
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) throw new Error('INVALID_MAX_EVENTS');
    this.maxEvents = maxEvents;
    this.records = new Map();
    this.forkIds = new Map();
    this.conflicted = new Set();
    this.errorCount = 0;
    this.removedCount = 0;
  }

  observe(source, raw, monoMs, unixMs) {
    if (source !== 'HTTP' && source !== 'WS') throw new Error('INVALID_SOURCE');
    if (!Number.isFinite(monoMs) || !Number.isFinite(unixMs)) throw new Error('INVALID_CLOCK');
    const blockNumber = raw?.blockNumber;
    const blockHash = canonicalHex(raw?.blockHash, 64, 'BLOCK_HASH');
    const txHash = canonicalHex(raw?.transactionHash, 64, 'TX_HASH');
    const logIndex = raw?.logIndex;
    if (typeof blockNumber !== 'bigint' || blockNumber < 0n ||
        !Number.isSafeInteger(logIndex) || logIndex < 0) {
      throw new Error('INCOMPLETE_EVENT_IDENTITY');
    }
    const txLog = txHash + ':' + logIndex;
    const fullId = blockHash + ':' + txLog;
    if (raw.removed === true) {
      this.removedCount++;
      const existing = this.records.get(fullId);
      if (existing) existing.removed = true;
      return { type: 'REMOVED', eventId: fullId };
    }
    const existingFork = this.forkIds.get(txLog);
    if (existingFork !== undefined && existingFork !== blockHash) this.conflicted.add(txLog);
    else this.forkIds.set(txLog, blockHash);

    let record = this.records.get(fullId);
    if (!record) {
      if (this.records.size >= this.maxEvents) throw new Error('EVENT_CAPACITY_EXCEEDED');
      record = {
        eventId: fullId,
        txLog,
        blockNumber: blockNumber.toString(),
        blockHash,
        txHash,
        logIndex,
        token: canonicalHex(raw.args?.token, 40, 'TOKEN'),
        seen: {},
        removed: false
      };
      this.records.set(fullId, record);
    }
    if (record.seen[source]) {
      return { type: 'DUPLICATE', eventId: fullId };
    }
    record.seen[source] = { monoMs, unixMs };
    const conflict = this.conflicted.has(txLog);
    return {
      type: conflict ? 'CONFLICT' : record.seen.HTTP && record.seen.WS ? 'MATCHED' : 'FIRST',
      eventId: fullId,
      blockNumber: record.blockNumber,
      blockHash,
      txHash,
      logIndex,
      token: record.token,
      source,
      localObservedUnixMs: unixMs,
      ...(record.seen.HTTP && record.seen.WS && !conflict ?
        { wsLeadMs: record.seen.HTTP.monoMs - record.seen.WS.monoMs } : {})
    };
  }

  summary() {
    const comparable = [];
    let http = 0;
    let ws = 0;
    let conflicted = 0;
    let removed = 0;
    for (const record of this.records.values()) {
      if (record.removed) { removed++; continue; }
      if (this.conflicted.has(record.txLog)) { conflicted++; continue; }
      if (record.seen.HTTP) http++;
      if (record.seen.WS) ws++;
      if (record.seen.HTTP && record.seen.WS) {
        comparable.push(record.seen.HTTP.monoMs - record.seen.WS.monoMs);
      }
    }
    comparable.sort((a, b) => a - b);
    return {
      schemaVersion: 'PONS_SPEED_ARRIVAL_V0',
      uniqueEventIds: this.records.size,
      httpUnique: http,
      wsUnique: ws,
      pairedSameBlockHash: comparable.length,
      httpOnly: http - comparable.length,
      wsOnly: ws - comparable.length,
      removedEventIds: removed,
      conflictingForkEventIds: conflicted,
      removedNotifications: this.removedCount,
      observationErrors: this.errorCount,
      wsLeadMs: comparable.length ? {
        p10: percentile(comparable, .1),
        median: percentile(comparable, .5),
        p90: percentile(comparable, .9),
        wsEarlier: comparable.filter(x => x > 0).length,
        httpEarlier: comparable.filter(x => x < 0).length,
        simultaneous: comparable.filter(x => x === 0).length
      } : null,
      interpretation: 'Same-process local delivery comparison only. No sequencer arrival, trade inclusion, profit or subsecond block-time claim.'
    };
  }
}

function canonicalHex(value, length, field) {
  if (typeof value !== 'string' || !new RegExp('^0x[0-9a-fA-F]{' + length + '}$').test(value)) {
    throw new Error('INVALID_' + field);
  }
  return value.toLowerCase();
}

function percentile(sorted, p) {
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo)) * 100) / 100;
}
