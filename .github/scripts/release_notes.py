#!/usr/bin/env python3
"""
Build the body of a GitHub release page. Copy to .github/scripts/release_notes.py.

The body has three parts, each left out when empty:

  1. The release's intro from CHANGELOG.md: the text between the "## [x.y.z] - date" heading
     and the first "### Added/Changed/Fixed/..." heading (or the next "## " heading), copied
     verbatim. Write it as you want it on the release page (it is Markdown either way).
  2. GitHub's auto-generated notes ("What's Changed" PR list and the **Full Changelog** link),
     read from a file the workflow writes with
     `gh api --method POST repos/$GITHUB_REPOSITORY/releases/generate-notes -f tag_name=... --jq .body`.
  3. Features / Fixes / Refactor lists from Conventional Commit subjects (feat, fix, refactor; an
     optional "(scope)", "!" on either side of it = breaking) in <previous tag>..<tag>, or the whole
     history up to the tag when there is no previous tag. Other prefixes are ignored.

The tag comes from --tag or GITHUB_REF_NAME (a leading "v" is ignored when matching the CHANGELOG).
Pure standard library, Python 3.9+. A version missing from CHANGELOG.md is a warning, not an error
(check_version.py is the gate).

Usage:
    release_notes.py [--tag v1.2.3] [--changelog CHANGELOG.md] [--auto-notes auto_notes.md]
                     [--range v1.2.2..v1.2.3] [--no-commits] [--intro-only]
"""
import argparse
import os
import re
import subprocess
import sys

COMMIT_SECTIONS = (("feat", "Features"), ("fix", "Fixes"), ("refactor", "Refactor"))
COMMIT_PATTERN = re.compile(r"^(feat|fix|refactor)(!)?(\([^)]*\))?(!)?: (.+)$")


def changelog_intro(text, version):
    """Text between the version's "## " heading and its first "### " (or next "## ") heading."""
    heading = re.compile(r"^##\s+\[?v?" + re.escape(version) + r"\]?(?:\s|$)")
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if heading.match(line):
            body = []
            for following in lines[i + 1:]:
                if following.startswith("### ") or following.startswith("## "):
                    break
                body.append(following)
            return "\n".join(body).strip("\n").rstrip(), True
    return "", False


def previous_tag(tag):
    result = subprocess.run(
        ["git", "describe", "--tags", "--abbrev=0", f"{tag}^"],
        capture_output=True, text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def commit_sections(rng):
    subjects = subprocess.run(
        ["git", "log", rng, "--pretty=format:%s"],
        capture_output=True, text=True, check=True,
    ).stdout.splitlines()
    items = {prefix: [] for prefix, _ in COMMIT_SECTIONS}
    for subject in subjects:
        m = COMMIT_PATTERN.match(subject)
        if m:
            prefix, bang_before, _scope, bang_after, rest = m.groups()
            if bang_before or bang_after:
                rest = f"BREAKING CHANGE: {rest}"
            items[prefix].append(rest)
    blocks = []
    for prefix, title in COMMIT_SECTIONS:
        if items[prefix]:
            blocks.append("\n".join([f"{title}:", ""] + [f"* {item}" for item in items[prefix]]))
    return "\n\n".join(blocks)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tag", default=os.environ.get("GITHUB_REF_NAME", ""))
    parser.add_argument("--changelog", default="CHANGELOG.md")
    parser.add_argument("--auto-notes", help="file with GitHub's generated notes")
    parser.add_argument("--range", help="git range for the commit lists (default: <previous tag>..<tag>)")
    parser.add_argument("--no-commits", action="store_true", help="leave out the Features/Fixes/Refactor lists")
    parser.add_argument("--intro-only", action="store_true", help="print only the CHANGELOG intro")
    args = parser.parse_args()
    if not args.tag:
        parser.error("no tag: pass --tag or set GITHUB_REF_NAME")
    version = args.tag[1:] if args.tag.startswith("v") else args.tag

    intro, found = "", False
    if os.path.exists(args.changelog):
        with open(args.changelog, encoding="utf-8") as f:
            intro, found = changelog_intro(f.read(), version)
    if not found:
        print(f"warning: no '## [{version}]' section in {args.changelog}", file=sys.stderr)
    if args.intro_only:
        print(intro)
        return 0

    parts = [intro]
    if args.auto_notes:
        with open(args.auto_notes, encoding="utf-8") as f:
            parts.append(f.read().strip())
    if not args.no_commits:
        rng = args.range
        if not rng:
            prev = previous_tag(args.tag)
            rng = f"{prev}..{args.tag}" if prev else args.tag
        parts.append(commit_sections(rng))

    print("\n\n".join(part for part in parts if part))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
