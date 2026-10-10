"""直接 source 實際 cleanup helper；靜態 CLI 契約檢查不 eval 原始碼。"""

import ctypes
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
HELPER = Path(os.environ.get("CLEANUP_TEST_HELPER", str(ROOT / "scripts/integration-cleanup.sh")))
FIXTURE = Path(__file__).with_name("cleanup-fixture.py")


def run_shell(env, state_path, real_timeout):
    # Linux subreaper 只用於真實 process fixture：KILL 同時終止 CLI／child
    # 後由本測試回收 orphan，不能假設 CI／container PID 1 會替測試回收。
    libc = ctypes.CDLL(None, use_errno=True)
    old_subreaper = ctypes.c_int()
    if real_timeout:
        if (libc.prctl(37, ctypes.byref(old_subreaper), 0, 0, 0) != 0
                or libc.prctl(36, 1, 0, 0, 0) != 0):
            raise OSError(ctypes.get_errno(), "prctl child subreaper")
    process = None
    started = time.monotonic()
    timed_out = False
    reaped = {}
    lingering = []
    drained = False
    try:
        process = subprocess.Popen(
            ["bash", "-c", 'set -Eeuo pipefail; source "$CLEANUP_HELPER"; '
             # 覆寫在 source 之後；不重定義 timeout 或 helper 函式。
             'if [[ "$REAL_TIMEOUT" == 1 ]]; then '
             'cleanup_query_timeout=0.3; cleanup_remove_timeout=0.3; '
             'cleanup_kill_grace=0.2; fi; '
             'if [[ -n "$CLEANUP_SIGNAL" ]]; then kill -s "$CLEANUP_SIGNAL" "$$"; fi; '
             'exit "$ORIGINAL_STATUS"'],
            env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            stdout, stderr = process.communicate(timeout=3 if real_timeout else 10)
        except subprocess.TimeoutExpired:
            timed_out = True
            # RED／regression failure 時也只終止這一個 fixture 的 process groups。
            state = json.loads(state_path.read_text())
            for group in {process.pid} | {
                    item["group"] for item in state.get("hanging_processes", [])}:
                try:
                    os.killpg(group, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            stdout, stderr = process.communicate(timeout=2)
        elapsed = time.monotonic() - started
        state = json.loads(state_path.read_text())
        pids = {item[key] for item in state.get("hanging_processes", [])
                for key in ("cli", "descendant", "group")}
        deadline = time.monotonic() + 0.5
        pending = pids.copy()
        while pending and time.monotonic() < deadline:
            for pid in pending.copy():
                try:
                    waited, status = os.waitpid(pid, os.WNOHANG)
                except ChildProcessError:
                    waited, status = 0, 0
                if waited:
                    reaped[str(pid)] = os.waitstatus_to_exitcode(status)
                    pending.remove(pid)
                else:
                    try:
                        os.kill(pid, 0)
                    except ProcessLookupError:
                        pending.remove(pid)
            if pending:
                time.sleep(0.01)
        lingering = sorted(pending)
        drained = not lingering
        return subprocess.CompletedProcess(process.args, process.returncode, stdout, stderr), {
            "real_timeout": real_timeout, "outer_timeout": timed_out,
            "elapsed_seconds": elapsed, "reaped_exit_codes": reaped,
            "lingering_pids": lingering,
        }
    finally:
        # 即使 assertion／subprocess 例外也不可留下本次 CLI／descendant。
        if real_timeout and not drained:
            state = json.loads(state_path.read_text())
            groups = {item["group"] for item in state.get("hanging_processes", [])}
            if process is not None:
                groups.add(process.pid)
            for group in groups:
                try:
                    os.killpg(group, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if process is not None:
                process.wait(timeout=2)
            for item in state.get("hanging_processes", []):
                for key in ("cli", "descendant", "group"):
                    try:
                        os.waitpid(item[key], 0)
                    except ChildProcessError:
                        pass
        if real_timeout:
            libc.prctl(36, old_subreaper.value, 0, 0, 0)


class CleanupAssertions(unittest.TestCase):
    def run_cleanup(self, fault="none", kind="container", present=True,
                    original_status=0, signal="", real_timeout=False):
        base = Path(os.environ.get("TMPDIR", str(Path.home() / ".cache")))
        base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="hermes-issue1-cleanup-", dir=base) as work:
            work = Path(work)
            suffix = secrets.token_hex(3)
            context = work / f"hermes-issue1.{suffix}"
            context.mkdir()
            (context / "context-canary").write_text("FAKE test context\n")
            run_id = f"hermes-issue1-{suffix}-{os.getpid()}"
            owned = {
                "container": [f"{run_id}-{tail}" for tail in
                              ("tests", "configless", "mongo", "context")],
                "network": [f"{run_id}-net"],
                "image": [f"{run_id}:acceptance", f"{run_id}:context"],
            }
            # 連同近似名稱也必須保留，避免 prefix matching 或全域 prune。
            unrelated = {resource: ["production-do-not-touch", names[0] + "-other"]
                         for resource, names in owned.items()}
            state = {
                "fault": fault, "fault_kind": kind, "context": str(context),
                "owned": owned, "resources": {
                    resource: (names.copy() if present else []) + unrelated[resource]
                    for resource, names in owned.items()
                },
                "queries": dict.fromkeys(owned, 0), "calls": [], "removals": [],
                "context_removals": 0, "unexpected": [],
            }
            state_path = work / "state.json"
            state_path.write_text(json.dumps(state))
            bin_dir = work / "bin"
            bin_dir.mkdir()
            cli = bin_dir / "fake-cli.py"
            shutil.copyfile(FIXTURE, cli)
            cli.chmod(0o755)
            for name in (("docker", "rm") if real_timeout else ("docker", "timeout", "rm")):
                (bin_dir / name).symlink_to(cli)
            env = {
                **os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}",
                "CLEANUP_FIXTURE_STATE": str(state_path), "CLEANUP_HELPER": str(HELPER),
                "context": str(context), "run_id": run_id,
                "runner": owned["container"][0], "configless": owned["container"][1],
                "mongo": owned["container"][2], "probe": owned["container"][3],
                "network": owned["network"][0], "image": owned["image"][0],
                "probe_image": owned["image"][1], "ORIGINAL_STATUS": str(original_status),
                "CLEANUP_SIGNAL": signal, "REAL_TIMEOUT": "1" if real_timeout else "0",
            }
            result, process_evidence = run_shell(env, state_path, real_timeout)
            state = json.loads(state_path.read_text())
            state.update(process_evidence)
            state["context_exists_after"] = context.exists()
            state["exit_code"] = result.returncode
            state["stdout"] = result.stdout
            state["stderr"] = result.stderr
            evidence = os.environ.get("CLEANUP_EVIDENCE_DIR")
            if evidence:
                destination = Path(evidence)
                destination.mkdir(parents=True, exist_ok=True)
                (destination / f"{self._testMethodName}.json").write_text(
                    json.dumps(state, ensure_ascii=False, indent=2) + "\n")
            # 被待測程式吞掉的 fixture assertion 也不能變成 GREEN。
            self.assertEqual(state["unexpected"], [], state)
            if not state["outer_timeout"]:
                self.assertEqual(state["context_removals"], 1, state)
            for resource, names in unrelated.items():
                self.assertTrue(set(names).issubset(state["resources"][resource]), state)
            for resource, name in state["removals"]:
                self.assertIn(name, owned[resource], state)
            return state

    def assert_failed(self, state, code=1):
        self.assertEqual(state["exit_code"], code, state)
        self.assertNotIn("已清理", state["stdout"], state)
        self.assertIn("清理失敗", state["stderr"], state)

    def assert_clean(self, state, code=0):
        self.assertEqual(state["exit_code"], code, state)
        self.assertIn("已清理", state["stdout"], state)
        self.assertFalse(state["context_exists_after"], state)
        for resource, names in state["owned"].items():
            self.assertTrue(set(names).isdisjoint(state["resources"][resource]), state)
            self.assertGreaterEqual(state["queries"][resource], 2, state)


class CleanupTests(CleanupAssertions):
    def test_all_present_removed_and_read_back(self):
        state = self.run_cleanup()
        self.assert_clean(state)
        self.assertEqual(len(state["removals"]), 7)

    def test_genuinely_absent_is_success_without_docker_removals(self):
        state = self.run_cleanup(present=False)
        self.assert_clean(state)
        self.assertEqual(state["removals"], [])

    def test_context_removal_error(self):
        state = self.run_cleanup("context_rm_error")
        self.assert_failed(state)
        self.assertTrue(state["context_exists_after"])
        self.assertEqual(len(state["removals"]), 7)

    def test_context_removal_error_after_effect(self):
        state = self.run_cleanup("context_rm_error_after_effect")
        self.assert_failed(state)
        self.assertFalse(state["context_exists_after"])

    def test_context_removal_success_without_effect(self):
        state = self.run_cleanup("context_rm_no_effect")
        self.assert_failed(state)
        self.assertTrue(state["context_exists_after"])

    def test_original_failure_preserved_after_successful_cleanup(self):
        self.assert_clean(self.run_cleanup(original_status=73), code=73)

    def test_original_failure_preserved_after_cleanup_failure(self):
        self.assert_failed(self.run_cleanup("query_error", original_status=73), code=73)

    def test_original_failure_preserved_after_context_removal_failure(self):
        self.assert_failed(self.run_cleanup("context_rm_error", original_status=73), code=73)


def fault_test(fault, kind):
    def test(self):
        state = self.run_cleanup(fault=fault, kind=kind)
        self.assert_failed(state)
        self.assertFalse(state["context_exists_after"], state)
        if fault in ("resource_rm_error", "resource_rm_error_after_effect", "resource_rm_no_effect"):
            self.assertEqual(len(state["removals"]), 7, state)
        if fault == "resource_rm_error_after_effect":
            self.assertTrue(set(state["owned"][kind]).isdisjoint(state["resources"][kind]), state)
        # 一種 Docker 資源的失敗不可阻止其他種類清理。
        for other in set(state["owned"]) - {kind}:
            self.assertTrue(set(state["owned"][other]).isdisjoint(state["resources"][other]), state)
    return test


for _kind in ("container", "network", "image"):
    for _fault in ("query_error", "query_timeout", "readback_query_error",
                   "resource_rm_error", "resource_rm_error_after_effect", "resource_rm_no_effect"):
        setattr(CleanupTests, f"test_{_kind}_{_fault}", fault_test(_fault, _kind))


def signal_test(signal, code, fault):
    def test(self):
        state = self.run_cleanup(signal=signal, fault=fault)
        if fault == "none":
            self.assert_clean(state, code=code)
        else:
            self.assert_failed(state, code=code)
    return test


for _signal, _code in (("HUP", 129), ("INT", 130), ("TERM", 143)):
    for _fault in ("none", "query_error"):
        setattr(CleanupTests, f"test_signal_{_signal}_{_fault}",
                signal_test(_signal, _code, _fault))


class RealTimeoutTests(CleanupAssertions):
    def assert_bounded(self, fault, original_status=0, signal_name=""):
        state = self.run_cleanup(
            fault=fault, original_status=original_status,
            signal=signal_name, real_timeout=True,
        )
        self.assertFalse(state["outer_timeout"], state)
        self.assertLess(state["elapsed_seconds"], 3, state)
        self.assertEqual(state["lingering_pids"], [], state)
        self.assertTrue(state.get("hanging_processes"), state)
        for item in state["hanging_processes"]:
            for key in ("cli", "descendant"):
                # 是 timeout 自己的 KILL，不能是外層 watchdog 或 fixture 正常退出。
                self.assertEqual(state["reaped_exit_codes"].get(str(item[key])), -9, state)
                with self.assertRaises(ProcessLookupError):
                    os.kill(item[key], 0)
        self.assert_failed(state, code=original_status or 1)
        # 任一種類掛住不可阻止其他種類清理；scratch fault 時三類均已清理。
        for kind, names in state["owned"].items():
            if fault == "context_term_ignoring" or kind != state["fault_kind"]:
                self.assertTrue(set(names).isdisjoint(state["resources"][kind]), state)
        return state

    def test_real_inventory_timeout_kills_cli_and_descendant(self):
        state = self.assert_bounded("query_term_ignoring")
        self.assertFalse(state["context_exists_after"], state)
        self.assertTrue(set(state["owned"]["container"]).issubset(
            state["resources"]["container"]), state)
        self.assertEqual(len(state["hanging_processes"]), 2, state)

    def test_real_removal_timeout_preserves_original_failure(self):
        state = self.assert_bounded("removal_term_ignoring", original_status=73)
        self.assertFalse(state["context_exists_after"], state)
        self.assertEqual(len(state["removals"]), 7, state)
        self.assertIn(state["owned"]["container"][0], state["resources"]["container"], state)

    def test_real_scratch_timeout_preserves_term_exit(self):
        state = self.assert_bounded("context_term_ignoring", original_status=143,
                                    signal_name="TERM")
        self.assertTrue(state["context_exists_after"], state)
        self.assertEqual(len(state["removals"]), 7, state)

    def test_production_positive_defaults_ignore_environment(self):
        result = subprocess.run(
            ["bash", "-c", 'source "$CLEANUP_HELPER"; trap - EXIT INT TERM HUP; '
             'printf "%s\\n" "$cleanup_query_timeout" "$cleanup_remove_timeout" '
             '"$cleanup_kill_grace"'],
            env={**os.environ, "CLEANUP_HELPER": str(HELPER),
                 "cleanup_query_timeout": "0", "cleanup_remove_timeout": "-1",
                 "cleanup_kill_grace": "0"},
            text=True, capture_output=True, timeout=3,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ["10", "30", "5"])

    def test_harness_cli_timeouts_have_positive_kill_grace(self):
        # 補充靜態契約：每個實際 Docker timeout 都有同一 grace；
        # process 行為仍由以上三個直接 source helper 的真實測試驗證。
        source = (ROOT / "scripts/test-integration.sh").read_text()
        invocations = re.findall(r"\btimeout\s+([^\n]*?)(?=docker\s)", source)
        self.assertTrue(invocations)
        for options in invocations:
            self.assertRegex(options, r"^--kill-after=5 [1-9][0-9]* $")


if __name__ == "__main__":
    unittest.main(verbosity=2)
