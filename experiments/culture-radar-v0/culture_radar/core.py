"""Bounded, source-aware cultural observation core. No trades or network I/O."""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
import unicodedata
from collections import OrderedDict, defaultdict
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Protocol
from urllib.parse import urlsplit

MAX_TEXT = 4096
MAX_EVENT_ID = 320
ALLOWED_ORIGINS = frozenset({"rss", "fourchan", "jetstream", "submission"})
ALLOWED_RIGHTS = frozenset({"PUBLISHER_FEED", "PUBLIC_READ_API", "PUBLIC_STREAM", "EXPLICIT_USER_SUBMISSION"})
_PROMO = re.compile(r"\b(?:100x|1000x|guaranteed profits?|buy now|presale|send sol|send eth|airdrop)\b", re.I)
_URL = re.compile(r"https?://[^\s<>]+", re.I)
_WORD = re.compile(r"(?<!\w)[\w#]{4,}(?!\w)", re.UNICODE)

def millis() -> int:
    return int(time.time() * 1000)

def normalize(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())

def fingerprint(text: str) -> str:
    # Duplicate text is *not* evidence of distinct cultural adoption.
    cleaned = normalize(_URL.sub(" ", text))
    return hashlib.sha256(cleaned.encode()).hexdigest()

def https_url(url: str) -> bool:
    parts = urlsplit(url)
    return parts.scheme == "https" and bool(parts.hostname) and not parts.username and not parts.password

@dataclass(frozen=True, slots=True)
class Observation:
    origin: str
    source: str
    event_id: str
    text: str
    url: str
    actor_key: str
    observed_at_ms: int
    published_at_ms: int | None
    rights: str

    def __post_init__(self) -> None:
        expected_rights = {"rss": "PUBLISHER_FEED", "fourchan": "PUBLIC_READ_API",
                           "jetstream": "PUBLIC_STREAM", "submission": "EXPLICIT_USER_SUBMISSION"}
        if self.origin not in ALLOWED_ORIGINS or self.rights != expected_rights.get(self.origin):
            raise ValueError("source origin and acquisition rights must match")
        if not (1 <= len(self.source) <= 128 and 1 <= len(self.event_id) <= MAX_EVENT_ID):
            raise ValueError("invalid source or event identity")
        if not (1 <= len(self.text) <= MAX_TEXT) or not https_url(self.url):
            raise ValueError("unbounded content or invalid source URL")
        if not isinstance(self.observed_at_ms, int) or self.observed_at_ms <= 0:
            raise ValueError("missing actual collection time")
        if self.published_at_ms is not None:
            if not isinstance(self.published_at_ms, int) or self.published_at_ms <= 0:
                raise ValueError("invalid original timestamp")
        if len(self.actor_key) > 256:
            raise ValueError("unbounded actor key")

    @property
    def identity(self) -> str:
        return hashlib.sha256(f"{self.origin}\0{self.source}\0{self.event_id}".encode()).hexdigest()

    @property
    def content_hash(self) -> str:
        return fingerprint(self.text)

    def receipt(self) -> dict:
        record = asdict(self)
        record["event_hash"] = self.identity
        record["content_hash"] = self.content_hash
        return record

class Failure(Enum):
    TRANSIENT = "TRANSIENT"
    RATE_LIMIT = "RATE_LIMIT"
    ACCESS_DENIED = "ACCESS_DENIED"
    MALFORMED = "MALFORMED"

class SourceError(Exception):
    def __init__(self, failure: Failure, message: str = "") -> None:
        super().__init__(message or failure.value)
        self.failure = failure

@dataclass
class Breaker:
    failures: int = 0
    retry_at_ms: int = 0
    denied: bool = False
    last_success_ms: int | None = None
    last_failure: str | None = None

    def available(self, now_ms: int) -> bool:
        return not self.denied and now_ms >= self.retry_at_ms

    def success(self, now_ms: int) -> None:
        self.failures = 0
        self.retry_at_ms = 0
        self.last_success_ms = now_ms
        self.last_failure = None

    def fail(self, err: SourceError, now_ms: int) -> None:
        self.failures += 1
        self.last_failure = err.failure.value
        if err.failure is Failure.ACCESS_DENIED:
            self.denied = True  # No proxy/account rotation or access workaround.
        else:
            self.retry_at_ms = now_ms + min(60_000, 1000 * (2 ** min(self.failures, 6)))
            if err.failure is Failure.RATE_LIMIT:
                self.retry_at_ms = max(self.retry_at_ms, now_ms + 60_000)

    def coverage(self, now_ms: int, freshness_ms: int = 120_000) -> str:
        if self.denied:
            return "ACCESS_DENIED"
        if self.last_success_ms is None:
            return "UNAVAILABLE"
        return "FRESH" if now_ms - self.last_success_ms <= freshness_ms else "STALE"

class Adapter(Protocol):
    name: str
    platform: str
    rights: str
    async def poll(self, now_ms: int) -> list[Observation]: ...

@dataclass
class IntakeStats:
    admitted: int = 0
    duplicate: int = 0
    spam: int = 0
    saturated: int = 0

@dataclass
class Narrative:
    content_hash: str
    first_observed_ms: int
    last_observed_ms: int
    mentions: int = 0
    sources: set[str] = field(default_factory=set)
    actors: set[str] = field(default_factory=set)
    references: list[str] = field(default_factory=list)
    example_text: str = ""
    # A cluster is exact/near-exact normalized text only, NOT semantic understanding.
    def stage(self) -> str:
        if self.mentions >= 3 and len(self.sources) >= 2 and len(self.actors) >= 2:
            return "CROSS_SOURCE_WATCH"
        return "FLASH_WATCH"

class Radar:
    def __init__(self, *, max_seen: int = 20_000, max_narratives: int = 2048,
                 max_per_source_minute: int = 150, max_actor_keys: int = 32) -> None:
        self.max_seen, self.max_narratives = max_seen, max_narratives
        self.max_per_source_minute, self.max_actor_keys = max_per_source_minute, max_actor_keys
        self.seen: OrderedDict[str, None] = OrderedDict()
        self.narratives: OrderedDict[str, Narrative] = OrderedDict()
        self.admitted_in_window: dict[tuple[str, int], int] = defaultdict(int)
        self.stats = IntakeStats()
        self.accepted: list[Observation] = []

    def intake(self, obs: Observation) -> str:
        key = obs.identity
        if key in self.seen:
            self.stats.duplicate += 1
            return "DUPLICATE"
        # Rejected/promotional floods must not evict admitted event identities.
        minute = obs.observed_at_ms // 60_000
        window = (obs.source, minute)
        # Bounded memory for source-window accounting.
        if len(self.admitted_in_window) > 1024:
            self.admitted_in_window = defaultdict(
                int, {k: v for k, v in self.admitted_in_window.items() if k[1] >= minute - 2})
        if self.admitted_in_window[window] >= self.max_per_source_minute:
            self.stats.saturated += 1
            return "SATURATED"
        if _PROMO.search(obs.text) or len(_URL.findall(obs.text)) >= 3 or len(normalize(obs.text)) < 8:
            self.stats.spam += 1
            return "LOW_QUALITY"
        self.admitted_in_window[window] += 1
        self.seen[key] = None
        if len(self.seen) > self.max_seen:
            self.seen.popitem(last=False)
        f = obs.content_hash
        n = self.narratives.get(f)
        if n is None:
            if len(self.narratives) >= self.max_narratives:
                self.narratives.popitem(last=False)
            n = Narrative(f, obs.observed_at_ms, obs.observed_at_ms, example_text=obs.text[:500])
            self.narratives[f] = n
        n.mentions += 1
        n.last_observed_ms = max(n.last_observed_ms, obs.observed_at_ms)
        n.sources.add(obs.source)
        # Account keys are distinct *addresses*, not claims about independent humans.
        actor = hashlib.sha256(f"{obs.source}:{obs.actor_key}".encode()).hexdigest()
        if obs.actor_key and len(n.actors) < self.max_actor_keys:
            n.actors.add(actor)
        if obs.url not in n.references and len(n.references) < 8:
            n.references.append(obs.url)
        self.narratives.move_to_end(f)
        self.stats.admitted += 1
        self.accepted.append(obs)
        return "ADMITTED"

    def drain_receipts(self) -> list[dict]:
        receipts = [obs.receipt() for obs in self.accepted]
        self.accepted.clear()
        return receipts

    def snapshot(self, now_ms: int) -> list[dict]:
        return [
            {"id": n.content_hash, "stage": n.stage(), "first_observed_ms": n.first_observed_ms,
             "last_observed_ms": n.last_observed_ms, "mentions": n.mentions,
             "distinct_sources": len(n.sources), "distinct_account_keys_capped": len(n.actors),
             "references": n.references[:], "example_text": n.example_text,
             "fresh": now_ms - n.last_observed_ms <= 120_000}
            for n in self.narratives.values()
        ]

class Controller:
    """Independent source health; no source can masquerade as another platform."""
    def __init__(self, adapters: list[Adapter], radar: Radar) -> None:
        names = [a.name for a in adapters]
        if len(names) != len(set(names)):
            raise ValueError("adapter identities must be unique")
        for a in adapters:
            if a.rights not in ALLOWED_RIGHTS:
                raise ValueError("source rights missing")
        self.adapters = adapters
        self.radar = radar
        self.breakers = {a.name: Breaker() for a in adapters}

    async def tick(self, now_ms: int) -> dict:
        report: dict = {}
        expected_origins = {"rss": "rss", "fourchan": "fourchan",
                            "bluesky": "jetstream", "user_submissions": "submission"}
        for a in self.adapters:
            b = self.breakers[a.name]
            if not b.available(now_ms):
                report[a.name] = {"coverage": b.coverage(now_ms), "status": "SKIPPED",
                                  "failure": b.last_failure}
                continue
            try:
                # Independent timeout per adapter. One bad source cannot block the others.
                batch = await asyncio.wait_for(a.poll(now_ms), timeout=10)
                if not isinstance(batch, list) or len(batch) > 500:
                    raise SourceError(Failure.MALFORMED, "unbounded adapter response")
                if a.platform not in expected_origins:
                    raise SourceError(Failure.MALFORMED, "undeclared platform")
                # Validate every observation before mutating the radar. Bad source batches
                # must not poison canonical evidence or impersonate another platform.
                for obs in batch:
                    if not isinstance(obs, Observation) or obs.source != a.name or \
                            obs.origin != expected_origins[a.platform] or \
                            obs.rights != a.rights or obs.observed_at_ms != now_ms:
                        raise SourceError(Failure.MALFORMED, "inconsistent source receipt")
                admitted = sum(self.radar.intake(obs) == "ADMITTED" for obs in batch)
                b.success(now_ms)
                report[a.name] = {"coverage": b.coverage(now_ms), "status": "OK",
                                  "received": len(batch), "admitted": admitted}
            except SourceError as e:
                b.fail(e, now_ms)
                report[a.name] = {"coverage": b.coverage(now_ms), "status": "ERROR",
                                  "failure": e.failure.value}
            except (TimeoutError, OSError):
                b.fail(SourceError(Failure.TRANSIENT), now_ms)
                report[a.name] = {"coverage": b.coverage(now_ms), "status": "ERROR",
                                  "failure": "TRANSIENT"}
            except Exception:
                # Untrusted parser/adapter exceptions are contained. Never serialize the
                # exception because it might contain tokens, private endpoints or PII.
                b.fail(SourceError(Failure.MALFORMED), now_ms)
                report[a.name] = {"coverage": b.coverage(now_ms), "status": "ERROR",
                                  "failure": "MALFORMED"}
        return report

@dataclass(frozen=True)
class LaunchCandidate:
    chain_id: int
    contract: str
    name: str
    symbol: str
    metadata_links: tuple[str, ...]
    verified_factory: bool

def match_launch(launch: LaunchCandidate, radar: Radar, now_ms: int) -> list[dict]:
    """Evidence-based research priority ONLY. Does not authorize or recommend a buy."""
    if not launch.verified_factory or not re.fullmatch(r"0x[0-9a-fA-F]{40}", launch.contract):
        return []
    name = normalize(launch.name)
    symbol = normalize(launch.symbol).removeprefix("$")
    links = {u.lower().rstrip("/") for u in launch.metadata_links if https_url(u)}
    matches = []
    for n in radar.narratives.values():
        if now_ms - n.last_observed_ms > 120_000:
            continue
        exact_link = bool(links & {u.lower().rstrip("/") for u in n.references})
        text = normalize(n.example_text)
        term_match = any(len(s) >= 5 and re.search(r"(?<!\w)" + re.escape(s) + r"(?!\w)", text)
                         for s in (name, symbol) if s)
        if not exact_link and not term_match:
            continue
        matches.append({"narrative_id": n.content_hash,
                        "lane": "NARRATIVE_PRIORITY_RESEARCH" if exact_link and
                        n.stage() == "CROSS_SOURCE_WATCH" else "FLASH_WATCH",
                        "association": "REPORTED_EXACT_LINK" if exact_link else "UNVERIFIED_TEXT_MATCH",
                        "stage": n.stage()})
    return matches
