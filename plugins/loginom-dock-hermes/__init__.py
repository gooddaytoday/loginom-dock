"""Native Hermes adapter. Shared capture and delivery belong to the Dock runtime."""

import json
import os
import subprocess
import time
import re
import hashlib
import secrets
import stat
import functools
from pathlib import Path

ADAPTER_REVISION = "0.1.0-dev.20260910.3"


def usage_presence(raw):
    def at(path):
        value = raw
        for key in path:
            if isinstance(value, dict):
                value = value.get(key)
            else:
                supplied = getattr(value, "model_fields_set", None)
                if supplied is not None and key not in supplied:
                    return None
                value = getattr(value, key, None)
        return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None
    return {
        "cache_read_tokens": any(at(path) is not None for path in (
            ("cache_read_input_tokens",), ("prompt_cache_hit_tokens",), ("cached_tokens",),
            ("cachedInputTokens",), ("raw_usage", "cachedInputTokens"),
            ("input_tokens_details", "cached_tokens"), ("prompt_tokens_details", "cached_tokens"))),
        "cache_write_tokens": any(at(path) is not None for path in (
            ("cache_creation_input_tokens",), ("cache_write_tokens",),
            ("input_tokens_details", "cache_write_tokens"), ("input_tokens_details", "cache_creation_tokens"),
            ("prompt_tokens_details", "cache_write_tokens"), ("prompt_tokens_details", "cache_creation_input_tokens"))),
    }


def install_usage_presence():
    # The installed Hermes hook discards presence while normalizing missing
    # counters to zero. Extend only its numeric summary in memory; no raw response
    # leaves this adapter, and no upstream source or provider setting is changed.
    try:
        from agent.api_request_hooks import ApiRequestHooksMixin
        original = ApiRequestHooksMixin._usage_summary_for_api_request_hook
        if getattr(original, "_dock_presence", False):
            return

        @functools.wraps(original)
        def summary(agent, response):
            result = original(agent, response)
            if isinstance(result, dict):
                result = {**result, "dock_reported": usage_presence(getattr(response, "usage", None))}
            return result

        summary._dock_presence = True
        ApiRequestHooksMixin._usage_summary_for_api_request_hook = summary
    except (ImportError, AttributeError):
        # Unknown Hermes versions retain honest 'not reported' counters.
        return


def register(ctx):
    install_usage_presence()
    root = Path(__file__).resolve().parent
    ctx.register_skill(
        "loginom", root / "skills/loginom/SKILL.md", description="Работа в Loginom через Dock"
    )
    ctx.register_system_prompt_section(
        "loginom-dock.bootstrap",
        "Для задачи в Loginom прочитай skill loginom-dock:loginom и вызови dock_prepare "
        "из MCP loginom-dock. Инструкции придут в текущий контекст. Используй его локальный "
        "браузер и общий clipboard transfer. Для Tool Search используй tool_describe, "
        "затем tool_call(name=имя_инструмента, arguments={параметры}); параметры не "
        "передаются на верхнем уровне tool_call. Личный memory.provider не меняется.",
        max_chars=800,
    )

    # Request hooks expose normalized usage, not the raw provider response.
    # Keep absent cache counters unknown even when Hermes defaults them to zero.
    pending = {}
    active = set()
    prompts = {}
    input_tickets = {}

    def admit_user_paths(session, message):
        # Only absolute file paths literally supplied in the user message.
        # Quoted paths may contain spaces. Never inspect conversation history,
        # model arguments, directories, or system prompts for candidate files.
        quoted = r'["`\'](/[^"`\'\n]+)["`\']'
        paths = re.findall(quoted, message)
        unquoted = re.sub(quoted, ' ', message)
        paths += [p.rstrip('.,;') for p in re.findall(r'(?<![\w/:])(/[^\s<>"`\'\)\]]+)', unquoted)]
        paths = list(dict.fromkeys(paths))
        if not paths or len(paths) > 8:
            return
        dock_root = Path(os.environ.get("LOGINOM_DOCK_HOME", str(Path.home() / ".loginom-dock")))
        profile_path = dock_root / "profiles/hermes-user.json"
        try:
            config = json.loads(profile_path.read_text())
            upload = config["hermes_profile"]["input_upload_directory"]
            files, total = [], 0
            for source in paths:
                path = Path(source)
                try:
                    info = path.lstat()
                except FileNotFoundError:
                    continue
                if not stat.S_ISREG(info.st_mode) or info.st_size > 16 * 1024 * 1024:
                    continue
                fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
                with os.fdopen(fd, "rb") as stream:
                    actual = os.fstat(stream.fileno())
                    if not stat.S_ISREG(actual.st_mode) or (actual.st_dev, actual.st_ino) != (info.st_dev, info.st_ino):
                        return
                    data = stream.read(16 * 1024 * 1024 + 1)
                total += len(data)
                if len(data) != info.st_size or total > 64 * 1024 * 1024:
                    return
                # Each user task owns a fresh destination; never overwrite a CSV
                # left by a previous task merely because its basename matches.
                uploaded_name = f"{path.stem[:170]}-{secrets.token_hex(6)}{path.suffix}"
                files.append({"sourcePath": str(path), "name": uploaded_name, "bytes": len(data),
                              "sha256": hashlib.sha256(data).hexdigest(), "upload": {"directory": upload, "overwrite": "reject"}})
            if not files:
                return
            directory = dock_root / "host-inputs"
            directory.mkdir(mode=0o700, exist_ok=True)
            info = directory.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
                return
            token = secrets.token_hex(32)
            fd = os.open(directory / (token + ".json"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as stream:
                json.dump({"version": 1, "session_id": session, "created_at": time.time() * 1000, "files": files}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            input_tickets[session] = token
        except (OSError, ValueError, KeyError, TypeError):
            # Admission failure is reported as unavailable input by Dock; no
            # exception body containing a user path or credential is printed.
            return

    def host_context(**kwargs):
        name = kwargs.get("tool_name", "")
        session = kwargs.get("session_id")
        if isinstance(name, str) and "loginom" in name and name.endswith("dock_prepare") and session not in input_tickets:
            admit_user_paths(session, prompts.get(session, ""))
        ticket = input_tickets.get(session)
        if isinstance(session, str) and isinstance(name, str) and (session in active or ("loginom" in name and name.endswith("dock_prepare"))):
            event = {"event": "tool.start", "tool_name": name, "tool_call_id": kwargs.get("tool_call_id"),
                     "host_pid": os.getpid(), "observed_at": time.time()}
            if session in active:
                event["args"] = kwargs.get("args", {})
            if not diagnostic_send(session, pending.pop(session, []) + [event]):
                pending[session] = [{"event": "diagnostic.truncated", "reason": "local_writer_failed", "host_pid": os.getpid()}]
        if ticket and "loginom" in name and name.endswith("dock_prepare"):
            return {"action": "modify", "args": {"host_context_token": ticket}}

    def diagnostic_send(session, events, prune=False):
        dock_root = Path(os.environ.get("LOGINOM_DOCK_HOME", str(Path.home() / ".loginom-dock")))
        launcher = dock_root / ("bin/loginom-dock.cmd" if os.name == "nt" else "bin/loginom-dock")
        try:
            result = subprocess.run(
                [str(launcher), "diagnostic", "hermes", ADAPTER_REVISION],
                input=json.dumps({"session_id": session, "events": events, "prune": prune}, allow_nan=False),
                text=True, timeout=5, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            return result.returncode == 0
        except (OSError, subprocess.TimeoutExpired, TypeError, ValueError):
            return False

    def diagnostic(event, **kwargs):
        session = kwargs.get("session_id")
        if not isinstance(session, str) or not session:
            return
        item = {key: kwargs[key] for key in (
            "task_id", "turn_id", "api_request_id", "tool_call_id", "model", "provider",
            "started_at", "ended_at", "error_type", "status_code", "completed", "interrupted", "failed", "turn_exit_reason",
        ) if key in kwargs}
        item.update(event=event, host_pid=os.getpid(), observed_at=time.time())
        if event == "model.error":
            # Hermes nests the exception type; never copy its message, which
            # may contain a raw network response or request body.
            error = kwargs.get("error")
            if isinstance(error, dict) and isinstance(error.get("type"), str):
                item["error_type"] = error["type"]
        if event == "model.start":
            if isinstance(kwargs.get("user_message"), str):
                message = kwargs["user_message"]
                if prompts.get(session) != message:
                    input_tickets.pop(session, None)
                prompts[session] = message
        elif event == "model.end":
            usage = kwargs.get("usage")
            if isinstance(usage, dict):
                item["usage"] = {key: usage[key] for key in (
                    "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "total_tokens",
                ) if isinstance(usage.get(key), int) and not isinstance(usage[key], bool) and usage[key] >= 0}
                presence = usage.get("dock_reported", {})
                if isinstance(presence, dict):
                    item["reported"] = {key.removesuffix("_tokens"): presence[key] for key in ("cache_read_tokens", "cache_write_tokens") if isinstance(presence.get(key), bool)}
                for key in ("cache_read_tokens", "cache_write_tokens"):
                    if item["usage"].get(key) == 0 and (not isinstance(presence, dict) or presence.get(key) is not True):
                        item["usage"][key] = None
            item["usage_format"] = "hermes-canonical"
        if event in ("model.end", "model.error"):
            duration = kwargs.get("api_duration")
            if isinstance(duration, (int, float)) and not isinstance(duration, bool) and duration >= 0:
                item["duration_ms"] = duration * 1000
        # These events contain technical metadata only. Persist them immediately
        # so a startup/API failure before dock_prepare is still diagnosable.
        # The user message stays in memory until successful preparation below.
        batch = pending.pop(session, []) + [item]
        if not diagnostic_send(session, batch, prune=event == "task.start"):
            pending[session] = [{"event": "diagnostic.truncated", "reason": "local_writer_failed", "host_pid": os.getpid()}]

    def prepared_receipt(value, depth=0):
        if depth > 8:
            return None
        if isinstance(value, str):
            try:
                return prepared_receipt(json.loads(value), depth + 1)
            except (ValueError, TypeError):
                try:
                    return prepared_receipt(json.loads(value.splitlines()[0]), depth + 1)
                except (ValueError, TypeError, IndexError):
                    return None
        if isinstance(value, dict):
            if value.get("isError") is True:
                return None
            if value.get("prepared") is True and isinstance(value.get("sessionId"), str):
                return value
            for key in ("content", "text", "result", "Ok"):
                found = prepared_receipt(value.get(key), depth + 1)
                if found:
                    return found
        if isinstance(value, list):
            for entry in value:
                found = prepared_receipt(entry, depth + 1)
                if found:
                    return found
        return None

    def diagnostic_tool(**kwargs):
        session, name = kwargs.get("session_id"), kwargs.get("tool_name", "")
        if not session or not isinstance(name, str):
            return
        receipt = prepared_receipt(kwargs.get("result")) if "loginom" in name and name.endswith("dock_prepare") else None
        if receipt:
            active.add(session)
            initial = pending.pop(session, [])
            initial.append({"event": "task.prepared", "dock_session_id": receipt["sessionId"],
                            "user_message": prompts.get(session), "host_pid": os.getpid()})
            if not diagnostic_send(session, initial, prune=True):
                pending[session] = [{"event": "diagnostic.truncated", "reason": "local_writer_failed", "host_pid": os.getpid()}]
        elif session not in active and "loginom" in name and name.endswith("dock_prepare"):
            diagnostic_send(session, [{"event": "preparation.not_ready", "tool_call_id": kwargs.get("tool_call_id"),
                                       "host_pid": os.getpid(), "observed_at": time.time()}])
        if session in active:
            # Content is authorized only after successful preparation. No request
            # body, system prompt, response object or reasoning is copied here.
            event = {key: kwargs[key] for key in ("tool_name", "tool_call_id", "turn_id", "task_id", "args", "result", "duration_ms") if key in kwargs}
            event.update(event="tool.end", host_pid=os.getpid())
            if not diagnostic_send(session, pending.pop(session, []) + [event]):
                pending[session] = [{"event": "diagnostic.truncated", "reason": "local_writer_failed", "host_pid": os.getpid()}]

    def forward(event, **kwargs):
        dock_root = Path(os.environ.get("LOGINOM_DOCK_HOME", str(Path.home() / ".loginom-dock")))
        launcher = dock_root / ("bin/loginom-dock.cmd" if os.name == "nt" else "bin/loginom-dock")
        if not launcher.is_file():
            return
        # No environment, model prompt, reasoning or binary content is forwarded.
        payload = {
            key: kwargs[key]
            for key in (
                "session_id",
                "turn_id",
                "tool_call_id",
                "tool_name",
                "args",
                "result",
                "status",
                "duration_ms",
                "completed",
                "interrupted",
                "failed",
                "turn_exit_reason",
                "reason",
            )
            if key in kwargs
        }
        payload["hook_event_name"] = event
        from hermes_constants import get_hermes_home

        payload["hermes_home"] = str(get_hermes_home())
        try:
            subprocess.run(
                [str(launcher), "hook", "hermes", ADAPTER_REVISION],
                input=json.dumps(payload),
                text=True,
                timeout=10,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except (OSError, subprocess.TimeoutExpired, TypeError, ValueError):
            # Never include raw hook payloads or exception bodies in host logs.
            return

    ctx.register_hook("pre_api_request", lambda **kwargs: diagnostic("model.start", **kwargs))
    ctx.register_hook("pre_tool_call", host_context)
    ctx.register_hook("post_api_request", lambda **kwargs: diagnostic("model.end", **kwargs))
    ctx.register_hook("api_request_error", lambda **kwargs: diagnostic("model.error", **kwargs))
    ctx.register_hook("post_tool_call", diagnostic_tool)
    ctx.register_hook("on_session_start", lambda **kwargs: diagnostic("task.start", **kwargs))
    ctx.register_hook("on_session_end", lambda **kwargs: diagnostic("task.end", **kwargs))
    ctx.register_hook("on_session_finalize", lambda **kwargs: diagnostic("task.finalize", **kwargs))
    for event in ("post_tool_call", "on_session_end", "on_session_finalize"):
        ctx.register_hook(event, lambda _event=event, **kwargs: forward(_event, **kwargs))
