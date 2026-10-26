#!/usr/bin/env bash
# Build tfAdmin and stage it for Dev2.
#
#   scripts/everfall/deploy-dev2.sh              build + stage into /var/fxservers/dev2/tfadmin-staged
#   scripts/everfall/deploy-dev2.sh --no-build   stage the existing dist/ only
#   scripts/everfall/deploy-dev2.sh --restart    also restart the fxserver-dev2 pm2 app
#
# dev2/run.sh copies the staged folder into the artifact's monitor on every start,
# and any server restart exits to load it. Dev2 only; never point this at main.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
STAGE_DIR=/var/fxservers/dev2/tfadmin-staged
PM2_APP=fxserver-dev2
PM2_BIN_DIR=/root/.nvm/versions/node/v24.13.1/bin
TX_VERSION=${TX_VERSION:-8.1.1}

build=1
restart=0
for arg in "$@"; do
    case "$arg" in
        --no-build) build=0 ;;
        --restart) restart=1 ;;
        *) echo "Unknown option: $arg" >&2; exit 1 ;;
    esac
done

cd "$REPO_ROOT"

if [[ ! -f .env ]]; then
    echo "Missing $REPO_ROOT/.env (see docs/everfall-dev2.md)" >&2
    exit 1
fi

if (( build )); then
    GITHUB_REF="refs/tags/v${TX_VERSION}" pnpm run build
fi

if [[ ! -f dist/core/index.js || ! -f dist/.tfadmin-build ]]; then
    echo "dist/ has no stamped build; run without --no-build first" >&2
    exit 1
fi

mkdir -p "$STAGE_DIR"
rsync -a --delete dist/ "$STAGE_DIR/"
# The build wrote version, build and commit into the stamp
printf 'deployed=%s\n' "$(date -u +%FT%TZ)" >> "$STAGE_DIR/.tfadmin-build"
build=$(sed -n 's/^build=//p' dist/.tfadmin-build)
commit=$(sed -n 's/^commit=//p' dist/.tfadmin-build)

echo "Staged tfAdmin r${build} (${commit}) in $STAGE_DIR"

if (( restart )); then
    PATH="$PM2_BIN_DIR:$PATH" pm2 restart "$PM2_APP"
else
    echo "Loads on Dev2's next restart (panel, scheduled, or 'pm2 restart $PM2_APP')."
fi
