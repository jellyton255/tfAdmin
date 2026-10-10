#!/usr/bin/env bash
# Build tfAdmin and install it as Dev2's monitor resource.
#
#   scripts/everfall/deploy-dev2.sh              build + sync into Dev2's monitor
#   scripts/everfall/deploy-dev2.sh --no-build   sync the existing dist/ only
#   scripts/everfall/deploy-dev2.sh --restart    also restart the fxserver-dev2 pm2 app
#
# Dev2 only. Never point this at /var/fxservers/main.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MONITOR_DIR=/var/fxservers/dev2/FxServer/opt/cfx-server/citizen/system_resources/monitor
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

if [[ ! -f dist/core/index.js ]]; then
    echo "dist/ has no build; run without --no-build first" >&2
    exit 1
fi

sha=$(git rev-parse --short HEAD)
dirty=$(git status --porcelain --untracked-files=no | grep -q . && echo "-dirty" || true)

# .runtime is FXServer's own cache; leave it in place.
rsync -a --delete --exclude=.runtime dist/ "$MONITOR_DIR/"
printf '%s\n' "version=${TX_VERSION}" "commit=${sha}${dirty}" "deployed=$(date -u +%FT%TZ)" \
    > "$MONITOR_DIR/.tfadmin-build"

echo "Deployed tfAdmin ${TX_VERSION} (${sha}${dirty}) to $MONITOR_DIR"

if (( restart )); then
    PATH="$PM2_BIN_DIR:$PATH" pm2 restart "$PM2_APP"
else
    echo "Not restarted. Run 'pm2 restart $PM2_APP' (or pass --restart) to load it."
fi
