#!/usr/bin/env python3
"""Route, inspect, and validate the standalone Buffett framework skill."""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import cast

SKILL_ROOT = Path(__file__).resolve().parent.parent
SKILL_PATH = SKILL_ROOT / "SKILL.md"
MINIMUM_CARD_LOAD = 5
MAXIMUM_CARD_LOAD = 12
EXPECTED_COUNTS = {
    "D": 9,
    "B": 7,
    "M": 8,
    "F": 7,
    "V": 6,
    "C": 9,
    "R": 7,
    "S": 12,
}
REFERENCE_FILES = {
    "D": "references/01-decision-posture.md",
    "B": "references/02-business-economics.md",
    "M": "references/03-management-governance.md",
    "F": "references/04-financial-reality.md",
    "V": "references/05-valuation.md",
    "C": "references/06-capital-allocation.md",
    "R": "references/07-risk-monitoring.md",
    "S": "references/08-specialized-overlays.md",
}
WORKFLOW_CARDS = {
    "financial-analysis": ("F01", "F02", "F05", "F06", "F07"),
    "memo-review": ("D01", "D03", "B02", "V01", "V05", "V06", "R01", "R07"),
    "thesis-evaluation": (
        "D02",
        "D03",
        "B01",
        "B06",
        "V01",
        "V04",
        "R01",
        "R07",
    ),
}
TOPIC_CARDS = {
    "business-model": ("B01",),
    "moat": ("B02",),
    "management": ("M01", "M02", "M03"),
    "governance": ("M04", "M05"),
    "integration-controls": ("M05", "M06"),
    "succession": ("M07", "M08"),
    "valuation": ("V01", "V03", "V05", "V06"),
    "capital-allocation": ("C01", "C03", "C04"),
    "dilution": ("C01", "C07"),
    "acquisition": ("C08", "C09"),
    "leverage": ("F07", "R01", "R02", "R03"),
    "insurance": ("S01", "S02", "S03"),
    "insurance-tail-risk": ("S04", "S05"),
    "insurance-moat": ("S06",),
    "banking": ("S07",),
    "consumer": ("S08",),
    "infrastructure": ("S09",),
    "technology": ("S10",),
    "energy": ("S11",),
    "special-instruments": ("S12",),
}
REQUIRED_CARD_FIELDS = (
    "Decision question",
    "Guidance",
    "Use when",
    "Analytical actions",
    "Output",
    "Limits",
    "Source basis",
    "Corroboration",
)
SOURCE_KEY_FILE = "references/00-source-key.md"
RETRIEVAL_SECTION_HEADING = "## Where to Retrieve Each Source"
RETRIEVAL_KEY_FORMS = (
    "BH<year>",
    "BPL<year>",
    "OM1996",
    "SI1984",
    "WB50-2015",
    "CM50-2015",
    "FL2025",
    "GC<year>",
    "SC<year>",
    "ACL2022",
    "ABM2010",
    "IL2001",
    "EWB",
    "LOW",
)
MINIMUM_ANALYTICAL_ACTIONS = 1
MAXIMUM_ANALYTICAL_ACTIONS = 3
MINIMUM_SOURCE_CITATIONS = 1
MAXIMUM_SOURCE_CITATIONS = 3
MINIMUM_CORROBORATION = 2
MAXIMUM_CORROBORATION = 4
MAXIMUM_DESCRIPTION_LENGTH = 1024
CORROBORATION_KEY: re.Pattern[str] = re.compile(
    r"^(?:BH\d{4}|BPL\d{4}|OM1996|SI1984|WB50-2015|CM50-2015|FL2025|GC\d{4}"
    r"|SC\d{4}|ACL2022|ABM2010|IL2001"
    r"|EWB §(?:Prologue|Epilogue|Afterword|[IVX]+\.[A-J])"
    r"|LOW (?:ch\.\d{1,2}|Intro|Afterword))"
    r"(?: \([^();]+\))?$"
)
CARD_HEADING: re.Pattern[str] = re.compile(
    r"^### ([DBMFVCRS]\d{2}) — (.+)$", re.MULTILINE
)
MARKDOWN_LINK: re.Pattern[str] = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
SOURCE_ENTRY: re.Pattern[str] = re.compile(r"^  - \*\*", re.MULTILINE)
SOURCE_ROLE: re.Pattern[str] = re.compile(
    r"\*(defines|supports|implements|illustrates|qualifies|specializes)\*:"
)
CARD_FIELD: re.Pattern[str] = re.compile(
    r"^- \*\*(?P<label>[^:]+):\*\*\s*(?P<value>.*?)(?=^- \*\*|^<a id=|^<!--|\Z)",
    re.MULTILINE | re.DOTALL,
)
UNPUBLISHABLE_TEXT = {
    "draft or preview label": re.compile(r"\b(?:draft|preview)\b", re.IGNORECASE),
    "opaque record identifier": re.compile(
        "".join((r"\brec", r"ord:[a-z0-9][a-z0-9:-]+"))
    ),
    "absolute workspace path": re.compile(
        r"(?:^|[\s(`'\"])/(?:Users|home|private|workspace)/", re.MULTILINE
    ),
    "parent-directory traversal": re.compile(r"(?:^|[(`'\"])(?:\.\./)+"),
}


def ordered_unique(values: Iterable[str]) -> list[str]:
    """Return values in first-seen order without duplicates."""
    return list(dict.fromkeys(values))


def card_locations() -> dict[str, str]:
    """Map every card ID to its stable reference location."""
    locations: dict[str, str] = {}
    for prefix, relative_path in REFERENCE_FILES.items():
        path = SKILL_ROOT / relative_path
        if not path.is_file():
            raise FileNotFoundError(f"missing reference file: {relative_path}")
        body = path.read_text(encoding="utf-8")
        for match in CARD_HEADING.finditer(body):
            card_id = match.group(1)
            if not card_id.startswith(prefix):
                raise ValueError(
                    f"{card_id} is in the wrong module file: {relative_path}"
                )
            if card_id in locations:
                raise ValueError(f"duplicate card ID: {card_id}")
            locations[card_id] = f"{relative_path}#{card_id.lower()}"
    return locations


def validate_local_links(path: Path, errors: list[str]) -> None:
    """Append failures for local Markdown links that do not resolve."""
    body = path.read_text(encoding="utf-8")
    for match in MARKDOWN_LINK.finditer(body):
        target = match.group(1)
        if target.startswith(("http://", "https://", "mailto:")):
            continue
        local_target, _separator, fragment = target.partition("#")
        resolved = path if not local_target else path.parent / local_target
        if not resolved.exists():
            errors.append(
                f"broken local link in {path.relative_to(SKILL_ROOT)}: {target}"
            )
            continue
        if fragment:
            target_body = resolved.read_text(encoding="utf-8")
            if f'id="{fragment}"' not in target_body:
                errors.append(
                    f"broken local anchor in {path.relative_to(SKILL_ROOT)}: {target}"
                )


def validate() -> int:
    """Validate package structure, public card contracts, and routing."""
    errors: list[str] = []
    locations = card_locations()
    expected_ids = {
        f"{prefix}{number:02d}"
        for prefix, count in EXPECTED_COUNTS.items()
        for number in range(1, count + 1)
    }
    actual_ids = set(locations)
    if actual_ids != expected_ids:
        errors.append(
            f"card namespace mismatch: missing={sorted(expected_ids - actual_ids)}, extra={sorted(actual_ids - expected_ids)}"
        )

    for prefix, expected_count in EXPECTED_COUNTS.items():
        actual_count = sum(card_id.startswith(prefix) for card_id in actual_ids)
        if actual_count != expected_count:
            errors.append(
                f"{prefix} module has {actual_count} cards; expected {expected_count}"
            )

    for relative_path in REFERENCE_FILES.values():
        path = SKILL_ROOT / relative_path
        body = path.read_text(encoding="utf-8")
        second_level_headings = re.findall(r"^## (.+)$", body, re.MULTILINE)
        if second_level_headings != ["Card Index", "Complete Cards"]:
            errors.append(
                f"unexpected section structure in {relative_path}: {second_level_headings}"
            )
        headings = list(CARD_HEADING.finditer(body))
        for index, match in enumerate(headings):
            end = (
                headings[index + 1].start() if index + 1 < len(headings) else len(body)
            )
            card_body = body[match.end() : end]
            field_matches = list(CARD_FIELD.finditer(card_body))
            field_labels = tuple(item.group("label") for item in field_matches)
            if field_labels != REQUIRED_CARD_FIELDS:
                errors.append(
                    f"{match.group(1)} has invalid field contract: {field_labels}"
                )
            field_values = {
                item.group("label"): item.group("value").strip()
                for item in field_matches
            }
            action_count = len(
                [
                    action
                    for action in field_values.get("Analytical actions", "").split(";")
                    if action.strip()
                ]
            )
            if (
                not MINIMUM_ANALYTICAL_ACTIONS
                <= action_count
                <= MAXIMUM_ANALYTICAL_ACTIONS
            ):
                errors.append(
                    f"{match.group(1)} has {action_count} analytical actions; expected {MINIMUM_ANALYTICAL_ACTIONS} to {MAXIMUM_ANALYTICAL_ACTIONS}"
                )
            source_count = len(SOURCE_ENTRY.findall(card_body))
            if not MINIMUM_SOURCE_CITATIONS <= source_count <= MAXIMUM_SOURCE_CITATIONS:
                errors.append(
                    f"{match.group(1)} has {source_count} source citations; expected {MINIMUM_SOURCE_CITATIONS} to {MAXIMUM_SOURCE_CITATIONS}"
                )
            role_count = len(SOURCE_ROLE.findall(card_body))
            if role_count != source_count:
                errors.append(
                    f"{match.group(1)} has {source_count} sources but {role_count} typed roles"
                )
            corroboration = " ".join(field_values.get("Corroboration", "").split())
            entries = [
                entry.strip()
                for entry in corroboration.rstrip(".").split(";")
                if entry.strip()
            ]
            if not MINIMUM_CORROBORATION <= len(entries) <= MAXIMUM_CORROBORATION:
                errors.append(
                    f"{match.group(1)} has {len(entries)} corroboration citations; expected {MINIMUM_CORROBORATION} to {MAXIMUM_CORROBORATION}"
                )
            for entry in entries:
                if not CORROBORATION_KEY.match(entry):
                    errors.append(
                        f"{match.group(1)} has an unrecognized corroboration citation: {entry}"
                    )
        if f"({SOURCE_KEY_FILE.rpartition('/')[2]})" not in body:
            errors.append(f"{relative_path} does not link the corroboration source key")
        validate_local_links(path, errors)

    source_key_path = SKILL_ROOT / SOURCE_KEY_FILE
    source_key_body = source_key_path.read_text(encoding="utf-8")
    heading_index = source_key_body.find(RETRIEVAL_SECTION_HEADING)
    if heading_index == -1:
        errors.append(f"{SOURCE_KEY_FILE} is missing the retrieval-location section")
    else:
        retrieval_body = source_key_body[heading_index:]
        for key_form in RETRIEVAL_KEY_FORMS:
            if f"`{key_form}`" not in retrieval_body:
                errors.append(
                    f"{SOURCE_KEY_FILE} retrieval section is missing an entry for `{key_form}`"
                )
    validate_local_links(source_key_path, errors)

    for intent, cards in WORKFLOW_CARDS.items():
        if not MINIMUM_CARD_LOAD <= len(cards) <= MAXIMUM_CARD_LOAD:
            errors.append(f"{intent} starts with {len(cards)} cards")
        unknown = set(cards) - actual_ids
        if unknown:
            errors.append(f"{intent} contains unknown cards: {sorted(unknown)}")

    for topic, cards in TOPIC_CARDS.items():
        unknown = set(cards) - actual_ids
        if unknown:
            errors.append(f"{topic} contains unknown cards: {sorted(unknown)}")
        for intent, workflow_cards in WORKFLOW_CARDS.items():
            routed_count = len(ordered_unique((*workflow_cards, *cards)))
            if routed_count > MAXIMUM_CARD_LOAD:
                errors.append(
                    f"{intent} plus {topic} routes {routed_count} cards; expected at most {MAXIMUM_CARD_LOAD}"
                )

    skill_body = SKILL_PATH.read_text(encoding="utf-8")
    if not skill_body.startswith("---\nname: buffett-investment-framework\n"):
        errors.append("SKILL.md has an invalid public skill name")
    for authority_boundary in (
        "not a buy, sell, hold",
        "position size",
        "execute a trade",
    ):
        if authority_boundary not in skill_body:
            errors.append(
                f"SKILL.md is missing authority boundary: {authority_boundary}"
            )
    if "[TODO" in skill_body:
        errors.append("SKILL.md contains an unresolved scaffold TODO")
    frontmatter_end = skill_body.find("\n---\n", 4)
    if frontmatter_end == -1:
        errors.append("SKILL.md is missing a closing frontmatter delimiter")
    else:
        frontmatter_block = skill_body[4 : frontmatter_end + 1]
        desc_match = re.search(r"^description: (.*)$", frontmatter_block, re.MULTILINE)
        if desc_match is None:
            errors.append("SKILL.md frontmatter is missing a description field")
        elif not desc_match.group(1).strip():
            errors.append("SKILL.md frontmatter has an empty description value")
        elif len(desc_match.group(1).strip()) > MAXIMUM_DESCRIPTION_LENGTH:
            errors.append(
                f"SKILL.md frontmatter description exceeds {MAXIMUM_DESCRIPTION_LENGTH} characters"
            )
    validate_local_links(SKILL_PATH, errors)

    public_files = [
        SKILL_PATH,
        SKILL_ROOT / "agents" / "openai.yaml",
        SKILL_ROOT / "scripts" / "framework.py",
        SKILL_ROOT / SOURCE_KEY_FILE,
        *(SKILL_ROOT / path for path in REFERENCE_FILES.values()),
    ]
    prose_files = [
        SKILL_PATH,
        SKILL_ROOT / "agents" / "openai.yaml",
        SKILL_ROOT / SOURCE_KEY_FILE,
        *(SKILL_ROOT / path for path in REFERENCE_FILES.values()),
    ]
    for path in prose_files:
        body = path.read_text(encoding="utf-8")
        for label, pattern in UNPUBLISHABLE_TEXT.items():
            if pattern.search(body):
                errors.append(f"{label} in public file: {path.relative_to(SKILL_ROOT)}")

    expected_paths = {path.relative_to(SKILL_ROOT) for path in public_files}
    actual_paths = {
        path.relative_to(SKILL_ROOT)
        for path in SKILL_ROOT.rglob("*")
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc"
    }
    if actual_paths != expected_paths:
        errors.append(
            f"package file mismatch: missing={sorted(expected_paths - actual_paths)}, extra={sorted(actual_paths - expected_paths)}"
        )

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1

    counts = "/".join(str(count) for count in EXPECTED_COUNTS.values())
    print(
        f"PASS: {len(actual_ids)} cards; module counts {counts}; public fields, source citations, corroboration keys, workflows, links, authority boundaries, description, and isolation checks resolve"
    )
    return 0


def route(intent: str, topics: list[str]) -> int:
    """Print a deterministic bounded card load and exact reference locations."""
    requested = list(WORKFLOW_CARDS[intent])
    for topic in topics:
        requested.extend(TOPIC_CARDS[topic])
    cards = ordered_unique(requested)
    if len(cards) > MAXIMUM_CARD_LOAD:
        print(
            f"ERROR: route requires {len(cards)} cards, above the {MAXIMUM_CARD_LOAD}-card cap; split the task or remove a topic",
            file=sys.stderr,
        )
        return 2

    locations = card_locations()
    print("status: ready")
    print(f"intent: {intent}")
    print(f"topics: {', '.join(topics) if topics else 'none'}")
    print(f"cards ({len(cards)}): {', '.join(cards)}")
    print("read:")
    for location in ordered_unique(locations[card_id] for card_id in cards):
        print(f"  - {location}")
    return 0


def show(card_id: str) -> int:
    """Print one complete card from its reference module."""
    normalized = card_id.upper()
    locations = card_locations()
    if normalized not in locations:
        print(f"ERROR: unknown card ID: {card_id}", file=sys.stderr)
        return 2
    relative_path = locations[normalized].split("#", maxsplit=1)[0]
    body = (SKILL_ROOT / relative_path).read_text(encoding="utf-8")
    matches = list(CARD_HEADING.finditer(body))
    for index, match in enumerate(matches):
        if match.group(1) != normalized:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        footer_start = body.find("\n<!--", match.end(), end)
        if footer_start != -1:
            end = footer_start
        if index + 1 < len(matches):
            next_anchor = body.rfind("\n<a id=", match.end(), end)
            if next_anchor != -1:
                end = next_anchor
        print(f"source: {locations[normalized]}")
        print(body[match.start() : end].rstrip())
        return 0
    raise AssertionError(f"indexed card is not readable: {normalized}")


def parser() -> argparse.ArgumentParser:
    """Build the command-line interface."""
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    _ = commands.add_parser("validate", help="validate the complete standalone package")

    route_parser = commands.add_parser("route", help="select a bounded card load")
    _ = route_parser.add_argument("--intent", required=True, choices=WORKFLOW_CARDS)
    _ = route_parser.add_argument(
        "--topic",
        action="append",
        default=[],
        choices=TOPIC_CARDS,
        help="add a material topic; repeat as needed",
    )

    show_parser = commands.add_parser("show", help="print one complete card")
    _ = show_parser.add_argument("--id", required=True, dest="card_id")
    return root


def main() -> int:
    """Run the requested framework command."""
    arguments = parser().parse_args()
    command = cast(str, arguments.command)
    try:
        if command == "validate":
            return validate()
        if command == "route":
            return route(cast(str, arguments.intent), cast(list[str], arguments.topic))
        if command == "show":
            return show(cast(str, arguments.card_id))
    except (OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    raise AssertionError(f"unhandled command: {command}")


if __name__ == "__main__":
    raise SystemExit(main())
