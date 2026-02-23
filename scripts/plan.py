#!/usr/bin/env python3
import re
import subprocess
import sys
from pathlib import Path


PLANNER_FILE = Path("planner-data.toml")
COMMIT_MESSAGE = "Update daily goals and top deliverables"


def ensure_trailing_period(value: str) -> str:
    normalized = value.strip().rstrip(".!?")
    if not normalized:
        return "."
    return f"{normalized}."


def toml_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def find_block_ranges(lines: list[str]) -> list[tuple[int, int]]:
    starts = [i for i, line in enumerate(lines) if line.strip() == "[[blocks]]"]
    if not starts:
        return []
    ranges: list[tuple[int, int]] = []
    for idx, start in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(lines)
        ranges.append((start, end))
    return ranges


def extract_title(lines: list[str], start: int, end: int) -> str | None:
    for i in range(start, end):
        m = re.match(r'^\s*title\s*=\s*"([^"]*)"\s*$', lines[i].rstrip("\n"))
        if m:
            return m.group(1)
    return None


def extract_description(lines: list[str], start: int, end: int) -> str | None:
    for i in range(start, end):
        m = re.match(r'^\s*description\s*=\s*"([^"]*)"\s*$', lines[i].rstrip("\n"))
        if m:
            return m.group(1)
    return None


def get_block_description(lines: list[str], title: str) -> str | None:
    for start, end in find_block_ranges(lines):
        if extract_title(lines, start, end) == title:
            return extract_description(lines, start, end)
    return None


def find_first_title(lines: list[str], titles: list[str]) -> str | None:
    for title in titles:
        if get_block_description(lines, title) is not None:
            return title
    return None


def replace_block_description(lines: list[str], title: str, description: str) -> bool:
    escaped = toml_escape(description)
    for start, end in find_block_ranges(lines):
        block_title = extract_title(lines, start, end)
        if block_title != title:
            continue
        for i in range(start, end):
            if re.match(r'^\s*description\s*=\s*".*"\s*$', lines[i].rstrip("\n")):
                lines[i] = f'description = "{escaped}"\n'
                return True
        return False
    return False


def read_top_deliverables(lines: list[str]) -> list[str]:
    start = None
    end = None
    key_match = None
    for i, line in enumerate(lines):
        if re.match(r"^\s*(top_deliverables|deliverables)\s*=\s*\[\s*$", line.rstrip("\n")):
            start = i
            key_match = True
            for j in range(i + 1, len(lines)):
                if lines[j].strip() == "]":
                    end = j
                    break
            break

    if start is None or end is None or not key_match:
        return ["", "", ""]

    values: list[str] = []
    for i in range(start + 1, end):
        m = re.match(r'^\s*"([^"]*)"\s*,?\s*$', lines[i].rstrip("\n"))
        if m:
            values.append(m.group(1))

    while len(values) < 3:
        values.append("")
    return values[:3]


def replace_or_add_top_deliverables(lines: list[str], deliverables: list[str]) -> None:
    escaped = [toml_escape(x) for x in deliverables]
    new_block = [
        "deliverables = [\n",
        f'  "{escaped[0]}",\n',
        f'  "{escaped[1]}",\n',
        f'  "{escaped[2]}",\n',
        "]\n",
    ]

    start = None
    end = None
    for i, line in enumerate(lines):
        if re.match(r"^\s*(top_deliverables|deliverables)\s*=\s*\[\s*$", line.rstrip("\n")):
            start = i
            for j in range(i + 1, len(lines)):
                if lines[j].strip() == "]":
                    end = j
                    break
            if end is None:
                raise RuntimeError("Malformed deliverables array in planner-data.toml")
            break

    if start is not None and end is not None:
        lines[start : end + 1] = new_block
        return

    insert_at = 0
    goals_start = None
    goals_end = None
    for i, line in enumerate(lines):
        if re.match(r"^\s*goals\s*=\s*\[\s*$", line.rstrip("\n")):
            goals_start = i
            for j in range(i + 1, len(lines)):
                if lines[j].strip() == "]":
                    goals_end = j
                    break
            break
    if goals_start is not None and goals_end is not None:
        insert_at = goals_end + 1
    while insert_at < len(lines) and lines[insert_at].strip() == "":
        insert_at += 1

    lines[insert_at:insert_at] = ["\n"] + new_block


def prompt_with_current(question: str, current: str, enforce_period: bool) -> str:
    shown = current if current else "(empty)"
    print(question)
    print(f"Current: {shown}")
    entered = input("Entry: ").strip()
    if not entered:
        return current
    if enforce_period:
        return ensure_trailing_period(entered)
    return entered


def run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, text=True, capture_output=True)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, end="", file=sys.stderr)
        raise RuntimeError(f"Command failed: {' '.join(cmd)}")
    if result.stdout:
        print(result.stdout, end="")


def main() -> int:
    if not PLANNER_FILE.exists():
        print(f"Missing file: {PLANNER_FILE}", file=sys.stderr)
        return 1

    original = PLANNER_FILE.read_text(encoding="utf-8")
    lines = original.splitlines(keepends=True)

    lba_title = "LBA Deep Work"
    ryan_title = "RyanBlunden.dev Deep Work"
    production_title = "Production"
    rnd_titles = ["L&D / Research Block", "R&D / Research", "R&D / Research Block", "Research"]
    rnd_title = find_first_title(lines, rnd_titles)

    lba_current = get_block_description(lines, lba_title)
    ryan_current = get_block_description(lines, ryan_title)
    production_current = get_block_description(lines, production_title)
    if lba_current is None:
        print(f'Could not find block with title "{lba_title}"', file=sys.stderr)
        return 1
    if ryan_current is None:
        print(f'Could not find block with title "{ryan_title}"', file=sys.stderr)
        return 1
    if production_current is None:
        print(f'Could not find block with title "{production_title}"', file=sys.stderr)
        return 1
    if rnd_title is None:
        print("Could not find an R&D/Research block title.", file=sys.stderr)
        return 1
    rnd_current = get_block_description(lines, rnd_title)
    if rnd_current is None:
        print("Could not read current R&D/Research description.", file=sys.stderr)
        return 1

    lba_goal = prompt_with_current("What is your LBA Deep Work goal today?", lba_current, enforce_period=True)
    ryan_goal = prompt_with_current("What is your RyanBlunden.dev Deep Work goal today?", ryan_current, enforce_period=True)
    production_goal = prompt_with_current("What is your Production goal today?", production_current, enforce_period=True)
    rnd_goal = prompt_with_current("What is your R&D goal today?", rnd_current, enforce_period=True)

    current_deliverables = read_top_deliverables(lines)
    deliverables = [
        prompt_with_current("Top deliverable 1:", current_deliverables[0], enforce_period=False),
        prompt_with_current("Top deliverable 2:", current_deliverables[1], enforce_period=False),
        prompt_with_current("Top deliverable 3:", current_deliverables[2], enforce_period=False),
    ]

    targets = [
        (lba_title, lba_goal),
        (ryan_title, ryan_goal),
        (production_title, production_goal),
    ]
    for title, description in targets:
        if not replace_block_description(lines, title, description):
            print(f'Could not find block with title "{title}"', file=sys.stderr)
            return 1

    if not replace_block_description(lines, rnd_title, rnd_goal):
        print("Could not find an R&D/Research block title.", file=sys.stderr)
        return 1

    replace_or_add_top_deliverables(lines, deliverables)

    updated = "".join(lines)
    if updated == original:
        print("No changes detected.")
        return 0

    PLANNER_FILE.write_text(updated, encoding="utf-8")
    print(f"Updated {PLANNER_FILE}")

    run(["git", "add", str(PLANNER_FILE)])
    run(["git", "commit", "-m", COMMIT_MESSAGE])
    run(["git", "push"])

    run(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    run(["git", "rev-parse", "--short", "HEAD"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
