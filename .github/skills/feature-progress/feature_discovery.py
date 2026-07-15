"""
Feature Progress Skill — Feature Discovery
Iteration-path primary, tag secondary, board-position validation,
exclusion logic, result assembly with provenance tracking.

Covers: FR-01, EC-03, EC-04, EC-08, EC-09
"""

from __future__ import annotations

from dataclasses import dataclass, field

from constants import (
    DEFAULT_AREA, EXCLUSION_TAGS, INCLUSION_TAGS, PERIOD_ITERATIONS,
    SEPARATOR_IDS, SEPARATOR_START_ID, SEPARATOR_END_ID,
    STATE_CATEGORIES, ORG, PROJECT,
)
from ado_client import run_wiql, fetch_batch
from log_utils import log
from security_utils import validate_id, wiql_safe_id_list


@dataclass
class FeatureRecord:
    id: int
    title_raw: str
    fp: float | None
    iteration: str
    tags_raw: str
    provenance: set[str] = field(default_factory=set)
    state_raw: str = ""
    stack_rank: float | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass
class DiscoveryResult:
    features: list[FeatureRecord] = field(default_factory=list)
    diagnostics: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def _extract_feature(item: dict) -> FeatureRecord | None:
    """Extract a FeatureRecord from a raw ADO work item dict."""
    f = item.get("fields", {})
    raw_id = f.get("System.Id") or item.get("id")
    validated = validate_id(raw_id)
    if validated is None:
        return None
    if validated in SEPARATOR_IDS:
        return None

    return FeatureRecord(
        id=validated,
        title_raw=str(f.get("System.Title", "")).strip(),
        fp=f.get("Microsoft.VSTS.Scheduling.Effort"),
        iteration=str(f.get("System.IterationPath", "")),
        tags_raw=str(f.get("System.Tags", "") or ""),
        state_raw=str(f.get("System.State", "")),
        stack_rank=f.get("Microsoft.VSTS.Common.StackRank"),
    )


def _get_tags_set(tags_raw: str) -> set[str]:
    """Parse a semicolon-separated tag string into a set."""
    if not tags_raw:
        return set()
    return {t.strip() for t in tags_raw.split(";") if t.strip()}


def _has_exclusion_tag(tags: set[str]) -> str | None:
    """Check if any exclusion tag is present. Returns the tag if found."""
    for tag in tags:
        if tag in EXCLUSION_TAGS:
            return tag
    return None


def _is_removed_state(state: str) -> bool:
    return STATE_CATEGORIES.get(state, "in_progress") == "removed"


def _run_iteration_path_strategy() -> tuple[dict[int, FeatureRecord], list[str]]:
    """Primary strategy: features under period iteration paths."""
    log("Running iteration-path strategy...")
    features = {}
    warnings = []

    for iter_root in PERIOD_ITERATIONS:
        wiql = (
            f"SELECT [System.Id] FROM WorkItems "
            f"WHERE [System.WorkItemType] = 'Feature' "
            f"AND [System.AreaPath] UNDER '{DEFAULT_AREA}' "
            f"AND [System.IterationPath] UNDER '{iter_root}' "
            f"AND [System.State] <> 'Removed'"
        )
        ids = run_wiql(wiql)
        if not ids:
            continue

        items = fetch_batch(ids)
        for item in items:
            record = _extract_feature(item)
            if record and record.id not in features:
                record.provenance.add("iteration-path")
                features[record.id] = record
            elif record and record.id in features:
                features[record.id].provenance.add("iteration-path")

    log(f"  Iteration-path strategy found {len(features)} features")
    return features, warnings


def _run_tag_strategy(
    iteration_path_ids: set[int],
) -> tuple[dict[int, FeatureRecord], list[str]]:
    """Secondary strategy: features tagged with inclusion tags."""
    log("Running tag strategy...")
    features = {}
    warnings = []

    for tag in INCLUSION_TAGS:
        wiql = (
            f"SELECT [System.Id] FROM WorkItems "
            f"WHERE [System.WorkItemType] = 'Feature' "
            f"AND [System.AreaPath] UNDER '{DEFAULT_AREA}' "
            f"AND [System.Tags] CONTAINS '{tag}' "
            f"AND [System.State] <> 'Removed'"
        )
        ids = run_wiql(wiql)
        if not ids:
            continue

        items = fetch_batch(ids)
        for item in items:
            record = _extract_feature(item)
            if record is None:
                continue
            if record.id not in features:
                record.provenance.add("tag")
                features[record.id] = record
            else:
                features[record.id].provenance.add("tag")

            # Flag tag-only features not in iteration-path set
            if record.id not in iteration_path_ids:
                warn = (
                    f"Feature {record.id} is tagged {tag} but is not "
                    f"under a period iteration path — verify iteration assignment."
                )
                warnings.append(warn)
                record.warnings.append(warn)

    log(f"  Tag strategy found {len(features)} features")
    return features, warnings


def _run_board_validation(
    committed_ids: set[int],
) -> tuple[str, list[str]]:
    """Validation signal: board position between separators (demoted to warning-only)."""
    log("Running board-position validation...")
    warnings = []

    sep_list = wiql_safe_id_list(list(SEPARATOR_IDS))
    if not sep_list:
        warnings.append(
            "Board separators not found or ambiguous — board-position validation skipped"
        )
        return "skipped", warnings

    # Fetch separator items to get their StackRank
    sep_items = fetch_batch(list(SEPARATOR_IDS))
    if len(sep_items) < 2:
        warnings.append(
            "Board separators not found or ambiguous — board-position validation skipped"
        )
        return "skipped", warnings

    start_rank = None
    end_rank = None
    for item in sep_items:
        f = item.get("fields", {})
        item_id = validate_id(f.get("System.Id") or item.get("id"))
        rank = f.get("Microsoft.VSTS.Common.StackRank")
        if item_id == SEPARATOR_START_ID:
            start_rank = rank
        elif item_id == SEPARATOR_END_ID:
            end_rank = rank

    if start_rank is None or end_rank is None:
        warnings.append(
            "Board separators not found or ambiguous — board-position validation skipped"
        )
        return "skipped", warnings

    if start_rank == end_rank:
        warnings.append(
            "Board separators not found or ambiguous — board-position validation skipped"
        )
        return "skipped", warnings

    low_rank = min(start_rank, end_rank)
    high_rank = max(start_rank, end_rank)

    # Fetch all features in area to check board position
    wiql = (
        f"SELECT [System.Id] FROM WorkItems "
        f"WHERE [System.WorkItemType] = 'Feature' "
        f"AND [System.AreaPath] UNDER '{DEFAULT_AREA}' "
        f"AND [System.State] <> 'Removed'"
    )
    all_ids = run_wiql(wiql)
    if not all_ids:
        return "success", warnings

    all_items = fetch_batch(all_ids)
    for item in all_items:
        f = item.get("fields", {})
        item_id = validate_id(f.get("System.Id") or item.get("id"))
        if item_id is None or item_id in SEPARATOR_IDS:
            continue

        rank = f.get("Microsoft.VSTS.Common.StackRank")
        if rank is not None and low_rank < rank < high_rank:
            # Feature is between separators
            if item_id not in committed_ids:
                warnings.append(
                    f"Feature {item_id} is between board separators but not "
                    f"in a period iteration — stale separator placement?"
                )

    return "success", warnings


def _apply_exclusions(
    features: dict[int, FeatureRecord],
) -> tuple[dict[int, FeatureRecord], list[str]]:
    """Apply exclusion tags and removed-state filtering."""
    warnings = []
    excluded_ids = set()

    for fid, feature in features.items():
        tags = _get_tags_set(feature.tags_raw)

        # Check exclusion tags
        excl_tag = _has_exclusion_tag(tags)
        if excl_tag:
            log(f"Feature {fid} excluded — exclusion tag {excl_tag} overrides inclusion signals")
            warnings.append(
                f"Feature {fid} excluded — exclusion tag {excl_tag} overrides inclusion signals"
            )
            excluded_ids.add(fid)
            continue

        # Check removed state
        if _is_removed_state(feature.state_raw):
            excluded_ids.add(fid)
            continue

        # Check separator IDs (should already be filtered, but double-check)
        if fid in SEPARATOR_IDS:
            excluded_ids.add(fid)

    return {k: v for k, v in features.items() if k not in excluded_ids}, warnings


def provenance_label(provenance: set[str]) -> str:
    """Generate a human-readable provenance label."""
    parts = sorted(provenance)
    return " + ".join(parts) if parts else "unknown"


def discover() -> DiscoveryResult:
    """Run the full feature discovery pipeline."""
    result = DiscoveryResult()

    # Strategy 1: Iteration path (primary)
    iter_features, iter_warnings = _run_iteration_path_strategy()
    result.warnings.extend(iter_warnings)

    iter_status = "success" if iter_features else "empty"
    result.diagnostics["iteration_path"] = {
        "status": iter_status,
        "count": len(iter_features),
    }

    # Strategy 2: Tag (secondary)
    tag_features, tag_warnings = _run_tag_strategy(set(iter_features.keys()))
    result.warnings.extend(tag_warnings)

    tag_status = "success" if tag_features else "empty"
    result.diagnostics["tag"] = {
        "status": tag_status,
        "count": len(tag_features),
    }

    # Merge: union of both strategies, merge provenance sets
    merged: dict[int, FeatureRecord] = {}
    for fid, feature in iter_features.items():
        merged[fid] = feature
    for fid, feature in tag_features.items():
        if fid in merged:
            merged[fid].provenance.update(feature.provenance)
            merged[fid].warnings.extend(feature.warnings)
        else:
            merged[fid] = feature

    # Apply exclusions
    committed, excl_warnings = _apply_exclusions(merged)
    result.warnings.extend(excl_warnings)

    # Board-position validation (warning-only, does not modify committed set)
    try:
        board_status, board_warnings = _run_board_validation(set(committed.keys()))
        result.warnings.extend(board_warnings)
        result.diagnostics["board_position"] = {
            "status": board_status,
            "count": 0,  # Board position doesn't add features
        }
    except Exception as e:
        result.diagnostics["board_position"] = {
            "status": "skipped",
            "count": 0,
        }
        result.warnings.append(
            "Board separators not found or ambiguous — board-position validation skipped"
        )

    result.features = list(committed.values())
    log(f"Discovery complete: {len(result.features)} committed features")
    return result
