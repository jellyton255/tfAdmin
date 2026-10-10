# tfAdmin on Dev2

tfAdmin is Everfall's fork of txAdmin. On Dev2 it replaces the stock `monitor` system resource
that ships inside the FXServer artifact.

| What | Where |
| --- | --- |
| Working checkout | `/var/fxservers/dev2/tfAdmin` (`origin` = jellyton255/tfAdmin, `upstream` = citizenfx/txAdmin) |
| Installed build | `/var/fxservers/dev2/FxServer/opt/cfx-server/citizen/system_resources/monitor` |
| Build marker | `monitor/.tfadmin-build` (version, commit, deploy time) |
| txData | `/var/fxservers/dev2/txData` (untouched by deploys) |
| Process | pm2 app `fxserver-dev2` (`/var/fxservers/dev2/run.sh`, panel on port 40122) |
| Stock backup | `/var/fxservers/dev2/backups/txadmin-stock-8.1.1-*/` (monitor copy + txData tarball) |

## Setup (already done on Dev2)

```sh
cd /var/fxservers/dev2/tfAdmin
npm ci
cat > .env <<'EOF'
TXDEV_FXSERVER_PATH='/var/fxservers/dev2/FxServer/opt/cfx-server/'
TXDEV_VITE_URL='http://localhost:40122'
EOF
```

npm 12 blocks install scripts for `esbuild` and `@swc/core`; the build works without them because
their platform binaries come in as optional dependencies.

## Build and deploy loop

```sh
scripts/everfall/deploy-dev2.sh            # build, then sync dist/ into Dev2's monitor
scripts/everfall/deploy-dev2.sh --restart  # same, then pm2 restart fxserver-dev2
scripts/everfall/deploy-dev2.sh --no-build # sync the current dist/ only
```

The build is stamped `8.1.1` (override with `TX_VERSION=x.y.z`). Avoid pre-release versions such as
`8.1.1-tf.1`: txAdmin treats them as expiring pre-releases and stops working after 21 days.

What each kind of change needs to go live:

- `core/`, `panel/`, `web/`: deploy, then restart `fxserver-dev2` in pm2. The core runs in the
  txAdmin host process, which only a pm2 restart replaces.
- `resource/`, `nui/`: deploy, then restart the game server from the txAdmin panel. The host process
  keeps running; the child server reloads the monitor resource from disk.

Restarting either kicks everyone on Dev2, so check who is on first.

Confirm what is running:

```sh
cat /var/fxservers/dev2/FxServer/opt/cfx-server/citizen/system_resources/monitor/.tfadmin-build
tail -f /var/log/pm2/fxserver-dev2-out.log
```

## Upstream's watch mode

`npm run dev -w core` (see `docs/development.md`) spawns its own FXServer and expects a Windows
`FXServer.exe`, so it does not fit the pm2-managed Dev2 instance. Use the deploy script instead.

- `npm run browser -w nui` serves the in-game menu in a browser on port 40121.
- `npm run dev -w panel` wants port 40122, which Dev2's live txAdmin already holds, so build the
  panel through the deploy script instead.

## Syncing upstream

```sh
git fetch upstream
git merge upstream/master
```

## Rolling back to stock

```sh
B=$(ls -d /var/fxservers/dev2/backups/txadmin-stock-8.1.1-* | tail -1)
rsync -a --delete --exclude=.runtime "$B/monitor/" \
    /var/fxservers/dev2/FxServer/opt/cfx-server/citizen/system_resources/monitor/
pm2 restart fxserver-dev2
```

## Nightly build, smoke test, and upstream tracking

`/usr/local/sbin/tfadmin-nightly` (systemd `tfadmin-nightly.timer`, 03:30 UTC) builds `origin/master`
in `/var/lib/tfadmin-nightly/src` and stages it in `/var/fxservers/main/tfadmin`. Main installs it on
its next scheduled restart. The job never pushes, restarts, or signals anything.

- **Smoke test.** Before staging, the job runs `scripts/everfall/smoke-core-bundle.mjs` (falls back to
  `/usr/local/lib/tfadmin-nightly/smoke-core-bundle.mjs` for commits that predate it). It fails the
  build when `dist/core/index.js` references an undefined free identifier, such as a missing import
  that esbuild turned into `txEnv` next to `txEnv2`. It then boots a copy headlessly on a free
  loopback port and waits for `/login`. A failed build is not staged and Main keeps its build.
  Run it locally after `pnpm run build`: `node scripts/everfall/smoke-core-bundle.mjs`.
- **Upstream check.** Every run fetches `citizenfx/txAdmin` `master` and trial-merges it into
  `origin/master` with `git merge-tree` (no worktree change). Results go to
  `/var/log/tfadmin-nightly.log` and `/var/lib/tfadmin-nightly/status.json`. The panel shows them
  to admins with all permissions (warning bar for unmerged upstream releases or a failed nightly,
  Diagnostics > tfAdmin for everything). Check now with `tfadmin-nightly --upstream-only`.

To merge upstream:

```sh
cd /var/fxservers/dev2/tfAdmin
git fetch upstream --tags
git switch master && git pull --ff-only origin master
git merge upstream/master        # resolve the files the status lists as conflicting
pnpm install && pnpm -r test && GITHUB_REF=refs/tags/v8.1.1 pnpm run build
node scripts/everfall/smoke-core-bundle.mjs
git push origin master           # the next nightly stages it for Main
```

Keep the `8.1.1` stamp unless a merged upstream release needs a newer one; do not use pre-release
versions.
