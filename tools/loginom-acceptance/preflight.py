#!/usr/bin/env python3
"""Read-only P0 source preflight. Never starts Hermes, MCP, browser or a model."""

import argparse
import hashlib
import importlib.util
import json
import re
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def runtime_pin(root):
    # Parse only the literal input list; do not execute client/session code.
    source = (root / "client/lib/session.mjs").read_text()
    matches = re.findall(r"for \(const file of \[([\s\S]*?)\]\) \{", source)
    if len(matches) != 1:
        raise ValueError("Runtime input list is absent or ambiguous")
    literal = matches[0]
    labels = re.findall(r"'([^']+)'", literal)
    if not labels or len(set(labels)) != len(labels) or re.sub(r"'[^']+'|[\s,]", "", literal):
        raise ValueError("Runtime input list is not a unique literal list")
    digest = hashlib.sha256()
    inputs = {}
    for label in labels:
        path = root / "client/lib" / label
        resolved = path.resolve()
        if not resolved.is_relative_to(root) or path.is_symlink():
            raise ValueError("Runtime input escapes source root or is a symlink")
        data = path.read_bytes()
        digest.update(label.encode() + b"\0" + data)
        inputs[resolved.relative_to(root).as_posix()] = sha(data)
    return {"client_revision": digest.hexdigest(), "inputs": inputs}


def inventory(root, revision="HEAD"):
    spec = importlib.util.spec_from_file_location(
        "dock_source_inventory", root / "deploy/loginom-dock/client-source-inventory.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.inventory(root, revision)


def preflight(root, revision="HEAD"):
    root = root.resolve()
    sources = inventory(root, revision)
    runtime = runtime_pin(root)
    selected = {item["path"] for item in sources["files"]}
    if not set(runtime["inputs"]).issubset(selected):
        raise ValueError("Runtime inputs are missing from client source packaging")
    return {"schema_version": 1, "scope": "source_only", "model_started": False,
            "live_acceptance": "not_run", "source": sources, "runtime": runtime}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--commit", default="HEAD")
    parser.add_argument("--require-clean", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = preflight(args.root, args.commit)
    args.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Do not overwrite old evidence or follow a destination symlink.
    with args.output.open("x") as output:
        output.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"scope": report["scope"], "model_started": False,
                      "build_inputs_match_commit": report["source"]["build_inputs_match_commit"],
                      "files": len(report["source"]["files"]),
                      "client_revision": report["runtime"]["client_revision"],
                      "report_sha256": sha(args.output.read_bytes())}))
    if args.require_clean and not report["source"]["build_inputs_match_commit"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
