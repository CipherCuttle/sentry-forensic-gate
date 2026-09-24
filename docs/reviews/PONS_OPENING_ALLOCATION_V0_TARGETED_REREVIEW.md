# Pons opening allocation V0 — ONE targeted rereview after H1

Date: 2026-09-24 CEST. This is an internal source review, **not** an independent audit and **not** prospective or live-money authorization.

## Original High H1 — caller event not byte-authenticated

Initially the pure attestor trusted caller-supplied `launchLog.args` after only matching the launch event's receipt address/tx/block/log-index. The manual CLI had already decoded the original factory event, but another caller could pass arbitrary args inconsistent with its alleged receipt.

**Repair:** The core now locates **exactly one** matching receipt log, requires byte-identical topics and data, independently decodes the reviewed full `TokenLaunched` ABI and rejects every mismatch between its decoded fields and the caller's claimed fields. Only the independently decoded args are used for launch/route/fee/allocation identity.

Added regressions for: modified claimed token, modified claimed event data, modified raw receipt event data, wrong log index, wrong block hash, wrong factory record, wrong destination, malformed call data, reverted transaction, invalid exemption length, impossible allocation, and a direct/atomic positive witness.

### Verification of corrected code

- Source fix: `4fa5d48`; expanded fixture: `c16b81f`.
- One small variable name collision from the independently introduced second decoder was subsequently discovered by CI and repaired at code head `9a422da0643c088d14ff0fd64b942554e974c063`. Failed pre-repair runs were not treated as proof.
- Dedicated read-only tests **PASS**: [run 35947044007](https://github.com/CipherCuttle/sentry-forensic-gate/actions/runs/35947044007).
- Full standard repository CI **PASS**: [run 35947043925](https://github.com/CipherCuttle/sentry-forensic-gate/actions/runs/35947043925).
- A separate optional fixed published launch transaction probe was added in commit `609a4ed` to qualify actual provider archive support and official ABI decoding; **a fixture pass alone is not a real-chain witness**. Its positive status, if any, must be checked from that exact workflow's output, not presumed from a green optional-smoke job.

**Targeted rereview verdict: PASS_OFFLINE_ONLY. Remaining Critical 0 / High 0 within this bounded review.**

## Residual scope limits

No inference of the true beneficial owner of other wallets; no proof of profits, rug safety, later-block selling pressure, executable exits, sequencer priority or market edge. The direct and atomic methods are only the two source-qualified Pons V2 routes. Unknown launch selectors, historical RPC gaps, proxy/forwarder mismatch and factory authority drift **STOP**, not assumed safe. No signer, wallet clients, execution grant, buy, sell, approval, broadcast, merge, scheduled collector or activation was added.

Separate scientific preregistration reconciliation remains outstanding between S1 PRs #73–#75 and #76. A future first-N-block buyer census must not relabel this same-transaction observation as total insider supply.


## Subsequent bounded real-chain source qualification (not another review loop)

The optional read-only direct-launch sample **succeeded** at reviewed code/workflow head `609a4edcb7bb017967bc3f8efcfc5261ec6738ad`: [GitHub Actions run 35947248055](https://github.com/CipherCuttle/sentry-forensic-gate/actions/runs/35947248055) and its downloadable `pons-opening-one-real-transaction-v0` JSON artifact.

Source: one factory launch observed independently by the seven-minute paired speed benchmark. Exact launch transaction `0xbd52317c84d90ba8912646563117fba9617056ce27cb5105b918c68367161a86`, block `71005336`, token `0x80a7e83f329be7f7ac65cef5992d0794d34491a6`. **DIRECT_FACTORY_LAUNCH** ABI, **zero declared extra exemptions**, the same wallet as launcher and creator-fee recipient, **zero same-transaction CurveBuy logs**. The token uses a **non-native custom pair**, so this proves direct-route receipt decoding and historical authority binding, **not** native-ETH economic qualification. There is no evidence here about later buys or common ownership.

**Verified on real chain: direct three-argument route only. Atomic launchAndBuy remains offline-fixture-qualified but not real-chain witnessed.** This does not alter the scientific, deployment or live-capital limits above.
