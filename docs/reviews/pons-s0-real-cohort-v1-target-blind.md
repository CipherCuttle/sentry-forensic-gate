# Pons S0 real cohort — one hostile target-blind integrity review

Review date: 2026-09-23 CEST
Scope: exact 96-row cohort, frozen launch index, 16 immutable shard artifacts, features, outcome metadata/digests, manifest, and origin receipt.
**Verdict: PASS FOR FROZEN EXPLORATORY SCREEN ONLY. EDGE_UNPROVEN.**
No model performance, return distributions, class balance, or variant selection was inspected before issuing this verdict.

## Immutable inputs

- Reviewed source: `493c85b8d84565cedf6e936063549edfa02edf3a`
- Frozen discovery artifact: run `35648177392`, artifact `10669670502`
- Discovery index SHA-256: `00af1e630831ccdd3658559627964ca4d1c5b64b488f1aca5a429b28323eb5eb`
- Original 16-shard run: `35771895172`
- One-shot assembly-recovery run: `35795513907`
- Recovery harness commit: `2c1d717d950b6a42db8b05e9bd85cd8c6da00aed`
- Exact immutable assembly evidence commit: `d711943a25693baee504d2bfe89ae398b75a690a`
- Origin receipt evidenceDigest: `31dd06dca9555954c2ca4546c8e75a9f3a2e9db33062c56076928b16919761ce`

## Independent hostile checks

1. Streamed and hashed the original 510 MB uncompressed discovery index: byte-for-byte SHA-256 match; 576,814 source logs. Factory and event-topic checks passed for every indexed log.
2. Independently filtered the source index through frozen maturity block `68207850`: 564,865 mature events, matching the frozen cohort plan. No duplicate mature event keys.
3. Recomputed systematic ordinal positions `floor(i*(N-1)/95)` independently: all 96 selected logs and block hashes exactly match the plan, including both endpoints.
4. Verified plan file digest, source pin, target-blind selection flag, all 16 fragment file digests and receipts, six rows per shard, global offsets 0–95, unique selected launch identities, and plan-to-fragment-to-feature launch/creator/token/decision-hash bindings.
5. Independently checked feature and outcome stream hashes, all 96 feature packet evidence digests, all 57 outcome packet evidence digests, the manifest digest and the complete origin receipt canonical digest. Recovery's streams are byte-identical to the original first assembly's streams: it did **not** recollect, resample, or re-label any launch.
6. Reconstructed creator-history prior-launch eligibility from all 12,156 relevant frozen historical creator facts and earlier-selected projected outcome *metadata* for all 96 decisions. Every prior count, fact ID set, and eligible classified-count check passed; no selected receipt became visible for the first time in the same block as a later decision. Prior labels are selected only at observed block <= the decision block by reviewed code; within this frozen cohort there were zero equal-block cases.
7. Checked feature/outcome separation, independent same-state reverse-quote semantics (not sequential sizing), signer/broadcaster exclusion, and no money, merge or promotion authority.

## Scientific limits — not integrity defects

- 57 complete historical baseline/outcome packets and 39 unverified baseline rows. The latter are not losses and must not be imputed as labels.
- Creator-history outcome coverage: 65 NO_HISTORY and 31 UNKNOWN; **zero classified prior creator outcomes** among 96 feature rows. Historical creator launch counts are not historical creator-label coverage. Do not claim predictive validation of creator outcome history from this screen.
- The materializer supplies no full verified execution-cost evidence. Gross outcomes may be screened, but positive *net* returns and live profitability cannot be established by this frozen historical cohort.
- Shadow recipient/execution-persona parity to a live funded wallet remains unverified. Independent same-state reverse quotes are prohibited as sequential post-buy capital authority.
- Point-in-time block anchors and reorg checks follow the reviewed provider contracts; this review independently validated the pinned archival artifact and all internal hashes, not every historical block against a second live archive provider.

## Release boundary

Integrity gate is approved **only** to release the already frozen outcome stream to QntyLab's exactly registered C0/C1/M1/M2 screen. Strict training-label availability embargo, 30 minimum training rows, ten test rows per fold, three folds maximum, and fixed 0.5 threshold remain frozen.

No automatic winner, promotion, prospective strategy freeze, live-money authority, signing, broadcasting or merge is granted. Review count: ONE. No Critical/High evidence-integrity finding on the frozen declared export; no targeted rereview required. If screen diagnostics cannot establish valid chronological folds or net-cost evidence, report that honestly and leave autonomy disabled.
