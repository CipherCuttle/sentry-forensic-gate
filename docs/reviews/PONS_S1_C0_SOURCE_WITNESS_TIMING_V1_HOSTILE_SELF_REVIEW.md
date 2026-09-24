# PONS S1 C0 external source/timing — bounded hostile self-review

Internal self-review only, NOT independent scientific or security review.

1. High, addressed as candidate: a locally forged backdated C0 receipt can
   be generated after outcome. External immutable source witness requires
   original read-only GitHub artifact AND a byte-identical immutable release
   published **before** earliest launch+5m with conservative timestamps.
2. High, addressed: foreign PR or wrong run can masquerade as source.
   Exact main-only workflow, activation commit/reviewed merge parent, main
   ancestry, artifact/run SHA, first attempt and release tag are mandatory.
3. High, addressed: artifact expiration/replacement or noncanonical source
   bytes. Exact SHA256, singleton unexpired artifact, separate immutable
   singleton release, exact raw bytes and full C0 replay are required.
4. Open Critical for real activation: provider reads, quote evidence and
   local acquisition times can still be dishonest. Requires real independent
   provider checks, actual original source publication and trusted main
   witness. Passing synthetic fixture is NOT external attestation.
5. Open High: source artifact/immutable release per launch is costly and
   may fail the five-minute deadline; V1 cohort does not commit sidecars.
   Review prospective V2 source manifest, bounded bursts and independent
   release/witness architecture before accepting any source qualification.
6. Open High: real one-shot chain rehearsal reads blocks only; it omits
   actual C0 quote/dual RPC latency, queue and immutable release publishing.
   Explicitly classified non-scientific timing diagnostic, not feasibility.
7. Open High: C0 failures need pre-outcome typed UNKNOWN; full scan partial
   cursor behavior and source artifact selection can otherwise bias the
   denominator. #83 fail-closed means activation remains blocked.
8. Separate inherited E2 and E3 wallet-readiness reds are not waived.
   No real S1 cohort, trade or PR merge is authorized.

One hostile self-review, rectify Critical/High implementation defects,
one targeted rereview only if necessary, then stop at engineering gate.
