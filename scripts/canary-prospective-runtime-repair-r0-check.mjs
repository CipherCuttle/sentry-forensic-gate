import assert from 'node:assert/strict';
import fs from 'node:fs';

const cli = fs.readFileSync(new URL('../src/canarySniperCli.ts', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/canary-prospective-observation-r1.yml', import.meta.url), 'utf8');

assert.match(cli, /confirmations: envBigInt\('SENTRY_CONFIRMATIONS', 2n\)/);
assert.match(cli, /confirmations: envBigInt\('BASELINE_CONFIRMATIONS', 2n\)/);
assert.doesNotMatch(cli, /confirmations: envBigInt\('SENTRY_CONFIRMATIONS', 0n\)/);
assert.doesNotMatch(cli, /confirmations: envBigInt\('BASELINE_CONFIRMATIONS', 0n\)/);

const sleepStart = cli.indexOf('function sleep(ms: number, signal: AbortSignal)');
assert.ok(sleepStart >= 0, 'canary poll sleep must exist');
const sleepSource = cli.slice(sleepStart);
const addListener = sleepSource.indexOf("signal.addEventListener('abort', onAbort, { once: true })");
const removeListener = sleepSource.indexOf("signal.removeEventListener('abort', onAbort)");
assert.ok(addListener >= 0, 'abort listener must be installed');
assert.ok(removeListener >= 0, 'completed poll must remove abort listener');
assert.ok(removeListener < addListener, 'cleanup must be encoded in the sleep implementation before listener registration');

assert.match(workflow, /SENTRY_CONFIRMATIONS=2/);
assert.match(workflow, /BASELINE_CONFIRMATIONS=2/);
assert.match(workflow, /OUTCOME_CONFIRMATIONS=2/);
assert.match(workflow, /CANARY_LIVE=false/);
assert.match(workflow, /test -z "\$\{CANARY_PRIVATE_KEY:-\}"/);
assert.match(workflow, /SENTRY_PROXY_IMPLEMENTATION_MISSING/);
assert.match(workflow, /MaxListenersExceededWarning/);
assert.match(workflow, /networkBroadcastInvoked: false/);

console.log(JSON.stringify({
  verdict: 'CANARY_PROSPECTIVE_RUNTIME_REPAIR_R0_STATIC_PASS',
  sentryConfirmationsDefault: 2,
  baselineConfirmationsDefault: 2,
  observerSentryConfirmations: 2,
  observerBaselineConfirmations: 2,
  pollAbortListenerCleanupRequired: true,
  live: false,
  privateKeyRequired: false
}, null, 2));
