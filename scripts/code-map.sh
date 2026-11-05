#!/usr/bin/env bash
# Builds or refreshes the code map in code-map/ (see skills/navigate-the-code-map).
# Structural pass only: no LLM, no API key. Creates tools/code-map/.venv on first run
# and installs the exact versions pinned in tools/code-map/requirements.txt.
# Reruns are incremental (cache in code-map/cache). Usage: scripts/code-map.sh [--rebuild]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VENV="tools/code-map/.venv"
export GRAPHIFY_OUT=code-map
export PYTHONHASHSEED=0

if [ "${1:-}" = "--rebuild" ]; then
  rm -rf code-map
fi

# CODE_MAP_RUNNER, when set, is a command prefix for the install and the build
# (for example a wrapper that caps memory and CPU). CODE_MAP_PYTHON picks the
# interpreter for the venv (Python 3.10 or newer).
run() {
  if [ -n "${CODE_MAP_RUNNER:-}" ]; then
    # shellcheck disable=SC2086
    $CODE_MAP_RUNNER "$@"
  else
    "$@"
  fi
}

if [ ! -x "$VENV/bin/graphify" ]; then
  run bash -c "${CODE_MAP_PYTHON:-python3} -m venv $VENV && $VENV/bin/pip install -q --disable-pip-version-check -r tools/code-map/requirements.txt"
fi

run "$VENV/bin/graphify" update .

# Drop outputs that are not part of the committed map.
rm -f code-map/graph.html
node scripts/code-map-index.mjs
echo "code map: code-map/GRAPH_REPORT.md, code-map/FILE_INDEX.md (graph.json stays local)"
