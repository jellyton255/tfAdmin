#!/usr/bin/env bash
# Stage tfAdmin for the main (production) server.
#
#   scripts/everfall/deploy-main.sh              build + stage into /var/fxservers/main/tfadmin
#   scripts/everfall/deploy-main.sh --no-build   stage the existing dist/ only
#
# Never touches the running server. main/run.sh copies the staged folder into the
# artifact's monitor on every start, so it takes effect on the next restart and
# survives artifact updates.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
STAGE_DIR=/var/fxservers/main/tfadmin
TX_VERSION=${TX_VERSION:-8.1.1}

build=1
for arg in "$@"; do
    case "$arg" in
        --no-build) build=0 ;;
        *) echo "Unknown option: $arg" >&2; exit 1 ;;
    esac
done

cd "$REPO_ROOT"

if (( build )); then
    GITHUB_REF="refs/tags/v${TX_VERSION}" pnpm run build
fi

if [[ ! -f dist/core/index.js ]]; then
    echo "dist/ has no build; run without --no-build first" >&2
    exit 1
fi

if ! node "$REPO_ROOT/scripts/everfall/smoke-core-bundle.mjs" --repo "$REPO_ROOT"; then
    echo "Smoke test failed; nothing staged for main." >&2
    exit 1
fi

sha=$(git rev-parse --short HEAD)
dirty=$(git status --porcelain --untracked-files=no | grep -q . && echo "-dirty" || true)

mkdir -p "$STAGE_DIR"
rsync -a --delete dist/ "$STAGE_DIR/"
printf '%s\n' "version=${TX_VERSION}" "commit=${sha}${dirty}" "deployed=$(date -u +%FT%TZ)" \
    > "$STAGE_DIR/.tfadmin-build"

echo "Staged tfAdmin ${TX_VERSION} (${sha}${dirty}) in $STAGE_DIR; loads on main's next restart."
