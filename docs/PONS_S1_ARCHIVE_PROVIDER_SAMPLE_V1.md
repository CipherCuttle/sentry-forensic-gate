# PONS S1 — bounded Alchemy archive capability gate (candidate only)

**Authority:** stacked draft, read-only; no real PR networking, no cohort,
publication, wallet, signing, broadcast, S1 activation, money or merge.

## Why

The real 256-block public-RPC rehearsal in run 36070443854 matched both
providers' factory-event transcripts (2 events, 1 native), but official RPC
failed historical factory bytecode and BlockReq failed the pinned historical
block. The C0 pair then failed in an adapter stage. Draft PR #87 adds finite
stage-only diagnostics; it does not provision archive capacity.

Robinhood's connecting documentation recommends Alchemy for chain 4663,
with endpoint https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}, and says
historical reads require an archive-capable provider. An app or endpoint alone
does NOT establish that this account has working historical storage or logs.

## Change

- ONE manually dispatched workflow, with no pull_request, push, schedule or
  retry trigger; reviewed default-branch ref refs/heads/main and the exact
  repository are mandatory. It uses a separate protected GitHub environment.
  The workflow cannot be manually dispatched on default until explicitly
  authorized merges bring the stacked source to main.
- Check chain 4663 and <=128-block head lag. At one agreed recent block,
  verify both providers' block hashes and the pinned factory code hash.
- At factory epoch +1,000 and +10,000, require Alchemy historical blocks,
  pinned factory runtime code and historical memeHook contract calls.
  Compare the official endpoint's historic HEADERS where available, but do
  not pretend its historical code/calls worked when they did not.
- Compare exactly 16 contiguous recent fully normalized factory-event
  blocks including non-native tokens. A zero-event agreement is not positive
  proof of full archival event coverage. No expanded scans or retries.
- One 120-second overall cooperative budget, 12-second per-RPC timeouts.
  Only fixed state, stage/class, sample heights, counts and SHA-256 digests
  appear in a sanitized exclusive-create JSON receipt. The key-bearing URL,
  provider errors, wallet, trading and future outcomes are never emitted.
- ARCHIVE_SAMPLE_HEADERS_MATCHED_ONLY and
  ARCHIVE_SAMPLE_ONLY_REFERENCE_UNAVAILABLE are SAMPLE states, not
  independent-backend qualification, archive SLA or scientific evidence.

## Owner setup — ONLY after reviewed and separately authorized merge

1. Obtain an Alchemy Robinhood Mainnet endpoint with archived block, bytecode,
   contract-call and event-log access. Confirm retention, limits and price
   with the provider. Never paste the key or full URL into a PR, issue or chat.
2. In GitHub Settings > Environments create pons-s1-archive-readonly.
   Require owner review, restrict to protected branch main and create the
   environment SECRET PONS_S1_ARCHIVE_RPC_URL containing the keyed HTTPS URL.
   Restrict who may change the workflow and environment. If the repository's
   plan does not support these controls, do not enable credential workflows;
   use an equivalently controlled trusted runner instead.
3. Only after explicit owner authorization to merge the parent stack and
   this child, manually dispatch the workflow on main and approve its
   protected environment. It cannot start automatically. Examine the
   sanitized artifact; do not treat job success as proof of S1 readiness.
4. Stop on mismatched chain, runtime code hash, canonical block hash or
   factory-event transcript. If official historical headers are unavailable,
   preserve that gap. Different DNS hosts do not establish backend diversity.
5. Any positive sample still needs a separately vetted second archive
   provider and a new actual dual-C0/release-timing rehearsal. Full Curve/V4
   costs, independent scientific power, activation and money remain blocked.

## Verify

The offline test scripts/pons-s1-archive-provider-check-v1.mjs includes
hostile endpoint validation, secret-redaction classification, bounded-scan
and exact receipt/non-promotion tests. The package-level full test suite
must run it. No archive secret is exposed to pull_request jobs.
