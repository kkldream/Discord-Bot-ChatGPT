#!/usr/bin/env python3
"""明示 fake CLI：只修改單一測試的 JSON／scratch context，不接觸 Docker。"""

import json
import os
from pathlib import Path
import shutil
import signal
import sys
from typing import NoReturn

state_path = Path(os.environ["CLEANUP_FIXTURE_STATE"])
state = json.loads(state_path.read_text())
command = Path(sys.argv[0]).name
args = sys.argv[1:]
state["calls"].append([command, *args])
fault = state["fault"]


def finish(code=0, output="", unexpected=None) -> NoReturn:
    if unexpected is not None:
        state["unexpected"].append(unexpected)
    state_path.write_text(json.dumps(state))
    if output:
        print(output)
    raise SystemExit(code)


def ignore_term_with_descendant():
    # 真實 GNU timeout 的 fixture；兩個 process 都明確忽略 TERM。
    # child 不持有／修改 JSON，避免與後續 CLI 查詢並行寫入。
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    descendant = os.fork()
    if descendant == 0:
        while True:
            signal.pause()
    state.setdefault("hanging_processes", []).append({
        "cli": os.getpid(), "descendant": descendant,
        "group": os.getpgrp(), "command": [command, *args],
    })
    state_path.write_text(json.dumps(state))
    while True:
        signal.pause()


if command == "timeout":
    # 兼容舊 TERM-only helper 與新增的固定 KILL grace，保留實際 argv 證據。
    if args[:1] == ["--kill-after=5"]:
        args = args[1:]
    if len(args) < 2 or args[0] not in ("10", "30"):
        finish(90, unexpected=[command, *args])
    # 模擬 timeout 的 exit 124，不靠 sleep／排程時間；外層仍有真實 subprocess timeout。
    if (fault == "query_timeout" and args[1] == "docker"
            and args[2:3] == [state["fault_kind"]]
            and args[3:4] in (["inspect"], ["ls"])):
        finish(124)
    state_path.write_text(json.dumps(state))
    os.execvp(args[1], args[1:])

if command == "rm":
    if args != ["-rf", "--", state["context"]]:
        finish(90, unexpected=[command, *args])
    state["context_removals"] += 1
    if fault == "context_term_ignoring":
        ignore_term_with_descendant()
    if fault == "context_rm_error":
        finish(1, "FAKE rm: permission denied")
    if fault != "context_rm_no_effect":
        shutil.rmtree(state["context"], ignore_errors=False)
    if fault == "context_rm_error_after_effect":
        finish(1, "FAKE rm: reported failure after removal")
    finish()

if command != "docker":
    finish(90, unexpected=[command, *args])
if args == ["info"]:
    finish()  # daemon info 成功不等於個別查詢成功，重現舊 cleanup 的漏洞。

if args[:2] == ["rm", "-fv"]:  # 舊 cleanup 的 docker rm 語法。
    kind, operation, rest = "container", "rm", args[2:]
elif len(args) >= 2 and args[0] in state["resources"]:
    kind, operation, rest = args[0], args[1], args[2:]
else:
    finish(90, unexpected=[command, *args])

resources = state["resources"][kind]
if operation in ("inspect", "ls"):
    state["queries"][kind] += 1
    if fault == "query_term_ignoring" and kind == state["fault_kind"]:
        ignore_term_with_descendant()
    if fault == "query_error" and kind == state["fault_kind"]:
        finish(1, "FAKE Docker: daemon query unavailable")
    if (fault == "readback_query_error" and kind == state["fault_kind"]
            and operation == "ls" and state["queries"][kind] == 2):
        finish(1, "FAKE Docker: read-back unavailable")
    if operation == "inspect":
        if len(rest) != 1:
            finish(90, unexpected=[command, *args])
        finish(0 if rest[0] in resources else 1)
    expected = {
        "container": ["-a", "--format", "{{.Names}}"],
        "network": ["--format", "{{.Name}}"],
        "image": ["--format", "{{.Repository}}:{{.Tag}}"],
    }
    if rest != expected[kind]:
        finish(90, unexpected=[command, *args])
    finish(output="\n".join(resources))

if operation == "rm":
    expected_flags = ["-fv", "--"] if kind == "container" else ["--"]
    # 舊版沒有 --；新版固定 kind＋flags，同樣驗證唯一 target。
    flags, target = rest[:-1], rest[-1:]
    if flags not in (expected_flags, []) or not target:
        finish(90, unexpected=[command, *args])
    name = target[0]
    if name not in state["owned"][kind]:
        finish(90, unexpected=[command, *args])
    state["removals"].append([kind, name])
    if (fault == "removal_term_ignoring" and kind == state["fault_kind"]
            and name == state["owned"][kind][0]):
        ignore_term_with_descendant()
    if fault == "resource_rm_error" and kind == state["fault_kind"]:
        finish(1, "FAKE Docker: resource removal failed")
    if fault != "resource_rm_no_effect" or kind != state["fault_kind"]:
        resources.remove(name)
    if fault == "resource_rm_error_after_effect" and kind == state["fault_kind"]:
        finish(1, "FAKE Docker: reported failure after removal")
    finish()

finish(90, unexpected=[command, *args])
