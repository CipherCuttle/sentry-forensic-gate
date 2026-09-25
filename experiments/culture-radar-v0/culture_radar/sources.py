"""Explicitly permitted RSS, 4chan, Jetstream and user-submission adapters.

No X or Telegram website automation, login/session harvesting or proxy rotation.
Python standard library for RSS/4chan; optional 'websockets' for Jetstream.
"""
from __future__ import annotations

import asyncio
import hashlib
import html
from html.parser import HTMLParser
import ipaddress
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree as ET

from .core import Failure, Observation, SourceError, https_url, millis

MAX_RESPONSE_BYTES = 512_000
Fetch = Callable[[str, dict[str, str]], tuple[int, bytes, dict[str, str]]]

def public_configured_url(url: str, *, allowed_host: str) -> None:
    parsed = urlsplit(url)
    if not https_url(url) or parsed.hostname != allowed_host.lower() or parsed.port not in (None, 443):
        raise ValueError("URL is not an exact HTTPS allowlisted host")
    host = urlsplit(url).hostname or ""
    if host == "localhost" or host.endswith(".local"):
        raise ValueError("local hosts not allowed")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("literal IP addresses not allowed")

def fetch_limited(url: str, headers: dict[str, str], *, allowed_host: str) -> tuple[int, bytes, dict[str, str]]:
    public_configured_url(url, allowed_host=allowed_host)
    request = Request(url, headers={"User-Agent": "BINRAT-PONS-CultureRadar-Research/0.1",
                                    "Accept": "application/rss+xml, application/atom+xml, application/json",
                                    **headers})
    class _NoRedirect(HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise SourceError(Failure.ACCESS_DENIED, "cross-target redirect denied")

    try:
        with build_opener(_NoRedirect).open(request, timeout=6) as resp:
            if urlsplit(resp.geturl()).hostname != allowed_host:
                raise SourceError(Failure.ACCESS_DENIED, "redirect left the allowlist")
            data = resp.read(MAX_RESPONSE_BYTES + 1)
            if len(data) > MAX_RESPONSE_BYTES:
                raise SourceError(Failure.MALFORMED, "oversized source response")
            return resp.status, data, dict(resp.headers.items())
    except HTTPError as e:
        if e.code in (401, 403, 451):
            raise SourceError(Failure.ACCESS_DENIED) from e
        if e.code == 429:
            raise SourceError(Failure.RATE_LIMIT) from e
        if e.code == 304:
            return 304, b"", {}
        raise SourceError(Failure.TRANSIENT) from e
    except URLError as e:
        raise SourceError(Failure.TRANSIENT) from e

class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
    def handle_data(self, data: str) -> None:
        self.parts.append(data)

def plain(value: str) -> str:
    p = _Text()
    p.feed(value[:8192])
    return " ".join(html.unescape(" ".join(p.parts)).split())

def timestamp(raw: str | None) -> int | None:
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)

def parse_feed(body: bytes, *, source: str, observed_at_ms: int) -> list[Observation]:
    if len(body) > MAX_RESPONSE_BYTES or b"<!doctype" in body.lower() or b"<!entity" in body.lower():
        raise SourceError(Failure.MALFORMED, "unbounded or entity-bearing XML")
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        raise SourceError(Failure.MALFORMED, "bad RSS/Atom XML") from e
    def tag_text(node: ET.Element, tag: str) -> str:
        el = node.find(tag)
        if el is None:
            el = node.find("{*}" + tag)
        return el.text.strip() if el is not None and el.text else ""
    entries = root.findall(".//item")
    if not entries:
        entries = root.findall(".//{*}entry")
    out: list[Observation] = []
    for entry in entries[:200]:
        title = tag_text(entry, "title")
        summary = tag_text(entry, "description") or tag_text(entry, "summary") or tag_text(entry, "content")
        link = tag_text(entry, "link")
        if not link:
            links = entry.findall("{*}link")
            link = next((x.attrib.get("href", "") for x in links
                         if x.attrib.get("rel", "alternate") == "alternate"), "")
        if not https_url(link):
            continue
        raw_id = tag_text(entry, "guid") or tag_text(entry, "id") or link
        text = plain(title + " " + summary)[:4096]
        if not text:
            continue
        pub = timestamp(tag_text(entry, "pubDate") or tag_text(entry, "published") or
                        tag_text(entry, "updated"))
        out.append(Observation(origin="rss", source=source, event_id=hashlib.sha256(raw_id.encode()).hexdigest(),
                               text=text, url=link, actor_key="", observed_at_ms=observed_at_ms,
                               published_at_ms=pub, rights="PUBLISHER_FEED"))
    return out

@dataclass
class RSSAdapter:
    name: str
    url: str
    allowed_host: str
    fetcher: Fetch | None = None
    clock: Callable[[], int] = millis
    platform: str = "rss"
    rights: str = "PUBLISHER_FEED"
    etag: str = ""
    modified: str = ""

    def __post_init__(self) -> None:
        public_configured_url(self.url, allowed_host=self.allowed_host)

    async def poll(self, now_ms: int) -> list[Observation]:
        headers = {}
        if self.etag:
            headers["If-None-Match"] = self.etag
        if self.modified:
            headers["If-Modified-Since"] = self.modified
        f = self.fetcher or (lambda url, h: fetch_limited(url, h, allowed_host=self.allowed_host))
        status, body, result_headers = await asyncio.to_thread(f, self.url, headers)
        if status == 304:
            return []
        if status != 200 or len(body) > MAX_RESPONSE_BYTES:
            raise SourceError(Failure.TRANSIENT if status >= 500 else Failure.MALFORMED)
        self.etag = result_headers.get("ETag", self.etag)
        self.modified = result_headers.get("Last-Modified", self.modified)
        return parse_feed(body, source=self.name, observed_at_ms=self.clock())

def parse_4chan(body: bytes, *, board: str, observed_at_ms: int) -> list[Observation]:
    try:
        pages = json.loads(body)
        if not isinstance(pages, list):
            raise ValueError("not a page list")
    except (ValueError, UnicodeDecodeError) as e:
        raise SourceError(Failure.MALFORMED, "invalid catalog") from e
    out: list[Observation] = []
    for page in pages[:10]:
        if not isinstance(page, dict):
            continue
        for post in page.get("threads", [])[:50]:
            if not isinstance(post, dict) or not isinstance(post.get("no"), int):
                continue
            text = plain(str(post.get("sub", "")) + " " + str(post.get("com", "")))[:4096]
            if not text:
                continue
            no = post["no"]
            out.append(Observation(origin="fourchan", source="4chan/" + board,
                                   event_id=str(no), text=text,
                                   url=f"https://boards.4chan.org/{board}/thread/{no}", actor_key="",
                                   observed_at_ms=observed_at_ms,
                                   published_at_ms=post.get("time", 0) * 1000 if isinstance(post.get("time"), int) else None,
                                   rights="PUBLIC_READ_API"))
            if len(out) == 200:
                return out
    return out

@dataclass
class FourChanAdapter:
    board: str = "biz"
    name: str = "fourchan/biz"
    platform: str = "fourchan"
    rights: str = "PUBLIC_READ_API"
    fetcher: Fetch | None = None
    clock: Callable[[], int] = millis
    min_interval_ms: int = 11_000
    last_attempt_ms: int = 0

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[a-z0-9]{1,8}", self.board):
            raise ValueError("invalid 4chan board")
        self.name = "fourchan/" + self.board
        self.min_interval_ms = max(11_000, self.min_interval_ms)

    async def poll(self, now_ms: int) -> list[Observation]:
        if self.last_attempt_ms and now_ms - self.last_attempt_ms < self.min_interval_ms:
            return []
        self.last_attempt_ms = now_ms
        url = f"https://a.4cdn.org/{self.board}/catalog.json"
        f = self.fetcher or (lambda u, h: fetch_limited(u, h, allowed_host="a.4cdn.org"))
        status, body, _ = await asyncio.to_thread(f, url, {})
        if status != 200 or len(body) > MAX_RESPONSE_BYTES:
            raise SourceError(Failure.TRANSIENT if status >= 500 else Failure.MALFORMED)
        return parse_4chan(body, board=self.board, observed_at_ms=self.clock())

def parse_jetstream(record: dict, *, now_ms: int, terms: tuple[str, ...]) -> Observation | None:
    if record.get("kind") != "commit":
        return None
    commit = record.get("commit") or {}
    if commit.get("operation") != "create" or commit.get("collection") != "app.bsky.feed.post":
        return None
    post = commit.get("record") or {}
    text = post.get("text")
    did, rkey = record.get("did"), commit.get("rkey")
    if not all(isinstance(x, str) for x in (text, did, rkey)) or not text:
        return None
    if not any(re.search(r"(?<!\w)" + re.escape(term.casefold()) + r"(?!\w)", text.casefold())
               for term in terms):
        return None
    observed = now_ms  # Jetstream time_us is source time, not collection time.
    source_us = record.get("time_us")
    pub_ms = source_us // 1000 if isinstance(source_us, int) and source_us > 0 else timestamp(post.get("createdAt"))
    return Observation(origin="jetstream", source="bluesky/jetstream",
                       event_id=did + "/" + rkey, text=text[:4096],
                       url=f"https://bsky.app/profile/{did}/post/{rkey}",
                       actor_key=did, observed_at_ms=observed, published_at_ms=pub_ms,
                       rights="PUBLIC_STREAM")

@dataclass
class JetstreamAdapter:
    """Optional live WebSocket. Requires 'websockets>=14' installed explicitly."""
    name: str = "bluesky/jetstream"
    platform: str = "bluesky"
    rights: str = "PUBLIC_STREAM"
    endpoint: str = "wss://jetstream2.us-east.bsky.network/subscribe"
    terms: tuple[str, ...] = ("meme", "memecoin", "neet", "shitpost")
    cursor_us: int | None = None
    clock: Callable[[], int] = millis
    max_received: int = 300
    max_observations: int = 60
    window_seconds: float = 3.0

    async def poll(self, now_ms: int) -> list[Observation]:
        try:
            from websockets.asyncio.client import connect  # type: ignore[import-not-found]
        except ImportError as e:
            raise SourceError(Failure.MALFORMED, "optional websockets dependency absent") from e
        if not self.terms or not self.endpoint.startswith("wss://"):
            raise SourceError(Failure.MALFORMED, "bounded terms and wss endpoint required")
        query: list[tuple[str, str]] = [("wantedCollections", "app.bsky.feed.post")]
        if self.cursor_us is not None:
            query.append(("cursor", str(self.cursor_us)))
        url = self.endpoint + "?" + urlencode(query)
        out: list[Observation] = []
        newest = self.cursor_us
        try:
            async with connect(url, open_timeout=6, close_timeout=2, max_size=131_072) as ws:
                async with asyncio.timeout(self.window_seconds):
                    for _ in range(self.max_received):
                        raw = await ws.recv()
                        event = json.loads(raw)
                        if not isinstance(event, dict):
                            continue
                        time_us = event.get("time_us")
                        if isinstance(time_us, int) and time_us > 0:
                            newest = max(newest or 0, time_us)
                        obs = parse_jetstream(event, now_ms=self.clock(), terms=self.terms)
                        if obs:
                            out.append(obs)
                        if len(out) >= self.max_observations:
                            break
        except TimeoutError:
            pass  # Normal bounded sampling window; coverage remains sampled.
        except (OSError, ValueError) as e:
            raise SourceError(Failure.TRANSIENT) from e
        # Cursor is volatile; an external durable sink must checkpoint *after* receipts.
        self.cursor_us = newest
        return out

@dataclass
class SubmissionAdapter:
    """One-shot explicitly consented user-authored summaries + links, never channel scraping."""
    submissions: list[dict]
    name: str = "user/submissions"
    platform: str = "user_submissions"
    rights: str = "EXPLICIT_USER_SUBMISSION"
    offset: int = 0
    clock: Callable[[], int] = millis

    async def poll(self, now_ms: int) -> list[Observation]:
        out = []
        for x in self.submissions[self.offset:self.offset + 250]:
            if x.get("consent") is not True:
                continue
            url, description = x.get("url", ""), x.get("description", "")
            if not isinstance(url, str) or not isinstance(description, str) or not https_url(url):
                continue
            host = urlsplit(url).hostname
            if host not in {"x.com", "twitter.com", "t.me", "telegram.me"}:
                continue
            if not (8 <= len(description) <= 4096):
                continue
            # Neither authorship nor original-post content is verified by a submission.
            pseudonym = str(x.get("submitter_key", ""))[:256]
            eid = hashlib.sha256((url + "\0" + description + "\0" + pseudonym).encode()).hexdigest()
            out.append(Observation(origin="submission", source=self.name, event_id=eid,
                                   text=description, url=url, actor_key=pseudonym,
                                   observed_at_ms=self.clock(), published_at_ms=None,
                                   rights="EXPLICIT_USER_SUBMISSION"))
        self.offset += min(250, len(self.submissions) - self.offset)
        return out
