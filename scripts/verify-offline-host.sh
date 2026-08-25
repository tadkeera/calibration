#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$(mktemp -d)"
port="${QC_OFFLINE_TEST_PORT:-3012}"
lan_ip="$(hostname -I | awk '{print $1}')"
server_log="$work_dir/offline-host.log"

cleanup() {
  if [[ -n "${server_pid:-}" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

env \
  ELECTRON_RUN_AS_NODE=1 \
  NODE_OPTIONS="--experimental-sqlite" \
  NODE_ENV=production \
  QC_STORAGE_MODE=local \
  QC_LAN_HOST=true \
  PORT="$port" \
  QC_LOCAL_DB_PATH="$work_dir/miayar-offline.sqlite" \
  QC_DESKTOP_ASSETS_DIR="/home/ubuntu/desktop-assets" \
  "$project_dir/node_modules/.bin/electron" "$project_dir/dist/index.js" >"$server_log" 2>&1 &
server_pid=$!

for _attempt in $(seq 1 30); do
  if grep -q "Server running on" "$server_log"; then
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    cat "$server_log" >&2
    exit 1
  fi
  sleep 1
done

grep -q "Server running on" "$server_log"
actual_port="$(grep -oE 'Server running on http://[^:]+:[0-9]+/' "$server_log" | tail -n 1 | sed -E 's#.*:([0-9]+)/#\1#')"
curl --fail --silent --show-error "http://127.0.0.1:$actual_port/" >/dev/null
curl --noproxy "*" --fail --silent --show-error "http://$lan_ip:$actual_port/" >/dev/null
curl --fail --silent --show-error "http://127.0.0.1:$actual_port/api/trpc/assets.officialReportHeaderUrl" -o "$work_dir/header-url.json"
grep -q "manus-storage/yemen-qc-official-report-header_14217543.png" "$work_dir/header-url.json"
curl --fail --silent --show-error "http://127.0.0.1:$actual_port/manus-storage/yemen-qc-official-report-header_14217543.png" -o "$work_dir/official-header.png"
cmp "$work_dir/official-header.png" "/home/ubuntu/desktop-assets/yemen-qc-official-report-header_14217543.png"

printf 'Offline host smoke test passed on localhost and LAN address %s:%s\n' "$lan_ip" "$actual_port"
