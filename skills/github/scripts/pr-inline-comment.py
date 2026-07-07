#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Post inline pull request review comments with gh.

Examples:
    pr-inline-comment.py --repo owner/repo --pr 55 --path src/file.ts --line 123 --body 'Fix this'
    pr-inline-comment.py --repo owner/repo --pr 55 --comments comments.json
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


Comment = dict[str, Any]


def run(args: list[str], *, input_path: Path | None = None) -> str:
    command = ["gh", *args]
    if input_path is not None:
        command.extend(["--input", str(input_path)])

    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError:
        sys.exit("gh is not installed or is not in PATH")
    except subprocess.CalledProcessError as exc:
        print(exc.stderr.strip() or exc.stdout.strip(), file=sys.stderr)
        print_failure_hint(file=sys.stderr)
        sys.exit(exc.returncode)

    return result.stdout.strip()


def print_failure_hint(*, file: Any) -> None:
    print(
        "\nInline comment failed. Usual causes: the line is not in the PR diff, "
        "side should be LEFT for deletions or RIGHT for additions/context, or the "
        "PR head SHA changed. Verify with: gh pr diff <pr> --repo <owner/repo> -- <path>",
        file=file,
    )


def split_repo(repo: str) -> tuple[str, str]:
    parts = repo.split("/", 1)
    if len(parts) != 2 or not all(parts):
        sys.exit("--repo must be owner/repo")
    return parts[0], parts[1]


def pr_head_sha(repo: str, pr: int) -> str:
    return run(["pr", "view", str(pr), "--repo", repo, "--json", "headRefOid", "--jq", ".headRefOid"])


def load_comments(path: Path) -> list[Comment]:
    try:
        data = json.loads(path.read_text())
    except OSError as exc:
        sys.exit(f"failed to read {path}: {exc}")
    except json.JSONDecodeError as exc:
        sys.exit(f"invalid JSON in {path}: {exc}")

    if isinstance(data, dict) and isinstance(data.get("comments"), list):
        data = data["comments"]
    if not isinstance(data, list):
        sys.exit("--comments must contain a JSON array, or an object with a comments array")
    return data


def build_single_comment(args: argparse.Namespace) -> Comment:
    if not args.path:
        sys.exit("--path is required unless --comments is used")
    if not args.body:
        sys.exit("--body is required unless --comments is used")
    if args.subject_type != "file" and args.line is None:
        sys.exit("--line is required for line comments; use --subject-type file for file comments")

    comment: Comment = {
        "path": args.path,
        "body": args.body,
    }
    if args.subject_type:
        comment["subject_type"] = args.subject_type
    if args.line is not None:
        comment["line"] = args.line
        comment["side"] = args.side
    if args.start_line is not None:
        comment["start_line"] = args.start_line
        comment["start_side"] = args.start_side or args.side
    return comment


def validate_comment(comment: Comment) -> None:
    for field in ("path", "body"):
        if not comment.get(field):
            sys.exit(f"comment is missing required field: {field}")

    subject_type = comment.get("subject_type", "line")
    if subject_type not in ("line", "file"):
        sys.exit("subject_type must be line or file")

    if subject_type == "file":
        return

    if "line" not in comment:
        sys.exit("line comments require line")
    side = comment.get("side", "RIGHT")
    if side not in ("LEFT", "RIGHT"):
        sys.exit("side must be LEFT or RIGHT")
    comment["side"] = side

    if "start_line" in comment:
        start_side = comment.get("start_side", side)
        if start_side not in ("LEFT", "RIGHT"):
            sys.exit("start_side must be LEFT or RIGHT")
        comment["start_side"] = start_side


def post_payload(repo: str, pr: int, endpoint: str, payload: dict[str, Any]) -> str:
    owner, name = split_repo(repo)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tmp:
        json.dump(payload, tmp)
        tmp.write("\n")
        tmp_path = Path(tmp.name)

    try:
        return run(
            ["api", f"repos/{owner}/{name}/pulls/{pr}/{endpoint}", "--method", "POST"],
            input_path=tmp_path,
        )
    finally:
        tmp_path.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Post inline GitHub PR review comments using gh api."
    )
    parser.add_argument("--repo", required=True, help="Repository as owner/repo")
    parser.add_argument("--pr", required=True, type=int, help="Pull request number")
    parser.add_argument("--comments", type=Path, help="JSON array of inline comments")
    parser.add_argument("--review-body", default="Inline review comments")
    parser.add_argument(
        "--event",
        choices=("COMMENT", "REQUEST_CHANGES", "APPROVE"),
        default="COMMENT",
        help="Review event for --comments mode",
    )

    parser.add_argument("--path", help="File path for a single comment")
    parser.add_argument("--line", type=int, help="Final file line number for a single line/range comment")
    parser.add_argument("--side", choices=("LEFT", "RIGHT"), default="RIGHT")
    parser.add_argument("--start-line", type=int, help="Start line for a range comment")
    parser.add_argument("--start-side", choices=("LEFT", "RIGHT"), help="Start side for a range comment")
    parser.add_argument("--subject-type", choices=("line", "file"), default="line")
    parser.add_argument("--body", help="Comment body for a single comment")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    commit_id = pr_head_sha(args.repo, args.pr)

    if args.comments:
        comments = load_comments(args.comments)
        for comment in comments:
            if not isinstance(comment, dict):
                sys.exit("each comment must be a JSON object")
            validate_comment(comment)
        payload = {
            "commit_id": commit_id,
            "event": args.event,
            "body": args.review_body,
            "comments": comments,
        }
        print(post_payload(args.repo, args.pr, "reviews", payload))
        return

    comment = build_single_comment(args)
    validate_comment(comment)
    payload = {"commit_id": commit_id, **comment}
    print(post_payload(args.repo, args.pr, "comments", payload))


if __name__ == "__main__":
    main()
