#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS_HOST="${HARNESS_HOST:-127.0.0.1}"
HARNESS_PORT="${HARNESS_PORT:-4173}"
HARNESS_URL="${HARNESS_URL:-http://${HARNESS_HOST}:${HARNESS_PORT}}"

LOG_DIR="${ROOT_DIR}/.tmp/electron-harness"
SERVER_LOG="${LOG_DIR}/server.log"
ELECTRON_LOG="${LOG_DIR}/electron.log"

mkdir -p "${LOG_DIR}"

if [[ -x "${ROOT_DIR}/node_modules/electron/dist/electron" ]]; then
  ELECTRON_BIN="${ROOT_DIR}/node_modules/electron/dist/electron"
elif command -v electron >/dev/null 2>&1; then
  ELECTRON_BIN="$(command -v electron)"
else
  echo "Electron executable not found."
  echo "Install with: bun add --dev electron"
  exit 1
fi

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "[launcher] starting runtime harness server at ${HARNESS_URL}"
bun "${ROOT_DIR}/scripts/runtime-harness-server.mjs" >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

sleep 1
if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
  echo "[launcher] harness server failed to start"
  tail -n 200 "${SERVER_LOG}" || true
  exit 1
fi

echo "[launcher] launching electron binary: ${ELECTRON_BIN}"
echo "[launcher] server log: ${SERVER_LOG}"
echo "[launcher] electron log: ${ELECTRON_LOG}"

env_args=(
  "HARNESS_URL=${HARNESS_URL}"
  "CORTEX_ELECTRON_SHOW=${CORTEX_ELECTRON_SHOW:-1}"
)

if [[ -n "${CORTEX_OZONE_PLATFORM:-}" ]]; then
  env_args+=("CORTEX_OZONE_PLATFORM=${CORTEX_OZONE_PLATFORM}")
fi
if [[ -n "${CORTEX_DISABLE_VULKAN:-}" ]]; then
  env_args+=("CORTEX_DISABLE_VULKAN=${CORTEX_DISABLE_VULKAN}")
fi
if [[ -n "${CORTEX_ENABLE_UNSAFE_WEBGPU:-}" ]]; then
  env_args+=("CORTEX_ENABLE_UNSAFE_WEBGPU=${CORTEX_ENABLE_UNSAFE_WEBGPU}")
fi
if [[ -n "${CORTEX_IGNORE_GPU_BLOCKLIST:-}" ]]; then
  env_args+=("CORTEX_IGNORE_GPU_BLOCKLIST=${CORTEX_IGNORE_GPU_BLOCKLIST}")
fi

env "${env_args[@]}" \
  "${ELECTRON_BIN}" "${ROOT_DIR}/scripts/electron-harness-main.mjs" \
  2>&1 | tee "${ELECTRON_LOG}"

ELECTRON_EXIT=${PIPESTATUS[0]}
if [[ ${ELECTRON_EXIT} -ne 0 ]]; then
  echo "[launcher] electron exited with code ${ELECTRON_EXIT}"
  echo "[launcher] last electron log lines:"
  tail -n 80 "${ELECTRON_LOG}" || true
fi

exit "${ELECTRON_EXIT}"
