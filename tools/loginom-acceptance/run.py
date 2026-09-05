#!/usr/bin/env python3
"""Isolated source acceptance. --preflight never starts MCP, browser or model."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid

from evidence import export_history, clean
from preflight import preflight, runtime_pin
from destinations import storage_segments, render_goal
import upload_probe
import data_pipeline

WORK = Path(__file__).resolve().parent
REPO = WORK.parents[1]
GOAL = WORK / "goals/basic-graph.txt"
NATIVE_SKILL = REPO / "plugins/loginom-dock-hermes/skills/loginom/SKILL.md"
MANIFEST_ROOT = "viking://resources/loginom-dock/catalogs/executor-preview/releases/"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def harness_unchanged(inputs):
    return all((WORK / name).is_file() and sha(WORK / name) == digest for name, digest in inputs.items())


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    data = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    # Evidence is append-by-artifact: never overwrite a previous attempt.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write(data)


def connection(home):
    # Read only the already connected Hermes subscription, never Codex CLI auth.
    state = json.loads((home / "auth.json").read_text()).get("providers", {}).get("openai-codex", {})
    tokens = state.get("tokens", {})
    if state.get("auth_mode") != "chatgpt" or not all(isinstance(tokens.get(k), str) and tokens[k]
            for k in ("access_token", "refresh_token")):
        raise ValueError("Existing Hermes ChatGPT subscription required; fallback is forbidden")
    try:
        payload = json.loads(base64.urlsafe_b64decode(tokens["access_token"].split(".")[1] + "==="))
        valid = payload["exp"] > time.time() + 4200
    except (ValueError, KeyError, IndexError, TypeError):
        valid = False
    if not valid:
        raise ValueError("Refresh the existing Hermes subscription before acceptance; isolated copies must not rotate shared refresh tokens")
    return {"version": 1, "active_provider": "openai-codex", "providers": {"openai-codex": {
        "auth_mode": "chatgpt", "tokens": tokens, "last_refresh": state.get("last_refresh")}}}


def environment(connection_values, home, run):
    # Only OS/runtime variables and the existing approved connection are inherited.
    allowed = ("PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM",
               "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "DISPLAY")
    result = {key: os.environ[key] for key in allowed if key in os.environ}
    result.update(connection_values)
    result.update(HERMES_HOME=str(home), HERMES_CWD=str(run), PYTHONDONTWRITEBYTECODE="1")
    return result


def exported_events(dock_home, secrets):
    paths = sorted(dock_home.glob("sessions/*/execution-events.jsonl"))
    events = []
    for path in paths:
        for line in path.read_text().splitlines():
            if line.strip():
                events.append(clean(json.loads(line), secrets))
    return events


def validate_inputs(args):
    if sys.platform != "darwin":
        raise ValueError("This active acceptance iteration is approved only on the current Mac")
    max_turns_limit=300 if getattr(args,'goal','basic-graph')=='data-pipeline' else 100
    if not 30 <= args.timeout <= 3600 or not 1 <= args.max_turns <= max_turns_limit:
        raise ValueError("Invalid acceptance budget")
    if args.manifest_uri is not None and not re.fullmatch(re.escape(MANIFEST_ROOT) + r"[0-9A-Za-z.+-]+/manifest\.json", args.manifest_uri):
        raise ValueError("Invalid candidate manifest URI")
    if args.manifest_sha256 is not None and not re.fullmatch(r"[a-f0-9]{64}", args.manifest_sha256):
        raise ValueError("Invalid candidate digest")
    if args.run:
        storage_segments(getattr(args,'storage_directory',None))
        login=getattr(args,'loginom_user',None)
        if not isinstance(login,str) or not login.strip() or len(login)>200 or re.search(r'[\x00-\x1f\x7f]',login):
            raise ValueError('Run requires an explicit Loginom account; no username default is assumed')
    if args.run and (not args.manifest_uri or not args.manifest_sha256):
        raise ValueError("Run requires exact candidate URI and SHA")


def execute(args):
    os.umask(0o077)
    validate_inputs(args)
    connection_values = connection(args.hermes_home)
    dock = json.loads(args.dock_config.read_text())
    secrets = [*connection_values["providers"]["openai-codex"]["tokens"].values(), dock.get("api_key")]
    goal_id = getattr(args, "goal", "basic-graph")
    goal = WORK / "goals" / (goal_id + ".txt")
    if goal_id != "basic-graph" and getattr(args, "fault", "none") != "none":
        raise ValueError("Auto-link goals require no fault injection")
    source = preflight(REPO)
    frozen = source["runtime"]
    fault = getattr(args, "fault", "none")
    dependencies = subprocess.run([str(args.node), str(WORK / "runtime-check.mjs"), str(REPO), str(args.browsers)],
                                  capture_output=True, text=True, check=True, timeout=30)
    dependencies = json.loads(dependencies.stdout)
    # Version command is local, receives an empty isolated home and no model keys.
    import tempfile
    with tempfile.TemporaryDirectory(prefix="dock-hermes-version-") as temp:
        version = subprocess.run([str(args.hermes), "--version"], capture_output=True, text=True, check=True, timeout=30,
                                 env=environment({}, Path(temp), Path(temp)))
    match = re.search(r"(?<![0-9.])v?0\.21\.0(?![0-9.])", version.stdout)
    if not match:
        raise ValueError("Hermes version differs from approved 0.21.0")
    harness_inputs = {p.relative_to(WORK).as_posix(): sha(p) for p in sorted(WORK.glob("*.py"))}
    harness_inputs.update({p.name: sha(p) for p in sorted(WORK.glob("*.mjs"))})
    harness_inputs["goals/" + goal_id + ".txt"] = sha(goal)
    if goal_id in ('file-upload-probe','file-upload-verify','data-pipeline'):
        fixture=WORK / upload_probe.FIXTURE
        if sha(fixture)!=upload_probe.FIXTURE_SHA or fixture.stat().st_size!=230:
            raise ValueError('Upload probe fixture changed')
        harness_inputs[upload_probe.FIXTURE]=sha(fixture)
    if goal_id == 'data-pipeline':
        harness_inputs.update({name:sha(WORK / name) for name in data_pipeline.FIXTURES})
    info = {"schema_version": 2, "storage_directory":getattr(args,"storage_directory",None), "scope": "source_runtime", "model_started": False,
            "provider": "openai-codex", "model": "gpt-5.6-luna", "reasoning_effort": "medium", "hermes_version": "0.21.0",
            "provider_selection": "explicit CLI; effective usage identity checked after the run",
            "fallback_allowed": False, "dependencies": dependencies,
            "runtime_source_pin": frozen, "source_inventory": source["source"],
            "harness_inputs": harness_inputs, "goal_id": goal_id, "goal_sha256": sha(goal),
            "native_skill": {"name": "loginom", "source": NATIVE_SKILL.relative_to(REPO).as_posix(),
                             "sha256": sha(NATIVE_SKILL), "activation": "Hermes --skills loginom"},
            "fault_injection": False if fault == "none" else fault,
            "require_knowledge_recovery": getattr(args, "require_knowledge_recovery", False),
            "allow_manual_reopen": getattr(args,"allow_manual_reopen",False),
            "require_verification": getattr(args, "require_verification", False),
            "require_delivered_context": getattr(args, "require_delivered_context", False),
            "budget": {"timeout_seconds": args.timeout, "max_turns": args.max_turns},
            "series": {"planned_attempts": 1, "variant": fault, "pass_criteria": "audit.py declared variant contract"},
            "manifest_uri": args.manifest_uri, "manifest_sha256": args.manifest_sha256}
    if not args.run:
        write(args.output, info)
        print(json.dumps({"preflight": "passed", "model_started": False, "hermes_version": "0.21.0",
                          "provider": "openai-codex", "model": "gpt-5.6-luna", "reasoning_effort": "medium", "client_revision": frozen["client_revision"]}))
        return 0
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
    run = args.runs_root.resolve() / run_id
    run.mkdir(parents=True, exist_ok=False, mode=0o700)
    hermes_home = run / "private/hermes-home"
    dock_home = run / "private/dock-state"
    for path in (hermes_home, dock_home / "runtime"):
        path.mkdir(parents=True, mode=0o700)
    (dock_home / "runtime/browsers").symlink_to(args.browsers.resolve(), target_is_directory=True)
    native_skill_copy = hermes_home / "skills/loginom/SKILL.md"
    native_skill_copy.parent.mkdir(parents=True, mode=0o700)
    write(native_skill_copy, NATIVE_SKILL.read_text())
    package = args.storage_directory + "/packages/Dock-acceptance-" + run_id + ".lgp"
    info.update(run_id=run_id, package_path=package)
    prompt = render_goal(goal.read_text(),package,args.storage_directory)
    if goal_id in ('file-upload-probe','file-upload-verify','data-pipeline'):
        info['input_artifact']=upload_probe.descriptor(run_id,args.storage_directory)
        prompt=upload_probe.prompt(goal.read_text(),package,args.storage_directory,run_id)
    if goal_id == 'data-pipeline':
        prompt=data_pipeline.prompt(goal.read_text(),package,args.storage_directory,run_id)
    write(run / "scenario.txt", prompt)
    write(run / "request.json", info)
    # No key is persisted in the child config. Dock reads its own explicit config.
    entry = REPO / "client/bin/loginom-dock.mjs" if fault == "none" else WORK / {"lost_receipt": "lost-receipt-client.mjs", "rename": "rename-client.mjs", "partial_link": "partial-link-client.mjs", "position": "position-client.mjs", "save_reopen": "save-reopen-client.mjs"}[fault]
    command = [str(entry), "--config", str(args.dock_config.resolve()),
               "--state-dir", str(dock_home), "--agent", "hermes", "--adapter-revision", "0.1.0-rc.4-acceptance",
               "--mode", "executor-replay", "--action-manifest-uri", args.manifest_uri,
               "--action-manifest-sha256", args.manifest_sha256, "--replay-bootstrap", "--replay-login-user", args.loginom_user]
    if goal_id in ('file-upload-probe','file-upload-verify','data-pipeline'):
        command.extend(['--input-artifact',json.dumps({**info['input_artifact'],'sourcePath':str(WORK / upload_probe.FIXTURE)},ensure_ascii=False)])
    config = {"mcp_servers": {"loginom-dock": {"command": str(args.node), "args": command,
              "connect_timeout": 180, "timeout": 360, "enabled": True,
              "env": {"DOCK_ACCEPTANCE_RUN_DIR": str(run),
                      "DOCK_ACCEPTANCE_EXECUTOR_SHA256": frozen["inputs"]["client/lib/executor.mjs"]}}},
              "agent": {"max_turns": args.max_turns, "reasoning_effort": "medium"},
              "memory": {"provider": "none"}, "plugins": {"enabled": []},
              "display": {"compact": True}, "checkpoints": {"enabled": False}}
    write(hermes_home / "config.yaml", config)
    status = "FAILED_BEFORE_MODEL"; started = False
    print(json.dumps({"run_id": run_id, "stage": "tool_precheck", "evidence_directory": str(run)}), flush=True)
    try:
        if runtime_pin(REPO) != frozen or not harness_unchanged(harness_inputs):
            raise ValueError("Source changed before tool precheck")
        precheck = subprocess.run([str(args.node), str(WORK / "check-tools.mjs"), str(hermes_home / "config.yaml")],
                                 capture_output=True, text=True, timeout=210)
        tool_check = json.loads(precheck.stdout)
        write(run / "tool-precheck.json", clean(tool_check, secrets))
        if precheck.returncode or tool_check.get("available") is not True:
            raise ValueError("MCP tool precheck failed")
        if runtime_pin(REPO) != frozen or not harness_unchanged(harness_inputs):
            raise ValueError("Source changed before model launch")
        write(hermes_home / "auth.json", connection_values)
        env = environment({}, hermes_home, run)
        argv = [str(args.hermes), "--provider", "openai-codex", "--model", "gpt-5.6-luna", "--reasoning", "medium",
                "--toolsets", "loginom-dock", "--skills", "loginom", "--usage-file", str(run / "private/usage.json"), "-z", prompt]
        child = subprocess.Popen(argv, cwd=run, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        started = True
        status = "FAILED_MODEL_OR_EXPORT"
        print(json.dumps({"run_id": run_id, "stage": "model_started", "provider": "openai-codex", "model": "gpt-5.6-luna", "reasoning_effort": "medium"}), flush=True)
        timed_out = False
        try:
            child.wait(timeout=args.timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL); child.wait(timeout=15)
        usage_path = run / "private/usage.json"
        usage = json.loads(usage_path.read_text()) if usage_path.exists() else {}
        calls, tool_results = export_history(hermes_home, secrets)
        evidence = {"schema_version": 1, "run_id": run_id, "export_complete": True,
                    "runtime_source_unchanged": runtime_pin(REPO) == frozen,
                    "harness_unchanged": harness_unchanged(harness_inputs),
                    "reasoning_effort": "medium",
                    "native_skill_unchanged": sha(native_skill_copy) == info["native_skill"]["sha256"],
                    "process": {"returncode": child.returncode, "timed_out": timed_out,
                                "usage": {key: usage.get(key) for key in ("provider", "model", "api_calls", "completed", "failed")}},
                    "tools": tool_results, "calls": calls,
                    "events": exported_events(dock_home, secrets)}
        receipt = dock_home / "fault-receipt.json"
        if receipt.is_file():
            evidence["operator_fault_receipt"] = clean(json.loads(receipt.read_text()), secrets)
        write(run / "evidence.json", clean(evidence, secrets))
        status = "EXPORTED_PENDING_AUDIT"
        return 0
    finally:
        write(run / "attempt.json", {"run_id": run_id, "status": status, "model_started": started})
        print(json.dumps({"run_id": run_id, "status": status, "model_started": started}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight", action="store_true")
    mode.add_argument("--run", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--runs-root", type=Path, default=REPO / ".dock/post-mvp-p0/runs")
    parser.add_argument("--hermes-home", type=Path, default=Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))))
    parser.add_argument("--hermes", type=Path, default=Path.home() / ".local/bin/hermes")
    parser.add_argument("--node", type=Path, default=Path.home() / ".loginom-dock/current/runtime/node")
    parser.add_argument("--browsers", type=Path, default=Path.home() / ".loginom-dock/runtime/browsers")
    parser.add_argument("--dock-config", type=Path, default=Path.home() / ".loginom-dock/config.json")
    parser.add_argument("--loginom-user", help="Explicit operator-approved passwordless Loginom account for replay")
    parser.add_argument("--storage-directory", help="Explicit Loginom storage directory observed or selected for this run")
    parser.add_argument("--manifest-uri")
    parser.add_argument("--manifest-sha256")
    parser.add_argument("--timeout", type=int, default=1200)
    parser.add_argument("--max-turns", type=int, default=60)
    parser.add_argument("--fault", choices=["none", "lost_receipt", "rename", "partial_link", "position", "save_reopen"], default="none",
                        help="Only variants with a supported independent auditor may run")
    parser.add_argument("--require-knowledge-recovery", action="store_true",
                        help="Require observed failure, scoped retrieval and reads of E2E and Help before continuation")
    parser.add_argument("--require-verification", action="store_true")
    parser.add_argument("--require-delivered-context", action="store_true",
                        help="Require automatic E2E/Help delivery bound to a failure and journal before successful continuation")
    parser.add_argument("--goal", choices=["basic-graph", "auto-link-retain", "auto-link-remove", "palette-inventory", "checkbox-roundtrip", "context-menu-checkbox", "root-checkbox", "file-storage-inspect", "file-upload-probe", "file-upload-verify", "data-pipeline"], default="basic-graph")
    parser.add_argument("--allow-manual-reopen", action="store_true")
    args = parser.parse_args()
    if args.fault=="save_reopen" and not args.allow_manual_reopen:
        parser.error("save_reopen requires --allow-manual-reopen")
    if args.preflight and args.output is None:
        parser.error("--preflight requires --output")
    return execute(args)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        # Provider/config exception bodies can contain credentials.
        print(json.dumps({"error": type(exc).__name__, "message": "Acceptance preflight/run failed; no provider fallback."}), file=sys.stderr)
        raise SystemExit(2)
