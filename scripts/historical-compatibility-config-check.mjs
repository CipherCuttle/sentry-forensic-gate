import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CURRENT_READ_AUTHORITY_CONTEXT } from '../dist/authority/readAuthorityContext.js';
import { CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH } from '../dist/authority/executableInfraAuthority.js';
import { CURRENT_SENTRY_AUTHORITY_EPOCH } from '../dist/authority/sentryAuthority.js';

const fixture = JSON.parse(fs.readFileSync('fixtures/historical-compatibility-r1.json', 'utf8'));
const packet = JSON.parse(fs.readFileSync('docs/agent-packets/HISTORICAL_COMPATIBILITY_R1.json', 'utf8'));

const expectedRepresentatives = [
  ['0xf6b81e4a431aa5c459b7502802bab306ce465146', '39943476', '1'],
  ['0x3f01f1e0d8b76e0a7bf476335a9ebcb6755df536', '40032260', '5'],
  ['0x6f269786695fcd8cc684ebf37604dd2fb1797fcc', '42060479', '24'],
  ['0x71b2296124ce438bf2d0fef01e0adbd14a020282', '44137983', '49'],
  ['0xfab1d73e877947fabe2d0966f9832541b6f82750', '45634572', '82'],
  ['0xbe0e8f5d351b6acb0ec5c4ce6d2ba6c602bbb80f', '45813860', '86'],
  ['0x28ed07daba4ca9025819b64e1abb98d6c15ba069', '46611372', '108'],
  ['0x3515ce96c5c6fb8e73ebe04756f2227d035d6334', '46637160', '110'],
  ['0xd5bced4c43eef627ee0524368cabafcb9f29cff0', '46667534', '112'],
];

assert.equal(fixture.schema, 'historical-compatibility-r1-fixtures/v1');
assert.equal(fixture.selection_rule, 'FIRST_REAL_LAUNCH_PER_LAUNCH_PRODUCING_IMPLEMENTATION_COHORT');
assert.deepEqual(
  fixture.representatives.map((item) => [item.implementation, item.blockNumber, item.tokenId]),
  expectedRepresentatives,
  'reviewed representative fixture must not drift'
);
assert.deepEqual(fixture.historical_executable_tuple, packet.known_historical_state.historical_executable_tuple);
assert.equal(packet.known_historical_state.representative_fixture_status, 'CAPTURED_FROM_REVIEWED_DISCOVERY_ARTIFACT');
assert.equal(packet.authorization.full_147_replay, false);
assert.equal(packet.authorization.fast_vet, false);
assert.equal(packet.authorization.canary, false);
assert.equal(packet.authorization.merge, false);

assert.equal(CURRENT_READ_AUTHORITY_CONTEXT.sentryImplementation, CURRENT_SENTRY_AUTHORITY_EPOCH.implementation);
assert.equal(CURRENT_READ_AUTHORITY_CONTEXT.npm, CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.npm);
assert.equal(CURRENT_READ_AUTHORITY_CONTEXT.factory, CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.factory);
assert.equal(CURRENT_READ_AUTHORITY_CONTEXT.quoterV2, CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.quoterV2);
assert.equal(CURRENT_READ_AUTHORITY_CONTEXT.weth, CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.weth);

console.log('historical compatibility config/default-authority check: PASS');
