# PONS Culture Radar V0 — research-only collector

This is an **isolated, manually invoked research experiment** inside SENTRY, not
BINRAT's Telegram bot and not a trading subsystem. All collection is default-off.
No credentials, X/TG web scraping, proxy rotation, signing, transaction construction,
deployment, model promotion, S1 activation or live-money authority.

## The exact V0 implementation

- One-shot adapters: approved publisher RSS/Atom, bounded 4chan catalog reads
  (one source; 11+ seconds between attempts), sampled public Bluesky Jetstream
  (requires the optional `websockets` package), and **user-authored summaries**
  with explicit opt-in plus an X or Telegram source link. A submitted link is
  **unverified**; this does not retrieve the original X/TG post.
- Common typed receipts contain event/source identity, original publication
  timestamp when published, **actual collector observation time**, permitted-use
  class, a content fingerprint and the original reference.
- Per-adapter circuit breakers, bounded retries and independent source states;
  an access denial permanently opens the offending adapter until manually reset.
  Sources are not interchangeable: RSS evidence cannot be presented as native
  X audience measurements, and multiple mirrors must not be counted as
  independent cultural communities.
- Exact normalized-text deduplication, a very small transparent promotional-text
  heuristic, source-window intake caps, bounded in-memory narrative state and
  explicit coverage. This is **not** semantic meme clustering or anti-Sybil proof.
- Read-only candidate matching distinguishes an exact supplied source link from
  an unverified name/ticker match. A match only prioritizes **research** after an
  independently factory-authenticated launch. No recommendation or order is emitted.
- An opt-in, fsync'd local JSONL evidence spool (16 MiB hard cap), tamper-detecting
  bounded replay and optional volatile Jetstream cursor checkpoint after receipt
  persistence. This is a proof of restart semantics, not an archival database.

## Offline checks

Python 3.11+ and **no third-party packages** for unit tests:

```sh
cd experiments/culture-radar-v0
PYTHONPATH=. python3 -m unittest discover -s tests -v
```

No test performs HTTP requests, joins Telegram channels or connects to X.

## Explicit one-shot collection

Only run against feeds you have permission to collect. The command performs a
**single bounded sample**; it does not install a daemon, cron or long-running
service. Configuration is local and provided by the operator.

```sh
cd experiments/culture-radar-v0
# Public RSS for a reviewed publisher (illustrative URL; provide your own valid feed):
PYTHONPATH=. python3 -m culture_radar.cli \
  --network --rss https://your-permitted-publisher.example/feed.xml \
  --out ./local-private/culture-receipts.jsonl

# User-authored summaries only (sample file described below; no network):
PYTHONPATH=. python3 -m culture_radar.cli \
  --submissions ./local-private/consented-submissions.jsonl \
  --out ./local-private/culture-receipts.jsonl

# Public Bluesky Jetstream, sampled over three seconds:
python3 -m pip install -r requirements-live.txt
PYTHONPATH=. python3 -m culture_radar.cli \
  --network --jetstream --out ./local-private/culture-receipts.jsonl \
  --state ./local-private/jetstream-cursor.json
```

An opt-in submission is a line of JSON with
`{"consent":true,"url":"https://x.com/...","description":"My own short summary of why this meme matters","submitter_key":"pseudonym"}`.
Only the **submitter-authored** description is recorded; original post
authenticity, original post metrics and original publication time are **unknown**.

Keep the private local output outside Git. The spool stores text and pseudonymous
account/source identifiers; apply a retention policy and do not commit raw social
content. Errors expose typed classes, not raw API responses.

## Boundaries and important limitations

1. V0 sources **do not provide dependable first-minute X/TG coverage**. Their
   source-access restrictions are not bypassed by another language, account,
   scraper, Nitter instance, rotating proxy or mirror.
2. RSS is publisher-level evidence, 4chan catalog reads are thread-opening
   evidence, Jetstream is explicitly keyword-filtered/sampled, and submissions
   are self-reported context. None is a complete cultural census.
3. Exact-text clustering can miss remixes; repeated syndication can resemble
   cross-source propagation. The current labels are descriptive, not viral
   probabilities or evidence of unique humans.
4. The Jetstream cursor reflects sampled upstream delivery, not guaranteed
   complete receipt coverage. An unreachable endpoint should degrade to
   stale/unknown, and the reader must not backdate its actual observation time.
5. The local JSONL spool is bounded and not suitable as the permanent 10K-user
   ingestion backend. A production service requires atomic durable admission +
   source cursor, retention/privacy controls, queue budgets, source health
   visibility and a separately reviewed deployment architecture.
6. Nothing here changes SENTRY's canonical S0/S1 preregistration, BINRAT's
   frontend or bot, or the currently inactive real-money research authority.

## Next phase

The next bounded integration is a **read-only, immutable observation bridge**
from this independently frozen research output to exact factory-qualified Pons
launches. Separate data-acquisition, privacy/licensing, latency and real
coverage qualification must precede any near-real-time or production claim.
