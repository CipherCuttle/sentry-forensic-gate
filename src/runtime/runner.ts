import { FORENSIC_GATE_V0 } from '../policy.js';
import { evaluateHardGate } from '../protocol/hardGate.js';
import type { ProtocolVerifier, QuoteSource } from '../sentry/ports.js';
import type { Store } from '../db/store.js';
import type { LaunchObserved } from '../domain.js';

export interface RunnerPorts {
  store: Store;
  verifier: ProtocolVerifier;
  quotes: QuoteSource;
}

export async function processLaunch(launch: LaunchObserved, ports: RunnerPorts) {
  const inserted = await ports.store.putLaunch(launch);
  if (inserted === 'DUPLICATE') return { status: 'DUPLICATE' as const };

  const verified = await ports.verifier.verify(launch);
  const primary = FORENSIC_GATE_V0.primaryNotionalUsdMicros;
  const entry = await ports.quotes.quoteEntry(launch, primary);
  const reverse = entry.executable ? await ports.quotes.quoteReverseExit(entry) : null;

  const gate = evaluateHardGate({
    ...verified,
    entryExecutable: entry.executable,
    reverseExitExecutable: reverse?.executable ?? null
  });

  return { status: 'PROCESSED' as const, gate, entry, reverse };
}
