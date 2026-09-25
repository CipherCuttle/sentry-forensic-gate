"""Explicit one-shot acquisition entrypoint; inert until invoked by an operator.

Output is research-only JSONL, not the existing SENTRY trading ledger.
"""
from __future__ import annotations

import argparse
import asyncio
from collections import deque
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

from .core import Controller, Observation, Radar, millis
from .sources import RSSAdapter, FourChanAdapter, JetstreamAdapter, SubmissionAdapter

MAX_SUBMISSIONS_FILE = 1_000_000
MAX_SPOOL_BYTES = 16 * 1024 * 1024

def load_submissions(path: Path) -> list[dict]:
    if path.stat().st_size > MAX_SUBMISSIONS_FILE:
        raise ValueError("submission input exceeds bounded limit")
    rows: list[dict] = []
    with path.open(encoding="utf-8") as fp:
        for line in fp:
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError("submission must be a JSON object")
            rows.append(row)
            if len(rows) > 250:
                raise ValueError("submission batch exceeds 250 records")
    return rows

def recover_seen(path: Path, radar: Radar) -> int:
    if not path.exists():
        return 0
    if path.stat().st_size > MAX_SPOOL_BYTES:
        raise ValueError("output spool is full; rotate and archive deliberately")
    recent = deque(maxlen=radar.max_seen)
    # Verify *all* stored receipts for corruption, not only the most recent
    # N that fit in the bounded memory reconstruction window.
    with path.open(encoding="utf-8") as fp:
        for line in fp:
            if not line.strip():
                continue
            row = json.loads(line)
            try:
                obs = Observation(**{k: row[k] for k in (
                    "origin", "source", "event_id", "text", "url", "actor_key",
                    "observed_at_ms", "published_at_ms", "rights")})
            except (ValueError, TypeError, KeyError):
                raise ValueError("persisted receipt corrupt: refuse silent recovery") from None
            if row.get("event_hash") != obs.identity or row.get("content_hash") != obs.content_hash:
                raise ValueError("persisted receipt hash mismatch")
            recent.append(obs)
    count = 0
    for obs in recent:
        if radar.intake(obs) == "ADMITTED":
            count += 1
    # Recovered items reconstruct a bounded recent state but must never be emitted twice.
    radar.drain_receipts()
    return count

def sync_parent_directory(path: Path) -> None:
    """Best-effort POSIX directory durability for file creation / atomic rename."""
    if os.name == "posix":
        fd = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

def append_receipts(path: Path, receipts: list[dict]) -> None:
    if not receipts:
        return
    contents = "".join(json.dumps(r, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n"
                       for r in receipts).encode("utf-8")
    old_size = path.stat().st_size if path.exists() else 0
    if old_size + len(contents) > MAX_SPOOL_BYTES:
        raise ValueError("bounded evidence spool full; no cursor checkpoint permitted")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("ab") as fp:
        fp.write(contents)
        fp.flush()
        os.fsync(fp.fileno())
    sync_parent_directory(path)

async def main() -> int:
    ap = argparse.ArgumentParser(description="Read-only culture ingestion: NO live money or automated service")
    ap.add_argument("--network", action="store_true", help="Explicitly allow public-feed requests this invocation")
    ap.add_argument("--rss", action="append", default=[], metavar="HTTPS_URL",
                    help="Only manually approved publisher RSS URLs; never user-supplied at a public endpoint")
    ap.add_argument("--4chan-board", action="append", default=[], dest="boards", metavar="BOARD")
    ap.add_argument("--jetstream", action="store_true", help="Optional public Bluesky stream, requires websockets")
    ap.add_argument("--submissions", type=Path, help="Opt-in JSONL: consent, url, user-authored description")
    ap.add_argument("--out", type=Path, required=True, help="Private local JSONL receipts; 16 MiB hard cap")
    ap.add_argument("--state", type=Path, help="Private optional cursor state, written after receipt fsync")
    args = ap.parse_args()
    if (args.rss or args.boards or args.jetstream) and not args.network:
        ap.error("--network required for all external collection")
    if args.state and args.state.resolve() == args.out.resolve():
        ap.error("--state must be different from --out")

    radar = Radar()
    recovered = recover_seen(args.out, radar)
    adapters = []
    for url in args.rss:
        parsed = urlsplit(url)
        # Stable source identity across restarts and argument-order changes; never
        # confuse receipts when an operator reorders approved feed URLs.
        source_id = "rss/" + hashlib.sha256(url.encode("utf-8")).hexdigest()[:20]
        adapters.append(RSSAdapter(name=source_id, url=url, allowed_host=parsed.hostname or ""))
    for board in args.boards:
        adapters.append(FourChanAdapter(board=board))
    jet = JetstreamAdapter() if args.jetstream else None
    if jet:
        if args.state and args.state.exists():
            state = json.loads(args.state.read_text(encoding="utf-8"))
            cursor = state.get("jetstream_cursor_us")
            if cursor is not None:
                if not isinstance(cursor, int) or cursor <= 0:
                    raise ValueError("invalid durable Jetstream cursor")
                jet.cursor_us = cursor
        adapters.append(jet)
    if args.submissions:
        adapters.append(SubmissionAdapter(load_submissions(args.submissions)))
    if not adapters:
        ap.error("configure at least one source; no default network collection")

    now = millis()
    health = await Controller(adapters, radar).tick(now)
    receipts = radar.drain_receipts()
    append_receipts(args.out, receipts)
    if jet and args.state:
        # Checkpoint must happen after append_receipts succeeds.
        args.state.parent.mkdir(parents=True, exist_ok=True)
        temp = args.state.with_name(args.state.name + ".tmp")
        with temp.open("w", encoding="utf-8") as fp:
            fp.write(json.dumps({"jetstream_cursor_us": jet.cursor_us}))
            fp.flush()
            os.fsync(fp.fileno())
        temp.replace(args.state)
        sync_parent_directory(args.state)
    # Bounded summarized output; no raw submitted content on stdout.
    print(json.dumps({"mode": "RESEARCH_ONLY", "network": args.network, "recovered": recovered,
                      "new_receipts": len(receipts), "health": health,
                      "narratives_in_memory": len(radar.narratives),
                      "stats": vars(radar.stats)}, sort_keys=True))
    return 0

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
