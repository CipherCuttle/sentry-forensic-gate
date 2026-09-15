import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadFrozenScopeManifest } from './historical-full-replay-scope-fixture.mjs';
import { loadFrozenAuthorityMap } from './historical-full-replay-authority-map-fixture.mjs';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_FULL_REPLAY_R1.json';
const SCOPE_DIGEST = 'b5184624928e9dc36fd75558bf599074e9eb67e03658fe9b3f3e00668b5b8211';
const MAP_DIGEST = 'c5346e572255385acd1744552633d5ad533d86d3821a8d857a432471e6022275';
const PAYLOAD_SHA = '839c8ebd16589387b2e08888484962f0cf8d1389837f9045a7a9a4ef1eb97623';
const COMPRESSED_SHA = 'b140ffbfd3460de5a03c749d011ec8101323cc21f71af8c3c14826d5882b0893';
const EXPECTED_HORIZONS = [{label:'1m',ms:60000},{label:'5m',ms:300000},{label:'30m',ms:1800000},{label:'2h',ms:7200000},{label:'24h',ms:86400000}];
const AUTHORIZATION_KEYS = [
  'historical_compatibility_implementation','historical_baseline_policy_discovery','historical_baseline_policy_implementation',
  'historical_outcome_policy_discovery','historical_outcome_policy_implementation','historical_all_horizon_compatibility_implementation',
  'full_147_replay','fast_vet','canary','signing','transaction_construction','transaction_broadcast','live_execution','merge',
];
function invariant(condition,message){ if(!condition) throw new Error(message); }
function exactKeys(value,expected,label){
  invariant(JSON.stringify(Object.keys(value??{}).sort())===JSON.stringify([...expected].sort()),`${label} keyset drift`);
}

export function validatePacket(packet) {
  invariant(packet.schema==='dev-spine-phase/v1' && packet.repo==='CipherCuttle/sentry-forensic-gate' && packet.phase==='HISTORICAL_FULL_REPLAY_R1','unexpected packet identity');
  invariant(packet.state==='HISTORICAL_FULL_REPLAY_AUTHORITY_MAP_FROZEN','unexpected phase state');
  invariant(packet.next_action==='EXECUTE_FULL_147_X_5_REPLAY','Stage B replay must be next after frozen authority map');
  invariant(Array.isArray(packet.authority_docs)&&packet.authority_docs.length>0,'authority_docs required');
  invariant(Array.isArray(packet.context_files)&&packet.context_files.length>0,'context_files required');
  for(const path of new Set([...packet.authority_docs,...packet.context_files])) invariant(fs.existsSync(path)&&fs.statSync(path).isFile(),`authority/context file missing: ${path}`);

  exactKeys(packet.authorization,AUTHORIZATION_KEYS,'authorization');
  for(const key of AUTHORIZATION_KEYS){
    const expected=key==='full_147_replay';
    invariant(packet.authorization[key]===expected,`frozen-map state requires authorization.${key}=${expected}`);
  }
  invariant(packet.authority?.current_default==='R3'&&packet.authority?.current_r3_behavior_must_remain_unchanged===true,'current R3 authority drift');
  invariant(packet.authority?.historical_full_replay_authorized===true&&packet.authority?.research_only===true,'research replay authority drift');

  invariant(packet.predecessor?.phase==='HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1'&&packet.predecessor?.pr===22,'authorization predecessor identity drift');
  invariant(packet.predecessor?.closure_head==='efade9f625aeffc3f6e88494e13ac058c9ffb1ae'&&packet.predecessor?.verdict==='CLOSED_AUTHORIZE','authorization predecessor closure drift');
  invariant(packet.predecessor?.scope_identity_sha256===SCOPE_DIGEST,'authorization predecessor scope digest drift');

  const scope=packet.frozen_scope;
  invariant(scope?.manifest_path==='fixtures/historical-full-replay-scope-r1.json','frozen scope path drift');
  invariant(scope?.expected_launches===147&&scope?.first_launch_block===39943476&&scope?.final_launch_block===49271598,'frozen scope range/count drift');
  invariant(scope?.launch_identity_sha256===SCOPE_DIGEST,'frozen scope digest drift');
  const frozenScope=loadFrozenScopeManifest(scope.manifest_path);
  invariant(frozenScope.index.launchIdentitySha256===SCOPE_DIGEST&&frozenScope.manifest.launches.length===147,'committed frozen scope drift');

  const policy=packet.frozen_policies;
  invariant(policy?.baseline_policy_version==='HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1'&&policy?.outcome_policy_version==='HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1','historical policy version drift');
  invariant(policy?.decision_delay_blocks===2,'decision delay drift');
  invariant(JSON.stringify(policy?.horizons)===JSON.stringify(EXPECTED_HORIZONS),'frozen horizon set drift');
  invariant(policy?.weth_valuation_kind==='WETH_REDSTONE_ETH_USD_OUTCOME_ASOF_V1'&&policy?.freshness_rejection_threshold_seconds===null,'historical valuation/freshness drift');

  const gate=packet.authority_map_gate;
  invariant(gate?.required===true&&gate?.status==='FROZEN_VERIFIED','Stage B requires FROZEN_VERIFIED authority map');
  invariant(gate?.output_path==='fixtures/historical-full-replay-authority-map-r1.json','authority map path drift');
  invariant(gate?.authority_map_sha256===MAP_DIGEST,'authority map digest drift');
  invariant(gate?.discovery_run===34917993958,'authority map discovery run drift');
  invariant(gate?.discovery_artifact_id===10376329939,'authority map artifact id drift');
  invariant(gate?.discovery_artifact_sha256==='64ff2b9915cd0c449ac4edca8da96dfae773bd0de49e3225eac6720a1ac619c1','authority map artifact digest drift');
  invariant(gate?.fixture_content_sha256===PAYLOAD_SHA,'authority map fixture content digest drift');
  const frozenMap=loadFrozenAuthorityMap(gate.output_path);
  invariant(frozenMap.index.payloadSha256===PAYLOAD_SHA&&frozenMap.index.compressedPayloadSha256===COMPRESSED_SHA,'authority map storage digest drift');
  invariant(frozenMap.index.authorityMapSha256===MAP_DIGEST&&frozenMap.manifest.rows.length===147,'authority map decoded payload drift');
  for(let i=0;i<147;i+=1){
    const scopeRow=frozenScope.manifest.launches[i], mapRow=frozenMap.manifest.rows[i];
    for(const key of ['ordinal','event','blockNumber','blockHash','transactionHash','logIndex','tokenId','token','creator'])
      invariant(mapRow[key]===scopeRow[key],`authority map launch identity mismatch:ordinal=${i+1}:field=${key}`);
  }

  const replay=packet.replay_contract;
  invariant(replay?.expected_launch_receipts===147&&replay?.expected_horizon_cells===735,'replay accounting contract drift');
  invariant(replay?.economic_complete_required_for_phase_pass===false,'phase PASS must not require all economic cells COMPLETE');
  for(const key of ['accounting_complete_required_for_phase_pass','baseline_unverified_is_valid_evidence','outcome_unverified_is_valid_evidence','provider_transport_failure_is_not_market_evidence','per_launch_per_horizon_receipts_required','no_policy_mutation_after_observing_results'])
    invariant(replay?.[key]===true,`replay_contract.${key} must remain true`);
}
function main(){try{const packet=JSON.parse(fs.readFileSync(PACKET_PATH,'utf8'));validatePacket(packet);console.log(`DEV_SPINE_CHECK=PASS phase=${packet.phase} state=${packet.state}`)}catch(error){console.error(`DEV_SPINE_CHECK=FAIL ${error.message}`);process.exit(1)}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) main();
