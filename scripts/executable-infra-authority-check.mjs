import assert from 'node:assert/strict';
import {
  assertAuthorizedExecutableStartBlock,
  CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH,
  EXECUTABLE_INFRA_AUTHORITY_MANIFEST_VERSION,
  resolveAuthorizedExecutableInfra
} from '../dist/authority/executableInfraAuthority.js';
import {
  TSUNAMI_POSITION_MANAGER,
  TSUNAMI_QUOTER_V2,
  TSUNAMI_V3_FACTORY,
  WETH9
} from '../dist/tsunami/contracts.js';

assert.equal(EXECUTABLE_INFRA_AUTHORITY_MANIFEST_VERSION, 'EXECUTABLE_INFRA_AUTHORITY_R3');
assert.equal(CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.activationBlock, 52_269_352n);
assert.equal(CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.fromBlock, 52_269_353n);
assert.equal(
  CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.activationTx,
  '0xc24618fc2b3c15ddc49272fea90589564ea17052ab459886be4bfcf305ad8755'
);
assert.equal(TSUNAMI_POSITION_MANAGER.toLowerCase(), CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.npm.toLowerCase());
assert.equal(TSUNAMI_V3_FACTORY.toLowerCase(), CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.factory.toLowerCase());
assert.equal(TSUNAMI_QUOTER_V2.toLowerCase(), CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.quoterV2.toLowerCase());
assert.equal(WETH9.toLowerCase(), CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.weth.toLowerCase());
assert.throws(
  () => resolveAuthorizedExecutableInfra(52_269_352n),
  /EXECUTABLE_INFRA_EPOCH_UNAUTHORIZED/
);
assert.doesNotThrow(() => assertAuthorizedExecutableStartBlock(52_269_353n));
assert.equal(resolveAuthorizedExecutableInfra(52_269_353n), CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH);
assert.equal(resolveAuthorizedExecutableInfra(99_999_999n), CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH);

console.log('executable infrastructure authority check ok');
