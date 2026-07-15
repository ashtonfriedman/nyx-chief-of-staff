"""Per-skill test isolation for the skills test suites.

Each skill under ``.github/skills/`` is a self-contained tool. Its tests put the
skill's own directory on ``sys.path`` and import helper modules by bare name
(e.g. ``from ado_client import ...``). Several skills independently define
modules that share a top-level name — for example ``ado_client`` exists in both
``feature-progress`` and ``sprint-planning``, and ``dashboard`` exists in three
skills. In a single shared interpreter ``sys.modules`` caches whichever skill
imported the name first, so a later skill silently receives the wrong module.
That makes each skill's tests pass in isolation but fail when the whole tree is
run at once (``pytest .github``).

This conftest restores isolation. Before every test it puts the test's own skill
directory at the front of ``sys.path`` and evicts any already-imported modules
that belong to a *different* skill, forcing bare imports to re-resolve against
the correct skill.
"""

import os
import sys

import pytest

SKILLS_ROOT = os.path.dirname(os.path.abspath(__file__))


def _colliding_module_names():
    """Top-level module basenames defined in more than one skill directory.

    Only these names are ambiguous under bare ``import``; unique modules are
    left untouched so patterns like ``mock.patch("pacing.date")`` keep working.
    """
    seen = {}
    for skill in os.listdir(SKILLS_ROOT):
        skill_dir = os.path.join(SKILLS_ROOT, skill)
        if not os.path.isdir(skill_dir):
            continue
        try:
            entries = os.listdir(skill_dir)
        except OSError:
            continue
        for entry in entries:
            if not entry.endswith(".py") or entry.startswith("test_"):
                continue
            if entry == "__init__.py":
                continue
            seen.setdefault(entry[:-3], set()).add(skill)
    return {name for name, skills in seen.items() if len(skills) > 1}


COLLIDING = _colliding_module_names()


def _skill_dir_for(path):
    """Return the top-level skill directory containing ``path``, or ``None``."""
    if not path:
        return None
    path = os.path.abspath(str(path))
    prefix = SKILLS_ROOT + os.sep
    if not path.startswith(prefix):
        return None
    top = os.path.relpath(path, SKILLS_ROOT).split(os.sep)[0]
    return os.path.join(SKILLS_ROOT, top)


@pytest.fixture(autouse=True)
def _isolate_skill_modules(request):
    skill_dir = _skill_dir_for(str(request.node.fspath))
    if skill_dir is None:
        yield
        return

    # Ensure this skill's directory resolves first for bare imports.
    if not sys.path or sys.path[0] != skill_dir:
        sys.path.insert(0, skill_dir)

    # Evict only *colliding* modules that were loaded from a different skill,
    # forcing their bare names to re-resolve against this skill on next import.
    for name in list(sys.modules):
        if name not in COLLIDING:
            continue
        other = _skill_dir_for(getattr(sys.modules[name], "__file__", None))
        if other is not None and other != skill_dir:
            del sys.modules[name]

    yield

