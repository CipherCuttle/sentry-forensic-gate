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

if __name__ == "__main__":
    unittest.main()
