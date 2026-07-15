"""
Feature Progress Skill — Constants
Period configuration, ADO org/project, state category mappings,
separator IDs, exclusion/inclusion tags.

Configure your org/project via the ADO_ORG / ADO_PROJECT / ADO_AREA
environment variables (or memory.md).
"""

import os

ORG = os.environ.get("ADO_ORG", "https://dev.azure.com/{your-org}")
PROJECT = os.environ.get("ADO_PROJECT", "{your-project}")
DEFAULT_AREA = os.environ.get("ADO_AREA", "{your-area-path}")

AZ_CMD = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"

# Period iteration roots (both trees)
# Example iteration paths - replace with your own board's iteration paths
PERIOD_ITERATIONS = [
    r"{ITERATION_PATH}\{FISCAL_YEAR}\Q1\Sprints",
    r"{ITERATION_PATH}\{FISCAL_YEAR}\Q2",
]
# Board separator feature IDs (excluded from committed set)
# START separates the committed section above from uncommitted below;
# END marks the bottom of the committed section.
# Example IDs - replace with your own board's IDs
SEPARATOR_START_ID = 10000029
SEPARATOR_END_ID = 10000030
SEPARATOR_IDS = {SEPARATOR_START_ID, SEPARATOR_END_ID}

# Tags that exclude a feature regardless of other signals
EXCLUSION_TAGS = {"CutTag", "{FISCAL_QUARTER} Cut"}

# Tags that supplement iteration-path discovery
INCLUSION_TAGS = {"{FISCAL_QUARTER} Feature", "Committed"}

# Total sprints in the period
PERIOD_TOTAL_SPRINTS = 13

# Team name for iteration queries
TEAM_NAME = os.environ.get("ADO_TEAM", "{your-team}")

# State category mappings: known ADO state → category bucket
STATE_CATEGORIES = {
    # Not Started
    "New": "not_started",
    "Proposed": "not_started",
    "Ready to Code": "not_started",
    # In Progress
    "Active": "in_progress",
    "Committed": "in_progress",
    "Resolved": "in_progress",
    "In Progress": "in_progress",
    "Design": "in_progress",
    "Ready for Review": "in_progress",
    # Complete
    "Closed": "complete",
    "Done": "complete",
    "Completed": "complete",
    # Removed
    "Removed": "removed",
    "Cut": "removed",
}

# ADO work item URL template (validated integer ID inserted)
# Escape any braces from the ORG fallback placeholder so str.format only fills {id}
ADO_URL_TEMPLATE = ORG.replace("{", "{{").replace("}", "}}") + "/_workitems/edit/{id}"
