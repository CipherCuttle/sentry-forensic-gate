import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CURRENT_SENTRY_AUTHORITY_EPOCH,
  resolveAuthorizedSentryAuthority,
  SENTRY_AUTHORITY_MANIFEST_VERSION
} from '../dist/authority/sentryAuthority.js';
import { EXPECTED_SENTRY_LAUNCH_IMPLEMENTATION } from '../dist/sentry/contracts.js';

assert.equal(SENTRY_AUTHORITY_MANIFEST_VERSION, 'SENTRY_AUTHORITY_EPOCHS_R1');
assert.equal(CURRENT_SENTRY_AUTHORITY_EPOCH.fromBlock, 52_267_792n);
assert.equal(
  CURRENT_SENTRY_AUTHORITY_EPOCH.implementation.toLowerCase(),
  '0x94b22ce6a3db42e09685d12c3d4330296dc4ce73'
);
assert.equal(
  EXPECTED_SENTRY_LAUNCH_IMPLEMENTATION.toLowerCase(),
  CURRENT_SENTRY_AUTHORITY_EPOCH.implementation.toLowerCase()
);
assert.throws(
  () => resolveAuthorizedSentryAuthority(52_267_791n),
  /SENTRY_AUTHORITY_EPOCH_UNAUTHORIZED/
);
assert.equal(resolveAuthorizedSentryAuthority(52_267_792n), CURRENT_SENTRY_AUTHORITY_EPOCH);
assert.equal(resolveAuthorizedSentryAuthority(99_999_999n), CURRENT_SENTRY_AUTHORITY_EPOCH);

const manifest = JSON.parse(await readFile(new URL('../authority/ink-57073-sentry-v1.json', import.meta.url), 'utf8'));
assert.equal(manifest.version, SENTRY_AUTHORITY_MANIFEST_VERSION);
assert.equal(manifest.chainId, 57073);
assert.equal(manifest.authorizedEpochs.length, 1);
assert.equal(manifest.authorizedEpochs[0].fromBlock, 52_267_792);
assert.equal(manifest.observedUpgrades.at(-1).blockHex, '0x31d8b10');
assert.equal(manifest.observedUpgrades.at(-1).block, 52_267_792);
assert.equal(
  manifest.observedUpgrades.at(-1).implementation.toLowerCase(),
  CURRENT_SENTRY_AUTHORITY_EPOCH.implementation.toLowerCase()
);

console.log('sentry authority epoch check ok');
