#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/workspace"
HARNESS_HOST="${HARNESS_HOST:-0.0.0.0}"
HARNESS_PORT="${HARNESS_PORT:-4173}"
HARNESS_URL="${HARNESS_URL:-http://127.0.0.1:${HARNESS_PORT}}"
MAIN_INSPECT_PORT="${CORTEX_DOCKER_MAIN_INSPECT_PORT:-9230}"
RENDERER_DEBUG_PORT="${CORTEX_DOCKER_RENDERER_DEBUG_PORT:-9222}"

cleanup() {
  if [[ -n "${ELECTRON_PID:-}" ]] && kill -0 "${ELECTRON_PID}" 2>/dev/null; then
    kill "${ELECTRON_PID}" >/dev/null 2>&1 || true
    wait "${ELECTRON_PID}" 2>/dev/null || true
  fi

  if [[ -n "${HARNESS_PID:-}" ]] && kill -0 "${HARNESS_PID}" 2>/dev/null; then
    kill "${HARNESS_PID}" >/dev/null 2>&1 || true
    wait "${HARNESS_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "[docker-electron] starting harness server on ${HARNESS_HOST}:${HARNESS_PORT}"
HARNESS_HOST="${HARNESS_HOST}" HARNESS_PORT="${HARNESS_PORT}" \
  bun "${ROOT_DIR}/scripts/runtime-harness-server.mjs" &
HARNESS_PID=$!

ready=0
for _attempt in $(seq 1 80); do
  if (echo >"/dev/tcp/127.0.0.1/${HARNESS_PORT}") >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.1
done

if [[ "${ready}" -ne 1 ]]; then
  echo "[docker-electron] harness server did not become ready"
  exit 1
fi

echo "[docker-electron] harness ready at ${HARNESS_URL}"

wait_for_main_debugger() {
  for _attempt in $(seq 1 200); do
    if curl -fsS "http://127.0.0.1:${MAIN_INSPECT_PORT}/json/version" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

wait_for_renderer_debugger() {
  for _attempt in $(seq 1 200); do
    if curl -fsS "http://127.0.0.1:${RENDERER_DEBUG_PORT}/json/version" >/dev/null 2>&1; then
      return 0
    fi
    if curl -fsS "http://127.0.0.1:${RENDERER_DEBUG_PORT}/json/list" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

env \
  HARNESS_URL="${HARNESS_URL}" \
  CORTEX_ELECTRON_HEADLESS="${CORTEX_ELECTRON_HEADLESS:-0}" \
  CORTEX_ELECTRON_SHOW="${CORTEX_ELECTRON_SHOW:-0}" \
  CORTEX_DISABLE_VULKAN="${CORTEX_DISABLE_VULKAN:-1}" \
  CORTEX_ENABLE_UNSAFE_WEBGPU="${CORTEX_ENABLE_UNSAFE_WEBGPU:-0}" \
  CORTEX_IGNORE_GPU_BLOCKLIST="${CORTEX_IGNORE_GPU_BLOCKLIST:-0}" \
  CORTEX_OZONE_PLATFORM="${CORTEX_OZONE_PLATFORM:-x11}" \
  xvfb-run -a \
    "${ROOT_DIR}/node_modules/.bin/electron" \
    --no-sandbox \
    --inspect="0.0.0.0:${MAIN_INSPECT_PORT}" \
    --remote-debugging-address=0.0.0.0 \
    --remote-debugging-port="${RENDERER_DEBUG_PORT}" \
    "${ROOT_DIR}/scripts/electron-harness-main.mjs" &

ELECTRON_PID=$!

if ! wait_for_main_debugger; then
  echo "[docker-electron] main inspector failed to become ready on 0.0.0.0:${MAIN_INSPECT_PORT}"
  exit 1
fi

if ! wait_for_renderer_debugger; then
  echo "[docker-electron] renderer debugger failed to become ready on 0.0.0.0:${RENDERER_DEBUG_PORT}"
  exit 1
fi

echo "[docker-electron] main inspector: 0.0.0.0:${MAIN_INSPECT_PORT}"
echo "[docker-electron] renderer debugger: 0.0.0.0:${RENDERER_DEBUG_PORT}"

wait "${ELECTRON_PID}"
