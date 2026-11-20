#!/usr/bin/env bash
# 运行于 mail；候选镜像、静态文件及 smoke.mjs 已在独立 release 中准备并验证。
set -Eeuo pipefail
release=$(realpath "${1:?release directory required}")
candidate=${2:?candidate container required}
port=${3:?candidate port required}
base=/opt/shotloom
site=/etc/nginx/sites-available/shotloom.0xfiang.com.conf
[[ "$release" == /opt/shotloom-releases/* && "$port" =~ ^[0-9]+$ && "$port" != 13030 ]]
exec 9>"$base/.deploy.lock"
flock -n 9
test -s "$release/candidate-smoke.json"
test "$(cat "$release/release.before")" = "$(cat "$base/release-id")"
test "$(cat "$release/previous-image.txt")" = "$(docker inspect shotloom-app-1 --format '{{.Image}}')"
test "$(cat "$release/image.txt")" = "$(docker inspect "$candidate" --format '{{.Image}}')"
test "$(grep -Fc 'proxy_pass http://127.0.0.1:13030;' "$site")" = 1
cp "$site" "$release/nginx.before.conf"
cp "$base/server/compose.yaml" "$release/compose.base.before.yaml"

health() {
  for attempt in {1..25}; do
    if curl --max-time 3 -fsS "http://127.0.0.1:$1/health" > /dev/null; then return; fi
    sleep 2
  done
  return 1
}

switch_and_drain() {
  local from=$1 to=$2 master workers deadline pending pid
  master=$(cat /run/nginx.pid)
  workers=$(ps -o pid=,args= --ppid "$master" | awk '/nginx: worker process/ {print $1}')
  test -n "$workers"
  test "$(grep -Fc "proxy_pass http://127.0.0.1:$from;" "$site")" = 1
  cp "$site" "$release/nginx.switch.before.conf"
  sed -i "s@proxy_pass http://127.0.0.1:$from;@proxy_pass http://127.0.0.1:$to;@" "$site"
  if ! nginx -t || ! nginx -s reload; then
    cp "$release/nginx.switch.before.conf" "$site"
    nginx -t && nginx -s reload
    return 1
  fi
  # reload 后旧 worker 继续服务已有请求，退出后才可停止它们使用的容器。
  deadline=$((SECONDS + 900))
  while true; do
    pending=0
    for pid in $workers; do if kill -0 "$pid" 2>/dev/null; then pending=1; fi; done
    if [ "$pending" = 0 ]; then break; fi
    if (( SECONDS >= deadline )); then
      echo "Drain timed out; both containers retained, traffic stays on port $to" >&2
      return 1
    fi
    sleep 1
  done
  echo "Drained nginx workers for port $from; new requests use $to"
}

trap 'echo "Activation incomplete; retain both containers and inspect $release before cleanup" >&2' ERR
health "$port"
# 保留旧 hash 资源，已打开的页面在发布后仍可加载它们。
cp -a "$release/build/dist/renderer/." "$base/dist/renderer/"
switch_and_drain 13030 "$port"
test "$(cat "$release/release.before")" = "$(cat "$base/release-id")"
test "$(cat "$release/previous-image.txt")" = "$(docker inspect shotloom-app-1 --format '{{.Image}}')"
cp "$release/build/server/compose.yaml" "$base/server/compose.yaml"
docker compose -p shotloom -f "$base/server/compose.yaml" -f "$release/compose.production.yaml" \
  up -d --no-deps --no-build --force-recreate app > "$release/startup.log" 2>&1
health 13030
node "$release/smoke.mjs" http://127.0.0.1:13030 "$release/build/dist/renderer" > "$release/live-smoke.json"
switch_and_drain "$port" 13030
node "$release/smoke.mjs" https://shotloom.0xfiang.com "$release/build/dist/renderer" > "$release/public-smoke.json"
cp "$release/revision" "$base/release-id"
trap - ERR
docker stop --time 960 "$candidate" > /dev/null
docker rm "$candidate" > /dev/null
echo "Deployment healthy: $(cat "$base/release-id")"
