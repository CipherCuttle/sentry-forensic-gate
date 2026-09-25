import asyncio
import unittest

from culture_radar.core import (Breaker, Controller, Failure, LaunchCandidate, Observation,
                                Radar, SourceError, match_launch)

NOW = 1_790_337_000_000

def event(i: int, *, source: str = "rss/a", actor: str = "", text: str = "Unreasonably original dancing pigeon",
          url: str | None = None, observed: int = NOW) -> Observation:
    return Observation(origin="rss", source=source, event_id=str(i), text=text,
                       url=url or f"https://example.com/post/{i}", actor_key=actor,
                       observed_at_ms=observed, published_at_ms=observed - 1000,
                       rights="PUBLISHER_FEED")

class RadarTests(unittest.TestCase):
    def test_exact_event_dedup_is_bounded_and_receipts_are_drainable(self):
        r = Radar(max_seen=2)
        self.assertEqual(r.intake(event(1)), "ADMITTED")
        self.assertEqual(r.intake(event(1)), "DUPLICATE")
        self.assertEqual(len(r.drain_receipts()), 1)
        self.assertEqual(r.drain_receipts(), [])
        r.intake(event(2))
        r.intake(event(3))
        self.assertLessEqual(len(r.seen), 2)

    def test_promotional_flood_does_not_starve_a_new_joke(self):
        r = Radar(max_per_source_minute=2)
        for i in range(500):
            r.intake(event(i, text="Buy now! 1000x send ETH!"))
        self.assertEqual(r.intake(event(501, text="An entirely different independent absurd joke")), "ADMITTED")
        self.assertEqual(r.stats.spam, 500)
        self.assertEqual(r.stats.admitted, 1)

    def test_source_quota_and_cluster_memory_bounds(self):
        r = Radar(max_per_source_minute=2, max_narratives=1)
        self.assertEqual(r.intake(event(1)), "ADMITTED")
        self.assertEqual(r.intake(event(2, text="New very different meme")), "ADMITTED")
        self.assertEqual(r.intake(event(3, text="A third different meme")), "SATURATED")
        self.assertLessEqual(len(r.narratives), 1)

    def test_cross_source_requires_observed_activity_not_copy_count(self):
        r = Radar()
        for i in range(3):
            r.intake(event(i, source="rss/a", actor="same-bot"))
        n = next(iter(r.narratives.values()))
        self.assertEqual(n.stage(), "FLASH_WATCH")
        r.intake(event(3, source="rss/b", actor="other-author"))
        self.assertEqual(n.stage(), "CROSS_SOURCE_WATCH")

    def test_verified_launch_source_links_enable_research_not_trade(self):
        r = Radar()
        original = "https://example.com/original-post"
        for i, src in enumerate(("rss/a", "rss/a", "rss/b"), 1):
            r.intake(event(i, source=src, actor=str(i), url=original))
        l = LaunchCandidate(4663, "0x" + "a" * 40, "Dancing Pigeon", "PIGEON", (original,), True)
        matches = match_launch(l, r, NOW + 1)
        self.assertEqual(matches[0]["lane"], "NARRATIVE_PRIORITY_RESEARCH")
        self.assertEqual(matches[0]["association"], "REPORTED_EXACT_LINK")
        self.assertEqual(match_launch(LaunchCandidate(4663, l.contract, l.name, l.symbol, (original,), False), r, NOW), [])
        self.assertEqual(match_launch(l, r, NOW + 180_000), [])
        self.assertNotIn("BUY", matches[0]["lane"])

    def test_common_word_substrings_do_not_create_priority(self):
        r = Radar()
        r.intake(event(1, text="The copycat memes are everywhere"))
        l = LaunchCandidate(4663, "0x" + "b" * 40, "Cat", "CAT", (), True)
        self.assertEqual(match_launch(l, r, NOW), [])

    def test_observation_rights_and_url_fail_closed(self):
        with self.assertRaises(ValueError):
            Observation("rss", "rss/a", "1", "Valid narrative", "http://internal", "", NOW, NOW, "PUBLISHER_FEED")
        with self.assertRaises(ValueError):
            Observation("rss", "rss/a", "1", "Valid narrative", "https://example.org", "", NOW, NOW, "UNVERIFIED")

    def test_access_denied_disables_adapter_while_other_source_continues(self):
        class Denied:
            name, platform, rights = "x/unlicensed", "x", "PUBLISHER_FEED"
            calls = 0
            async def poll(self, now):
                self.calls += 1
                raise SourceError(Failure.ACCESS_DENIED)
        class Alternative:
            name, platform, rights = "rss/independent", "rss", "PUBLISHER_FEED"
            async def poll(self, now):
                return [event(1, source=self.name)]
        d = Denied()
        c = Controller([d, Alternative()], Radar())
        report = asyncio.run(c.tick(NOW))
        self.assertEqual(report[d.name]["failure"], "ACCESS_DENIED")
        self.assertEqual(report["rss/independent"]["admitted"], 1)
        report = asyncio.run(c.tick(NOW + 1000))
        self.assertEqual(report[d.name]["status"], "SKIPPED")
        self.assertEqual(d.calls, 1)

    def test_backoff_caps_and_recovery(self):
        b = Breaker()
        b.fail(SourceError(Failure.TRANSIENT), NOW)
        self.assertFalse(b.available(NOW + 100))
        self.assertTrue(b.available(NOW + 2000))
        b.fail(SourceError(Failure.RATE_LIMIT), NOW + 2000)
        self.assertFalse(b.available(NOW + 30_000))
        b.success(NOW + 70_000)
        self.assertEqual(b.coverage(NOW + 70_000), "FRESH")
        for _ in range(20):
            b.fail(SourceError(Failure.TRANSIENT), NOW)
        self.assertLessEqual(b.retry_at_ms - NOW, 60_000)

if __name__ == "__main__":
    unittest.main()
