#!/usr/bin/env bash
set -Eeuo pipefail

# 此入口只建立拋棄式測試資源；不讀 .env、不發布 image、不執行正式登入或指令註冊。
mode="${1:-all}"
case "$mode" in all|store|image) ;; *) printf '用法：bash scripts/test-integration.sh [all|store|image]\n' >&2; exit 2 ;; esac
if (( $# > 1 )); then exit 2; fi
for command in docker timeout mktemp cp; do command -v "$command" >/dev/null; done
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
scratch_base="${TMPDIR:-${HOME}/.cache}"
mkdir -p -- "$scratch_base"
context="$(mktemp -d "${scratch_base%/}/hermes-issue1.XXXXXX")"
run_suffix="${context##*.}"
run_id="hermes-issue1-${run_suffix,,}-$$"
network="${run_id}-net"
mongo="${run_id}-mongo"
runner="${run_id}-tests"
configless="${run_id}-configless"
probe="${run_id}-context"
image="${run_id}:acceptance"
probe_image="${run_id}:context"
mongo_image='mongo:8.0.17@sha256:9814652e33f0cf8b9fddea8b46dfc9d8e19b130dcfdd7b510ca58bb0d40c8b71'

# 所有 CLI 保留原有 soft timeout；TERM 後最多 5 秒升級 KILL（含同 process group 子程序）。
source "$root/scripts/integration-cleanup.sh"

printf '隔離驗收資源前綴：%s；模式：%s\n' "$run_id" "$mode"
timeout --kill-after=5 30 docker info >/dev/null
# 只複製 Dockerfile 所需白名單；即使工作目錄另有憑證，也不傳入 build context。
cp -- "$root"/{Dockerfile,.dockerignore,package.json,package-lock.json,.npmrc,index.js,db.js,commands.js,constant.js,stringValue.js,openaiApi.js} "$context/"
cp -R -- "$root/lib" "$context/lib"
mkdir "$context/scripts"
cp -- "$root/scripts/healthcheck.js" "$context/scripts/"
# 合成 canary 沒有任何憑證，刻意放在不應開放的檔案位置。
for excluded in .env lib/context-canary.backup lib/providers/context-canary.backup scripts/context-canary.backup; do
  cp -- "$root/test/integration/context-canary.txt" "$context/$excluded"
done
# 只有下載固定公開 image 與 npm 安裝使用網路；測試容器只加入新建 internal network。
timeout --kill-after=5 300 docker pull "$mongo_image"
timeout --kill-after=5 600 docker build --rm -t "$image" "$context"
# 以 COPY 匯出 daemon 實際收到且可見的 context；scratch 容器只建立，不啟動。
timeout --kill-after=5 60 docker build --rm --network none -f "$root/test/integration/context.Dockerfile" -t "$probe_image" "$context"
timeout --kill-after=5 20 docker create --name "$probe" --network none "$probe_image" /not-run >/dev/null
mkdir "$context/daemon-context"
timeout --kill-after=5 20 docker cp "$probe:/context/." "$context/daemon-context/"
[[ "$(timeout --kill-after=5 10 docker image inspect "$image" --format '{{.Config.User}}')" == node ]]
[[ "$(timeout --kill-after=5 10 docker image inspect "$image" --format '{{json .Config.Cmd}}')" == '["node","index.js"]' ]]
timeout --kill-after=5 30 docker network create --driver bridge --internal "$network" >/dev/null
[[ "$(timeout --kill-after=5 10 docker network inspect "$network" --format '{{.Internal}}')" == true ]]

timeout --kill-after=5 30 docker run -d --name "$mongo" --network "$network" --network-alias mongo \
  --memory 1g --cpus 1 --pids-limit 256 --security-opt no-new-privileges \
  --read-only --tmpfs /data/db:rw,size=512m --tmpfs /data/configdb:rw,size=16m --tmpfs /tmp:rw,size=32m \
  "$mongo_image" mongod --bind_ip_all --wiredTigerCacheSizeGB 0.25 --quiet >/dev/null
ready=0
for (( attempt=0; attempt<30; attempt++ )); do
  if timeout --kill-after=5 3 docker exec "$mongo" mongosh --quiet --eval 'quit(db.adminCommand({ping:1}).ok === 1 ? 0 : 1)' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if (( ! ready )); then timeout --kill-after=5 10 docker logs --tail 40 "$mongo"; printf 'MongoDB 未就緒\n' >&2; exit 1; fi
printf 'MongoDB server：'
timeout --kill-after=5 5 docker exec "$mongo" mongosh --quiet --eval 'db.version()'
[[ "$(timeout --kill-after=5 10 docker inspect "$mongo" --format '{{json .HostConfig.PortBindings}}')" == '{}' ]]

# 真正預設 CMD、network=none、無設定；必須在登入／DB 初始化前 exit 1。
timeout --kill-after=5 30 docker create --name "$configless" --network none --memory 256m --cpus 1 --pids-limit 128 \
  --read-only --cap-drop ALL --security-opt no-new-privileges "$image" >/dev/null
config_status=0
timeout --kill-after=5 20 docker start -a "$configless" || config_status=$?
[[ "$config_status" == 0 || "$config_status" == 1 ]]
[[ "$(timeout --kill-after=5 10 docker inspect "$configless" --format '{{.State.ExitCode}}')" == 1 ]]
[[ "$(timeout --kill-after=5 10 docker logs "$configless" 2>&1)" == *'"code":"CONFIG"'* ]]

case "$mode" in
  store) tests=(/acceptance/mongo-store.test.js) ;;
  image) tests=(/acceptance/built-image.test.js) ;;
  all) tests=(/acceptance/mongo-store.test.js /acceptance/built-image.test.js) ;;
esac
timeout --kill-after=5 30 docker create --name "$runner" --network "$network" --memory 512m --cpus 1 --pids-limit 128 \
  --read-only --tmpfs /tmp:rw,size=16m --cap-drop ALL --security-opt no-new-privileges \
  --env HERMES_ISOLATED_ACCEPTANCE=1 \
  --mount "type=bind,src=$root/test/integration,dst=/acceptance,readonly" \
  --mount "type=bind,src=$context/daemon-context,dst=/context-proof,readonly" \
  "$image" node --test --test-reporter tap --test-concurrency=1 "${tests[@]}" >/dev/null
[[ "$(timeout --kill-after=5 10 docker inspect "$runner" --format '{{json .HostConfig.PortBindings}}')" == '{}' ]]
timeout --kill-after=5 180 docker start -a "$runner"
result="$(timeout --kill-after=5 10 docker inspect "$runner" --format '{{.State.ExitCode}}')"
if [[ "$result" != 0 ]]; then exit "$result"; fi
