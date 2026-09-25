import asyncio
import json
from pathlib import Path
import tempfile
import unittest

from culture_radar.cli import append_receipts, recover_seen
from culture_radar.core import Failure, Radar, SourceError
from culture_radar.sources import (FourChanAdapter, JetstreamAdapter, RSSAdapter,
                                   SubmissionAdapter, parse_4chan, parse_feed,
                                   parse_jetstream, public_configured_url)

NOW = 1_790_337_000_000

class SourceTests(unittest.TestCase):
    def test_rss_and_atom_parse_source_timestamps(self):
        rss = b"""<rss><channel><item><title>Talking pigeon launches</title><link>https://publisher.org/post</link><guid>article-1</guid><description><![CDATA[<b>A new viral joke is forming</b>]]></description><pubDate>Fri, 25 Sep 2026 09:00:00 GMT</pubDate></item></channel></rss>"""
        records = parse_feed(rss, source="rss/publisher", observed_at_ms=NOW)
        self.assertEqual(len(records), 1)
        self.assertIn("viral joke", records[0].text)
        self.assertIsNotNone(records[0].published_at_ms)
        self.assertNotEqual(records[0].published_at_ms, NOW)
        atom = b"""<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Other unusual pigeon</title><id>tag:p,1</id><link href="https://publisher.org/atom/post"/><summary>Some new meme spread</summary><published>2026-09-25T09:02:00Z</published></entry></feed>"""
        a = parse_feed(atom, source="rss/publisher", observed_at_ms=NOW)
        self.assertEqual(len(a), 1)
        self.assertEqual(a[0].url, "https://publisher.org/atom/post")

    def test_rss_etag_304_and_errors(self):
        calls = []
        def fetch(url, headers):
            calls.append(headers)
            if len(calls) == 1:
                return 200, b"<rss><channel><item><title>Some interesting new culture</title><link>https://publisher.org/new</link></item></channel></rss>", {"ETag": "v1"}
            return 304, b"", {}
        a = RSSAdapter("publisher", "https://publisher.org/rss", "publisher.org", fetcher=fetch)
        self.assertEqual(len(asyncio.run(a.poll(NOW))), 1)
        self.assertEqual(asyncio.run(a.poll(NOW + 1000)), [])
        self.assertEqual(calls[1]["If-None-Match"], "v1")
        with self.assertRaises(SourceError) as ctx:
            parse_feed(b"not XML", source="publisher", observed_at_ms=NOW)
        self.assertEqual(ctx.exception.failure, Failure.MALFORMED)

    def test_http_exact_allowlist(self):
        public_configured_url("https://publisher.org/rss", allowed_host="publisher.org")
        for url in ("http://publisher.org/rss", "https://localhost/rss",
                    "https://127.0.0.1/rss", "https://publisher.org.evil.io/rss",
                    "https://someuser@publisher.org/rss"):
            with self.assertRaises(ValueError):
                public_configured_url(url, allowed_host="publisher.org")

    def test_fourchan_catalog_and_rate_limit(self):
        body = json.dumps([{"threads": [{"no": 123, "sub": "Fresh internet meme",
                                          "com": "<b>Fresh pigeon joke</b>",
                                          "time": 1790337000}]}]).encode()
        parsed = parse_4chan(body, board="biz", observed_at_ms=NOW)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0].url, "https://boards.4chan.org/biz/thread/123")
        self.assertIn("pigeon joke", parsed[0].text)
        calls = []
        def fetch(url, headers):
            calls.append(url)
            return 200, body, {}
        a = FourChanAdapter(fetcher=fetch)
        asyncio.run(a.poll(NOW))
        asyncio.run(a.poll(NOW + 1000))
        self.assertEqual(len(calls), 1)

    def test_jetstream_parser_and_term_filter(self):
        p = {"kind": "commit", "did": "did:plc:abc123", "time_us": NOW * 1000,
             "commit": {"operation": "create", "collection": "app.bsky.feed.post", "rkey": "r1",
                        "record": {"text": "A completely new #meme is being remixed",
                                   "createdAt": "2026-09-25T09:00:00Z"}}}
        item = parse_jetstream(p, now_ms=NOW, terms=("meme",))
        self.assertIsNotNone(item)
        self.assertEqual(item.published_at_ms, NOW)
        self.assertEqual(item.observed_at_ms, NOW)
        self.assertIsNone(parse_jetstream(p, now_ms=NOW, terms=("other",)))
        p["commit"]["operation"] = "delete"
        self.assertIsNone(parse_jetstream(p, now_ms=NOW, terms=("meme",)))

    def test_explicit_submission_keeps_user_summary_not_external_post(self):
        submissions = [
            {"consent": True, "url": "https://x.com/author/status/1",
             "description": "I noticed a new pigeon meme today", "submitter_key": "user-1"},
            {"consent": False, "url": "https://t.me/channel/3",
             "description": "This summary was not consented"},
            {"consent": True, "url": "https://unknown.example/post",
             "description": "This is not a permitted submission host"},
        ]
        a = SubmissionAdapter(submissions)
        batch = asyncio.run(a.poll(NOW))
        self.assertEqual(len(batch), 1)
        self.assertIsNone(batch[0].published_at_ms)
        self.assertEqual(batch[0].rights, "EXPLICIT_USER_SUBMISSION")
        self.assertEqual(asyncio.run(a.poll(NOW + 1)), [])

    def test_durable_receipt_replay_and_tamper_detection(self):
        from culture_radar.core import Observation
        from culture_radar.cli import MAX_SPOOL_BYTES
        obs = Observation("rss", "publisher", "evt1", "Original pigeon meme spreads",
                          "https://publisher.org/pigeon", "", NOW, None, "PUBLISHER_FEED")
        r = Radar()
        r.intake(obs)
        with tempfile.TemporaryDirectory() as directory:
            spool = Path(directory) / "events.jsonl"
            append_receipts(spool, r.drain_receipts())
            recovered = Radar()
            self.assertEqual(recover_seen(spool, recovered), 1)
            self.assertEqual(recovered.intake(obs), "DUPLICATE")
            tampered = json.loads(spool.read_text())
            tampered["text"] = "forged new content"
            spool.write_text(json.dumps(tampered) + "\n")
            with self.assertRaises(ValueError):
                recover_seen(spool, Radar())

if __name__ == "__main__":
    unittest.main()
