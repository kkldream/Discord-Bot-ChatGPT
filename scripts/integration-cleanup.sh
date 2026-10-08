#!/usr/bin/env bash
# 此檔由隔離 harness 載入；使用同一次執行建立的精確資源名稱與 context。
# 固定 production 預設，不接受環境覆寫；source 後只有離線測試調小時限。
cleanup_query_timeout=10
cleanup_remove_timeout=30
cleanup_kill_grace=5

cleanup_list_resources() {
  case "$1" in
    container) timeout --kill-after="$cleanup_kill_grace" "$cleanup_query_timeout" docker container ls -a --format '{{.Names}}' ;;
    network) timeout --kill-after="$cleanup_kill_grace" "$cleanup_query_timeout" docker network ls --format '{{.Name}}' ;;
    image) timeout --kill-after="$cleanup_kill_grace" "$cleanup_query_timeout" docker image ls --format '{{.Repository}}:{{.Tag}}' ;;
    *) return 2 ;;
  esac
}

cleanup_docker_resources() {
  local kind="$1" inventory owned failed=0
  shift
  local -a remove_flags=()
  if [[ "$kind" == container ]]; then remove_flags=(-fv); fi

  # inspect 的非零可能是不存在、daemon 錯誤或 timeout；只有成功清單能確認不存在。
  if inventory="$(cleanup_list_resources "$kind")"; then
    for owned in "$@"; do
      if [[ $'\n'"$inventory"$'\n' == *$'\n'"$owned"$'\n'* ]]; then
        timeout --kill-after="$cleanup_kill_grace" "$cleanup_remove_timeout" docker "$kind" rm "${remove_flags[@]}" -- "$owned" >/dev/null || failed=1
      fi
    done
  else
    printf '無法查詢本次 %s 資源；不可視為不存在\n' "$kind" >&2
    failed=1
  fi

  # removal exit 0 仍不是消失證據；再次查詢並只比對本次完整名稱，不刪 prefix matches。
  if inventory="$(cleanup_list_resources "$kind")"; then
    for owned in "$@"; do
      if [[ $'\n'"$inventory"$'\n' == *$'\n'"$owned"$'\n'* ]]; then
        printf '清理後仍有本次 %s 資源：%s\n' "$kind" "$owned" >&2
        failed=1
      fi
    done
  else
    printf '無法讀回本次 %s 清理結果\n' "$kind" >&2
    failed=1
  fi
  return "$failed"
}

cleanup() {
  local status=$? cleanup_failed=0
  trap - EXIT INT TERM HUP
  set +e
  cleanup_docker_resources container "$runner" "$configless" "$mongo" "$probe" || cleanup_failed=1
  cleanup_docker_resources network "$network" || cleanup_failed=1
  cleanup_docker_resources image "$image" "$probe_image" || cleanup_failed=1
  timeout --kill-after="$cleanup_kill_grace" "$cleanup_remove_timeout" rm -rf -- "$context" || cleanup_failed=1
  # 父目錄不可查詢或殘留 symlink 也不能被當成已消失。
  if [[ ! -r "${context%/*}" || ! -x "${context%/*}" || -e "$context" || -L "$context" ]]; then
    printf '無法確認暫存 context 已移除：%s\n' "$context" >&2
    cleanup_failed=1
  fi
  if (( cleanup_failed )); then
    printf '清理失敗，請只檢查本次前綴：%s\n' "$run_id" >&2
    if (( status == 0 )); then status=1; fi
  else
    printf '已清理本次容器、network、image tag 與暫存 context：%s\n' "$run_id"
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
