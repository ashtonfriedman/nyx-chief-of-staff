#!/usr/bin/env python3
"""
Feature Progress Skill — Unit Tests
Covers security utils, feature discovery logic, state classification,
metrics computation, pace classification, and dashboard rendering.
"""

import os
import sys
import unittest
from dataclasses import dataclass, field
from datetime import date

# Ensure skill directory is on the path
SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
if SKILL_DIR not in sys.path:
    sys.path.insert(0, SKILL_DIR)

from security_utils import html_escape, validate_id, build_ado_url, wiql_safe_id_list
from log_utils import sanitize_err
from state_classifier import classify_feature, StateBucket
from metrics import compute_metrics, MetricsResult
from pace_classifier import classify_pace, PaceStatus, PaceResult
from sprint_calendar import Sprint, SprintCalendar
from period_summary import compute_summary, PeriodStatus
from constants import STATE_CATEGORIES


# --- Mock data classes ---

@dataclass
class MockChild:
    id: int = 1
    state_raw: str = "Active"
    sp: float | None = None
    activated_date: date | None = None
    assigned_display_name: str = "Test User"
    tags_raw: str = ""
    is_blocked: bool = False
    title_raw: str = "Test Story"
    type: str = "User Story"


@dataclass
class MockFeature:
    id: int = 100
    title_raw: str = "Test Feature"
    fp: float | None = 5.0
    iteration: str = r"{ITERATION_PATH}\{FISCAL_YEAR}\Q1\Sprint 1"
    tags_raw: str = ""
    provenance: set = field(default_factory=lambda: {"iteration-path"})
    state_raw: str = "Active"
    warnings: list = field(default_factory=list)


# ================================================================
# Security Utils Tests
# ================================================================

class TestHtmlEscape(unittest.TestCase):
    def test_basic_escaping(self):
        self.assertEqual(html_escape("<script>alert('xss')</script>"),
                         "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;")

    def test_ampersand(self):
        self.assertEqual(html_escape("A&B"), "A&amp;B")

    def test_double_quotes(self):
        self.assertEqual(html_escape('title="test"'), "title=&quot;test&quot;")

    def test_single_quotes(self):
        self.assertEqual(html_escape("it's"), "it&#x27;s")

    def test_empty_string(self):
        self.assertEqual(html_escape(""), "")

    def test_none_returns_empty(self):
        self.assertEqual(html_escape(None), "")

    def test_no_special_chars(self):
        self.assertEqual(html_escape("Hello World 123"), "Hello World 123")

    def test_all_five_chars(self):
        result = html_escape('<>&"\'')
        self.assertNotIn("<", result)
        self.assertNotIn(">", result)
        self.assertNotIn("&", result.replace("&amp;", "").replace("&lt;", "")
                         .replace("&gt;", "").replace("&quot;", "")
                         .replace("&#x27;", ""))

    def test_mixed_content(self):
        """ADO title with HTML injection attempt."""
        malicious = '<img src=x onerror="alert(document.cookie)">'
        result = html_escape(malicious)
        self.assertNotIn("<img", result)
        # The angle brackets are escaped, so the tag won't render
        self.assertIn("&lt;img", result)
        self.assertIn("&quot;", result)


class TestValidateId(unittest.TestCase):
    def test_valid_integer(self):
        self.assertEqual(validate_id(12345), 12345)

    def test_valid_string(self):
        self.assertEqual(validate_id("12345"), 12345)

    def test_zero_rejected(self):
        self.assertIsNone(validate_id(0))

    def test_negative_rejected(self):
        self.assertIsNone(validate_id("-1"))

    def test_non_numeric_rejected(self):
        self.assertIsNone(validate_id("abc"))

    def test_float_string_rejected(self):
        self.assertIsNone(validate_id("12.5"))

    def test_empty_rejected(self):
        self.assertIsNone(validate_id(""))

    def test_none_rejected(self):
        self.assertIsNone(validate_id(None))

    def test_injection_rejected(self):
        self.assertIsNone(validate_id("12345; DROP TABLE"))

    def test_large_id(self):
        self.assertEqual(validate_id(10000029), 10000029)


class TestBuildAdoUrl(unittest.TestCase):
    def test_valid_url(self):
        url = build_ado_url(12345)
        self.assertIn("12345", url)
        self.assertIn("_workitems/edit/12345", url)

    def test_no_injection_in_url(self):
        url = build_ado_url(99999)
        self.assertTrue(url.endswith("/99999"))


class TestWiqlSafeIdList(unittest.TestCase):
    def test_valid_ids(self):
        self.assertEqual(wiql_safe_id_list([1, 2, 3]), "1,2,3")

    def test_empty_list(self):
        self.assertEqual(wiql_safe_id_list([]), "")

    def test_mixed_valid_invalid(self):
        result = wiql_safe_id_list([1, -1, 3])
        self.assertIn("1", result)
        self.assertIn("3", result)

    def test_string_ids(self):
        result = wiql_safe_id_list(["10", "20"])
        self.assertEqual(result, "10,20")


# ================================================================
# Log Utils Tests
# ================================================================

class TestSanitizeErr(unittest.TestCase):
    def test_truncation(self):
        long_msg = "x" * 300
        result = sanitize_err(long_msg)
        self.assertTrue(len(result) <= 203)  # 200 + "..."

    def test_bearer_stripping(self):
        msg = "Error: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9 failed"
        result = sanitize_err(msg)
        self.assertNotIn("eyJhbGci", result)
        self.assertIn("[CREDENTIAL_STRIPPED]", result)

    def test_pat_stripping(self):
        pat = "a" * 52
        msg = f"Auth failed with PAT {pat} expired"
        result = sanitize_err(msg)
        self.assertNotIn(pat, result)

    def test_empty(self):
        self.assertEqual(sanitize_err(""), "")

    def test_normal_message(self):
        msg = "Connection timeout after 30s"
        self.assertEqual(sanitize_err(msg), msg)


# ================================================================
# State Classifier Tests
# ================================================================

class TestStateClassification(unittest.TestCase):
    def test_no_children_not_started(self):
        result = classify_feature("Active", 5.0, [])
        self.assertEqual(result.bucket, StateBucket.NOT_STARTED)

    def test_no_children_no_fp_unscoped(self):
        result = classify_feature("Active", None, [])
        self.assertEqual(result.bucket, StateBucket.NOT_STARTED)
        self.assertTrue(result.is_unscoped)

    def test_all_children_complete(self):
        children = [
            MockChild(state_raw="Closed"),
            MockChild(state_raw="Done"),
        ]
        result = classify_feature("Active", 5.0, children)
        self.assertEqual(result.bucket, StateBucket.COMPLETE)

    def test_in_progress(self):
        children = [
            MockChild(state_raw="Active"),
            MockChild(state_raw="Closed"),
        ]
        result = classify_feature("Active", 5.0, children)
        self.assertEqual(result.bucket, StateBucket.IN_PROGRESS)

    def test_all_not_started(self):
        children = [
            MockChild(state_raw="New"),
            MockChild(state_raw="Proposed"),
        ]
        result = classify_feature("Active", 5.0, children)
        self.assertEqual(result.bucket, StateBucket.NOT_STARTED)

    def test_removed_feature(self):
        result = classify_feature("Removed", 5.0, [])
        self.assertEqual(result.bucket, StateBucket.REMOVED)

    def test_blocked_overlay(self):
        children = [
            MockChild(state_raw="Active", is_blocked=True),
            MockChild(state_raw="New"),
        ]
        result = classify_feature("Active", 5.0, children)
        self.assertEqual(result.bucket, StateBucket.IN_PROGRESS)
        self.assertTrue(result.blocked_overlay)

    def test_all_children_removed_ec02(self):
        children = [
            MockChild(state_raw="Removed"),
            MockChild(state_raw="Cut"),
        ]
        result = classify_feature("Active", 5.0, children)
        self.assertEqual(result.bucket, StateBucket.COMPLETE)
        self.assertTrue(result.all_removed_flag)

    def test_unknown_state_treated_as_in_progress(self):
        children = [
            MockChild(state_raw="SomeBizarreState"),
        ]
        result = classify_feature("Active", 5.0, children)
        self.assertEqual(result.bucket, StateBucket.IN_PROGRESS)

    def test_mixed_with_removed_children(self):
        children = [
            MockChild(state_raw="Active"),
            MockChild(state_raw="Removed"),
        ]
        result = classify_feature("Active", 5.0, children)
        self.assertEqual(result.bucket, StateBucket.IN_PROGRESS)


# ================================================================
# Metrics Tests
# ================================================================

class TestMetrics(unittest.TestCase):
    def test_basic_completion(self):
        children = [
            MockChild(state_raw="Closed", sp=5.0),
            MockChild(state_raw="Active", sp=3.0),
            MockChild(state_raw="New", sp=2.0),
        ]
        result = compute_metrics(children)
        self.assertEqual(result.total_stories, 3)
        self.assertEqual(result.done_stories, 1)
        self.assertAlmostEqual(result.story_completion_pct, 33.33, places=1)
        self.assertAlmostEqual(result.done_sp, 5.0)
        self.assertAlmostEqual(result.total_sp, 10.0)
        self.assertAlmostEqual(result.sp_completion_pct, 50.0)

    def test_sp_zero_counts_as_estimated(self):
        """EC-07: SP=0 is estimated, not missing."""
        children = [
            MockChild(state_raw="Closed", sp=0.0),
            MockChild(state_raw="Active", sp=5.0),
        ]
        result = compute_metrics(children)
        self.assertEqual(result.stories_with_sp, 2)
        self.assertAlmostEqual(result.sp_coverage_pct, 100.0)
        self.assertFalse(result.low_sp_coverage)

    def test_null_sp_reduces_coverage(self):
        """Null SP reduces coverage."""
        children = [
            MockChild(state_raw="Active", sp=None),
            MockChild(state_raw="Active", sp=None),
            MockChild(state_raw="Active", sp=5.0),
        ]
        result = compute_metrics(children)
        self.assertEqual(result.stories_with_sp, 1)
        self.assertAlmostEqual(result.sp_coverage_pct, 33.33, places=1)
        self.assertTrue(result.low_sp_coverage)

    def test_empty_children(self):
        result = compute_metrics([])
        self.assertEqual(result.total_stories, 0)
        self.assertEqual(result.done_stories, 0)

    def test_removed_excluded(self):
        children = [
            MockChild(state_raw="Closed", sp=5.0),
            MockChild(state_raw="Removed", sp=3.0),
        ]
        result = compute_metrics(children)
        self.assertEqual(result.total_stories, 1)
        self.assertEqual(result.done_stories, 1)

    def test_all_done_100_pct(self):
        children = [
            MockChild(state_raw="Closed", sp=5.0),
            MockChild(state_raw="Done", sp=3.0),
        ]
        result = compute_metrics(children)
        self.assertAlmostEqual(result.story_completion_pct, 100.0)
        self.assertAlmostEqual(result.sp_completion_pct, 100.0)

    def test_low_sp_coverage_threshold(self):
        """Below 50% coverage → low_sp_coverage = True."""
        children = [
            MockChild(state_raw="Active", sp=None),
            MockChild(state_raw="Active", sp=None),
            MockChild(state_raw="Active", sp=None),
            MockChild(state_raw="Active", sp=5.0),
        ]
        result = compute_metrics(children)
        self.assertAlmostEqual(result.sp_coverage_pct, 25.0)
        self.assertTrue(result.low_sp_coverage)
        self.assertFalse(result.sp_reliable)

    def test_at_50_pct_coverage_not_low(self):
        """Exactly 50% coverage → NOT low."""
        children = [
            MockChild(state_raw="Active", sp=None),
            MockChild(state_raw="Active", sp=5.0),
        ]
        result = compute_metrics(children)
        self.assertAlmostEqual(result.sp_coverage_pct, 50.0)
        self.assertFalse(result.low_sp_coverage)


# ================================================================
# Pace Classifier Tests
# ================================================================

def _make_calendar(sprints_count=13, start_year=2026, start_month=4, start_day=7) -> SprintCalendar:
    """Create a test sprint calendar."""
    cal = SprintCalendar()
    d = date(start_year, start_month, start_day)
    from datetime import timedelta
    for i in range(sprints_count):
        start = d + timedelta(days=14 * i)
        end = start + timedelta(days=13)
        cal.sprints.append(Sprint(
            path=f"{{ITERATION_PATH}}\\{{FISCAL_YEAR}}\\Q1\\Sprint {i + 1}",
            start_date=start,
            end_date=end,
        ))
    return cal


class TestPaceClassifier(unittest.TestCase):
    def test_on_pace(self):
        """Feature at expected completion rate — 50% done, 1 of 2 FP elapsed."""
        cal = _make_calendar()
        children = [
            MockChild(state_raw="Closed", sp=5.0, activated_date=date(2026, 4, 14)),
            MockChild(state_raw="Active", sp=5.0, activated_date=date(2026, 4, 14)),
        ]
        mr = MetricsResult(
            total_stories=2, done_stories=1,
            story_completion_pct=50.0,
            total_sp=10.0, done_sp=5.0, sp_completion_pct=50.0,
            stories_with_sp=2, sp_coverage_pct=100.0,
            low_sp_coverage=False, sp_reliable=True,
        )
        # ref_date is April 21, activation April 14 → 1 sprint elapsed
        # FP=2, so expected = 1/2 = 50%. Actual = 50%. On Pace.
        result = classify_pace(
            feature_fp=2.0, children=children,
            metrics_result=mr, calendar=cal,
            ref_date=date(2026, 4, 18),  # Mid-sprint 1 from activation
        )
        self.assertFalse(result.suppressed)
        self.assertEqual(result.status, PaceStatus.ON_PACE)

    def test_no_fp_suppressed(self):
        """EC-01: No FP → suppress pace."""
        cal = _make_calendar()
        mr = MetricsResult()
        result = classify_pace(
            feature_fp=None, children=[], metrics_result=mr, calendar=cal,
        )
        self.assertTrue(result.suppressed)
        self.assertIn("no FP estimate", result.reason)

    def test_no_activated_date_suppressed(self):
        """US-07: No ActivatedDate → suppress pace."""
        cal = _make_calendar()
        children = [MockChild(state_raw="Active", activated_date=None)]
        mr = MetricsResult(total_stories=1)
        result = classify_pace(
            feature_fp=3.0, children=children, metrics_result=mr, calendar=cal,
        )
        self.assertTrue(result.suppressed)
        self.assertIn("no activation date found", result.reason)

    def test_behind_pace(self):
        """Feature far behind expected rate."""
        cal = _make_calendar()
        children = [
            MockChild(state_raw="New", sp=5.0, activated_date=date(2026, 4, 7)),
            MockChild(state_raw="New", sp=5.0, activated_date=date(2026, 4, 7)),
        ]
        mr = MetricsResult(
            total_stories=2, done_stories=0,
            story_completion_pct=0.0,
            total_sp=10.0, done_sp=0.0, sp_completion_pct=0.0,
            stories_with_sp=2, sp_coverage_pct=100.0,
        )
        result = classify_pace(
            feature_fp=2.0, children=children,
            metrics_result=mr, calendar=cal,
            ref_date=date(2026, 5, 19),  # ~6 weeks in, 3 sprints elapsed
        )
        self.assertFalse(result.suppressed)
        self.assertEqual(result.status, PaceStatus.BEHIND)

    def test_low_sp_coverage_uses_story_count(self):
        """FR-04: Low SP coverage → pace uses story count."""
        cal = _make_calendar()
        children = [
            MockChild(state_raw="Closed", sp=None, activated_date=date(2026, 4, 7)),
            MockChild(state_raw="Active", sp=None, activated_date=date(2026, 4, 8)),
        ]
        mr = MetricsResult(
            total_stories=2, done_stories=1,
            story_completion_pct=50.0,
            total_sp=0.0, done_sp=0.0, sp_completion_pct=0.0,
            stories_with_sp=0, sp_coverage_pct=0.0,
            low_sp_coverage=True, sp_reliable=False,
        )
        result = classify_pace(
            feature_fp=2.0, children=children,
            metrics_result=mr, calendar=cal,
            ref_date=date(2026, 4, 21),
        )
        self.assertTrue(result.used_story_count)
        self.assertAlmostEqual(result.actual_pct, 50.0)


# ================================================================
# Period Summary Tests
# ================================================================

class TestPeriodSummary(unittest.TestCase):
    def _make_classification(self, bucket):
        from state_classifier import ClassificationResult
        return ClassificationResult(bucket=bucket)

    def test_basic_summary(self):
        features = [
            MockFeature(id=1, fp=3.0),
            MockFeature(id=2, fp=5.0),
        ]
        classifications = {
            1: self._make_classification(StateBucket.COMPLETE),
            2: self._make_classification(StateBucket.IN_PROGRESS),
        }
        cal = _make_calendar()
        summary = compute_summary(features, classifications, cal)
        self.assertAlmostEqual(summary.fp_committed, 8.0)
        self.assertAlmostEqual(summary.fp_completed, 3.0)
        self.assertAlmostEqual(summary.fp_remaining, 5.0)

    def test_no_fp_excluded_from_denominator(self):
        """EC-01: Features with no FP excluded from projection."""
        features = [
            MockFeature(id=1, fp=3.0),
            MockFeature(id=2, fp=None),
        ]
        classifications = {
            1: self._make_classification(StateBucket.COMPLETE),
            2: self._make_classification(StateBucket.IN_PROGRESS),
        }
        cal = _make_calendar()
        summary = compute_summary(features, classifications, cal)
        self.assertAlmostEqual(summary.fp_committed, 3.0)
        self.assertEqual(summary.features_without_fp, 1)

    def test_zero_elapsed_no_projection(self):
        """FR-06: Zero sprints elapsed → no projection."""
        features = [MockFeature(id=1, fp=5.0)]
        classifications = {
            1: self._make_classification(StateBucket.NOT_STARTED),
        }
        cal = SprintCalendar()  # Empty calendar
        summary = compute_summary(features, classifications, cal)
        self.assertFalse(summary.projection_available)
        self.assertEqual(summary.status, PeriodStatus.INSUFFICIENT_DATA)


# ================================================================
# Dashboard Rendering Tests
# ================================================================

class TestDashboardRendering(unittest.TestCase):
    def test_html_escape_in_feature_title(self):
        """SEC-05: ADO-sourced titles must be escaped in HTML."""
        from dashboard_html import generate_html
        from state_classifier import ClassificationResult
        from pace_classifier import PaceResult
        from child_fetcher import FeatureChildren

        feature = MockFeature(id=1, title_raw='<script>alert("xss")</script>')
        features = [feature]
        cls = {1: ClassificationResult(bucket=StateBucket.IN_PROGRESS)}
        mr = {1: MetricsResult(total_stories=1, done_stories=0)}
        pr = {1: PaceResult(suppressed=True, reason="test")}
        cm = {1: FeatureChildren(feature_id=1)}

        from period_summary import PeriodSummary
        summary = PeriodSummary(
            fp_committed=5, fp_completed=0, fp_remaining=5,
            sprints_elapsed=1, sprints_remaining=12,
        )

        html = generate_html(
            features=features, classifications=cls,
            metrics_map=mr, pace_map=pr, children_map=cm,
            summary=summary, diagnostics={}, discovery_warnings=[],
            zero_progress_alerts=[],
        )

        # Verify XSS payload is escaped
        self.assertNotIn('<script>alert', html)
        self.assertIn('&lt;script&gt;', html)

    def test_empty_dashboard_ec09(self):
        """EC-09: No features → empty dashboard renders."""
        from dashboard_html import render_empty_dashboard
        html = render_empty_dashboard({}, [])
        self.assertIn("No committed features found", html)
        self.assertIn("noindex", html)

    def test_footer_contains_required_elements(self):
        """FR-11 + SEC-04: Footer has timestamp and internal-use notice."""
        from dashboard_html import render_footer
        html = render_footer("2026-07-15 10:00 UTC")
        self.assertIn("2026-07-15 10:00 UTC", html)
        self.assertIn("Internal use only", html)
        self.assertIn("point-in-time", html)

    def test_noindex_meta_present(self):
        """SEC-04: noindex meta tag."""
        from dashboard_html import render_empty_dashboard
        html = render_empty_dashboard({}, [])
        self.assertIn('noindex, nofollow', html)

    def test_no_velocity_label(self):
        """FR-06: Dashboard must not use 'velocity' or 'burn rate' labels."""
        from dashboard_html import generate_html
        from state_classifier import ClassificationResult
        from pace_classifier import PaceResult
        from child_fetcher import FeatureChildren
        from period_summary import PeriodSummary

        feature = MockFeature(id=1, title_raw="Test Feature")
        summary = PeriodSummary(
            fp_committed=10, fp_completed=5, fp_remaining=5,
            sprints_elapsed=5, sprints_remaining=8,
            projection=13.0, projection_available=True,
        )

        html = generate_html(
            features=[feature],
            classifications={1: ClassificationResult(bucket=StateBucket.IN_PROGRESS)},
            metrics_map={1: MetricsResult()},
            pace_map={1: PaceResult(suppressed=True, reason="test")},
            children_map={1: FeatureChildren(feature_id=1)},
            summary=summary, diagnostics={}, discovery_warnings=[],
            zero_progress_alerts=[],
        )

        html_lower = html.lower()
        self.assertNotIn("burn rate", html_lower)
        self.assertNotIn("velocity", html_lower)


# ================================================================
# Sprint Calendar Tests
# ================================================================

class TestSprintCalendar(unittest.TestCase):
    def test_sprints_elapsed_mid_sprint(self):
        """EC-10: Current sprint counts as elapsed."""
        cal = _make_calendar()
        # Date is mid-sprint 2 (April 21-May 3)
        elapsed = cal.sprints_elapsed(ref_date=date(2026, 4, 25))
        self.assertGreaterEqual(elapsed, 2)

    def test_sprints_remaining(self):
        cal = _make_calendar(sprints_count=13)
        remaining = cal.sprints_remaining(ref_date=date(2026, 4, 10))
        self.assertGreater(remaining, 0)
        self.assertLessEqual(remaining, 13)

    def test_current_sprint(self):
        cal = _make_calendar()
        sprint = cal.get_current_sprint(ref_date=date(2026, 4, 10))
        self.assertIsNotNone(sprint)
        self.assertIn("Sprint 1", sprint.name)

    def test_period_bounds(self):
        cal = _make_calendar()
        self.assertIsNotNone(cal.period_start)
        self.assertIsNotNone(cal.period_end)
        self.assertLess(cal.period_start, cal.period_end)


# ================================================================
# Feature Discovery Logic Tests (unit-level, no ADO calls)
# ================================================================

class TestFeatureDiscoveryLogic(unittest.TestCase):
    def test_exclusion_tags_override(self):
        """EC-04: Exclusion tags always win."""
        from feature_discovery import _has_exclusion_tag, _get_tags_set
        tags = _get_tags_set("{FISCAL_QUARTER} Feature; CutTag; Important")
        result = _has_exclusion_tag(tags)
        self.assertEqual(result, "CutTag")

    def test_no_exclusion_tag(self):
        from feature_discovery import _has_exclusion_tag, _get_tags_set
        tags = _get_tags_set("{FISCAL_QUARTER} Feature; Committed")
        result = _has_exclusion_tag(tags)
        self.assertIsNone(result)

    def test_removed_state_detected(self):
        from feature_discovery import _is_removed_state
        self.assertTrue(_is_removed_state("Removed"))
        self.assertTrue(_is_removed_state("Cut"))
        self.assertFalse(_is_removed_state("Active"))
        self.assertFalse(_is_removed_state("Closed"))

    def test_provenance_label(self):
        from feature_discovery import provenance_label
        self.assertEqual(provenance_label({"iteration-path"}), "iteration-path")
        self.assertEqual(provenance_label({"iteration-path", "tag"}), "iteration-path + tag")
        self.assertEqual(provenance_label(set()), "unknown")

    def test_separator_ids_excluded(self):
        """EC-03: Separator IDs should be excluded."""
        from feature_discovery import _extract_feature
        item = {"fields": {"System.Id": 10000029, "System.Title": "---START---",
                           "System.State": "Active", "System.IterationPath": "test",
                           "System.Tags": ""}}
        result = _extract_feature(item)
        self.assertIsNone(result)

    def test_get_tags_set(self):
        from feature_discovery import _get_tags_set
        tags = _get_tags_set("tag1; tag2 ; tag3")
        self.assertEqual(tags, {"tag1", "tag2", "tag3"})

    def test_empty_tags(self):
        from feature_discovery import _get_tags_set
        self.assertEqual(_get_tags_set(""), set())
        self.assertEqual(_get_tags_set(None), set())


# ================================================================
# Constants Tests
# ================================================================

class TestConstants(unittest.TestCase):
    def test_state_categories_complete(self):
        """All expected states have mappings."""
        expected = ["New", "Active", "Closed", "Done", "Removed", "Resolved"]
        for state in expected:
            self.assertIn(state, STATE_CATEGORIES)

    def test_state_categories_values(self):
        valid_cats = {"not_started", "in_progress", "complete", "removed"}
        for state, cat in STATE_CATEGORIES.items():
            self.assertIn(cat, valid_cats, f"State '{state}' has invalid category '{cat}'")

    def test_separator_individual_constants_in_set(self):
        """SEPARATOR_START_ID and SEPARATOR_END_ID must be members of SEPARATOR_IDS."""
        from constants import SEPARATOR_START_ID, SEPARATOR_END_ID, SEPARATOR_IDS
        self.assertIn(SEPARATOR_START_ID, SEPARATOR_IDS)
        self.assertIn(SEPARATOR_END_ID, SEPARATOR_IDS)
        self.assertNotEqual(SEPARATOR_START_ID, SEPARATOR_END_ID)

    def test_separator_ids_set_size(self):
        """SEPARATOR_IDS must contain exactly two entries."""
        from constants import SEPARATOR_IDS
        self.assertEqual(len(SEPARATOR_IDS), 2)


class TestChildRecord(unittest.TestCase):
    def test_creates_with_all_fields(self):
        """ChildRecord is a clean dataclass — no custom __init__ side effects."""
        from child_fetcher import ChildRecord
        from datetime import date
        r = ChildRecord(
            id=42,
            type="User Story",
            state_raw="Active",
            sp=3.0,
            activated_date=date(2026, 4, 7),
            assigned_display_name="Alice",
            tags_raw="",
            title_raw="My story",
            is_blocked=False,
        )
        self.assertEqual(r.id, 42)
        self.assertEqual(r.title_raw, "My story")
        self.assertFalse(r.is_blocked)

    def test_title_raw_defaults_to_empty(self):
        """title_raw has a default of '' so it can be omitted."""
        from child_fetcher import ChildRecord
        r = ChildRecord(
            id=1, type="Bug", state_raw="New", sp=None,
            activated_date=None, assigned_display_name="Unassigned", tags_raw="",
        )
        self.assertEqual(r.title_raw, "")

    def test_is_blocked_defaults_false(self):
        """is_blocked defaults to False when not provided."""
        from child_fetcher import ChildRecord
        r = ChildRecord(
            id=1, type="User Story", state_raw="Active", sp=2.0,
            activated_date=None, assigned_display_name="Bob", tags_raw="",
        )
        self.assertFalse(r.is_blocked)


if __name__ == "__main__":
    unittest.main()
