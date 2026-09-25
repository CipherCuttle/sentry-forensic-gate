import asyncio
import json
from pathlib import Path
import tempfile
import unittest

from culture_radar.cli import append_receipts, recover_seen
from culture_radar.core import Controller, Failure, Observation, Radar, SourceError
from culture_radar.sources import parse_feed

NOW = 1_790_337_000_000

def receipt(i, text="A uniquely hilarious dancing koala", source="rss/source"):
    return Observation("rss", source, str(i), text, f"https://publisher.org/{i}",
                       "", NOW, NOW - 100, "PUBLISHER_FEED")

class HostileTests(unittest.TestCase):
    def test_rejected_promotional_flood_cannot_evict_admitted_dedup_identity(self):
        radar = Radar(max_seen=2, max_per_source_minute=1000)
        legit = receipt(1)
        self.assertEqual(radar.intake(legit), "ADMITTED")
        for i in range(500):
            self.assertEqual(radar.intake(receipt(i + 2, "BUY NOW guaranteed profit!")), "LOW_QUALITY")
        self.assertEqual(radar.intake(legit), "DUPLICATE")
        self.assertEqual(radar.stats.admitted, 1)
        self.assertEqual(radar.stats.spam, 500)

    def test_tampering_before_recent_replay_window_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "spool.jsonl"
            originals = [receipt(i) for i in range(3)]
            append_receipts(path, [obs.receipt() for obs in originals])
            radar = Radar(max_seen=1)
            self.assertEqual(recover_seen(path, radar), 1)
            lines = path.read_text().splitlines()
            oldest = json.loads(lines[0])
            oldest["text"] = "Altered opening record"
            lines[0] = json.dumps(oldest)
            path.write_text("\n".join(lines) + "\n")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                recover_seen(path, Radar(max_seen=1))

    def test_claimed_acquisition_rights_cannot_impersonate_another_origin(self):
        with self.assertRaises(ValueError):
            Observation("rss", "rss/altered", "1", "An example of invalid source provenance",
                        "https://publisher.org/a", "", NOW, None, "PUBLIC_STREAM")

    def test_bad_batch_is_atomic_and_does_not_block_independent_source(self):
        class Forged:
            name, platform, rights = "rss/forged", "rss", "PUBLISHER_FEED"
            async def poll(self, now):
                return [receipt(1, source=self.name),
                        receipt(2, source="rss/other")]
        class Genuine:
            name, platform, rights = "rss/genuine", "rss", "PUBLISHER_FEED"
            async def poll(self, now):
                return [receipt(3, source=self.name)]
        r = Radar()
        status = asyncio.run(Controller([Forged(), Genuine()], r).tick(NOW))
        self.assertEqual(status["rss/forged"]["failure"], "MALFORMED")
        self.assertEqual(status["rss/genuine"]["admitted"], 1)
        self.assertEqual(r.stats.admitted, 1)

    def test_timeout_source_does_not_starve_other_source(self):
        class Timeout:
            name, platform, rights = "rss/timeout", "rss", "PUBLISHER_FEED"
            async def poll(self, now):
                raise TimeoutError()
        class Good:
            name, platform, rights = "rss/good", "rss", "PUBLISHER_FEED"
            async def poll(self, now):
                return [receipt(1, source=self.name)]
        r = Radar()
        status = asyncio.run(Controller([Timeout(), Good()], r).tick(NOW))
        self.assertEqual(status["rss/timeout"]["failure"], "TRANSIENT")
        self.assertEqual(status["rss/good"]["admitted"], 1)

    def test_dangerous_xml_constructs_rejected_even_with_valid_root(self):
        bad = b'<!DOCTYPE foo [<!ENTITY foo "expanded">]><rss><channel /></rss>'
        with self.assertRaises(SourceError) as err:
            parse_feed(bad, source="rss/test", observed_at_ms=NOW)
        self.assertEqual(err.exception.failure, Failure.MALFORMED)

    def test_slow_collector_does_not_hold_fast_receipt_publication(self):
        class Slow:
            name, platform, rights = "rss/slow", "rss", "PUBLISHER_FEED"
            async def poll(self, now):
                await asyncio.sleep(0.05)
                item = receipt(1, source=self.name)
                return [Observation(item.origin, item.source, item.event_id, item.text,
                                    item.url, item.actor_key, now + 50,
                                    item.published_at_ms, item.rights)]
        class Fast:
            name, platform, rights = "rss/fast", "rss", "PUBLISHER_FEED"
            async def poll(self, now):
                await asyncio.sleep(0.001)
                item = receipt(2, source=self.name)
                return [Observation(item.origin, item.source, item.event_id, item.text,
                                    item.url, item.actor_key, now + 2,
                                    item.published_at_ms, item.rights)]
        order = []
        status = asyncio.run(Controller([Slow(), Fast()], Radar()).tick(
            NOW, on_receipts=lambda batch: order.extend(r["source"] for r in batch)))
        self.assertEqual(order, ["rss/fast", "rss/slow"])
        self.assertEqual(status["rss/fast"]["admitted"], 1)
        self.assertEqual(status["rss/slow"]["admitted"], 1)

    def test_backdated_receipt_from_adapter_is_rejected(self):
        class Liar:
            name, platform, rights = "rss/old", "rss", "PUBLISHER_FEED"
            async def poll(self, now):
                item = receipt(8, source=self.name)
                return [Observation(item.origin, item.source, item.event_id, item.text,
                                    item.url, item.actor_key, now - 500,
                                    item.published_at_ms, item.rights)]
        radar = Radar()
        status = asyncio.run(Controller([Liar()], radar).tick(NOW))
        self.assertEqual(status["rss/old"]["failure"], "MALFORMED")
        self.assertEqual(radar.stats.admitted, 0)

    def test_clock_marks_actual_fetch_completion_not_request_start(self):
        from culture_radar.sources import RSSAdapter
        feed = b"<rss><channel><item><title>New bizarre dancing pigeon meme</title><link>https://publisher.org/p</link></item></channel></rss>"
        a = RSSAdapter(name="rss/publisher", url="https://publisher.org/feed",
                       allowed_host="publisher.org", fetcher=lambda *_: (200, feed, {}),
                       clock=lambda: NOW + 3456)
        observations = asyncio.run(a.poll(NOW))
        self.assertEqual(observations[0].observed_at_ms, NOW + 3456)

if __name__ == "__main__":
    unittest.main()
