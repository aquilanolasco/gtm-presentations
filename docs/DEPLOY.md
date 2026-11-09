# Deploy

There is no CI pipeline. Each piece is shipped from a developer machine with a script, straight to
the one VPS (`<VPS_HOST>`). The pieces deploy independently:

| Piece | How it ships | Restart |
|---|---|---|
| App (Next.js, includes this module) | `deploy.sh`: lock, integrate, build, rsync standalone output | PM2 restart of the app |
| Engage worker (`workers/engage`) | Copy the scripts into `<WORKERS_DIR>/engage/` | `pm2 restart engage-worker` |
| Engage deck template (`engine/web-deck`) | `deploy-engage-template.sh`: static build, rsync, refresh existing decks | none (static files) |
| Master decks (`engine/web-deck`) | Static build per deck, rsync to `/var/www/presentation-decks/<deck>/` | none |
| Viewer (`engine/viewer/_viewer.html`) | Back up, copy one file | none |
| Local relay (`engine/create-engine`) | `sync-bundle.sh` into the LaunchAgent bundle on the Mac | `launchctl kickstart -k` |

## Branch model: one worktree per module

The app is developed by several people and agent sessions at once, each owning one module. Every
module has its own git worktree on a branch named `mod/<name>` (for example `mod/presentations`).
`main` is never checked out in any worktree; it is advanced only by the deploy script and always
equals what is live.

Remotes:

- `origin` (GitHub) receives every `mod/*` branch as a backup. Its `main` is branch-protected
  (pull requests only), so it lags behind production by design and is not used for integration.
- `vps` is a bare repo on the VPS that mirrors `main` and the module branches, so a second machine can
  pull current source without depending on GitHub. It is the authoritative shared `main`.

## What `deploy.sh` does

Run from any `mod/*` worktree. In order:

1. **Refuse a detached HEAD.**
2. **Commit** everything in the worktree with a timestamped message.
3. **Local lock.** `mkdir` a lock directory in `/tmp`; if one exists and is older than 15 minutes it
   is treated as a crashed deploy and removed. Wait until the `mkdir` succeeds.
4. **Cross-machine lock.** Same trick on the VPS over ssh, so deploys from two different machines can
   never rsync or restart at the same time. Stale after 15 minutes. An `EXIT` trap releases both locks.
5. **Integrate.** `git fetch vps`, then merge local `main` and `vps/main` into the module branch so a
   deploy can never revert work another module already shipped. On a conflict the merge is aborted and
   the script exits with instructions (merge by hand, re-run).
6. **Build.** `npm run build` (Next `output: "standalone"`).
7. **Ship static chunks first, add-only.** `rsync .next/static/` to the server without `--delete`, so
   every chunk that any live page or edge-cached HTML might reference stays on disk for the whole deploy.
   (Deleting chunks mid-deploy once let the edge cache a 404 for a JS file.)
8. **Ship the standalone server** with `--delete`, excluding `.env`, `.env.local`, `.git` and the
   anchored `/.next/static`. `.git` is excluded because the standalone output picks up the repo root
   and would otherwise push the whole history on every deploy.
9. **Ship `public/`** with `--delete`.
10. **Restore env and restart.** Over ssh: if `<APP_DIR>/.env` is missing, restore it from the backup
    copy; then refresh the backup from `.env`; `pm2 delete` + `pm2 start server.js` with
    `--node-args '--env-file <APP_DIR>/.env'`; `pm2 save`; prune static chunks older than 7 days (the
    delayed, safe cleanup for step 7).
11. **Release the VPS lock** explicitly so the other machine can proceed.
12. **Advance `main`** with `git update-ref refs/heads/main HEAD`, then push the branch and `main` to
    `origin` and `vps` (best effort).

Sanitized pseudo-script:

```bash
#!/bin/bash
set -e
VPS="deploy@<VPS_HOST>"; APP_DIR="<APP_DIR>"; APP_NAME="<PM2_APP_NAME>"
LOCK="/tmp/app-deploy.lock.d"; VPS_LOCK="/tmp/app-deploy.vpslock.d"
BRANCH=$(git branch --show-current); [ -n "$BRANCH" ] || exit 1

git add -A && git commit -qm "deploy $BRANCH: $(date '+%F %T')" || true

# locks: this machine, then the VPS (both stolen if older than 15 min)
[ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ] && rmdir "$LOCK"
until mkdir "$LOCK" 2>/dev/null; do sleep 3; done
ssh "$VPS" "find $VPS_LOCK -maxdepth 0 -mmin +15 | grep -q . && rmdir $VPS_LOCK; true"
until ssh "$VPS" "mkdir $VPS_LOCK 2>/dev/null"; do sleep 4; done
trap 'rmdir "$LOCK"; ssh "$VPS" "rmdir $VPS_LOCK"' EXIT

# integrate everything already shipped
git fetch vps || true
for REF in main vps/main; do git merge --no-edit "$REF" || { git merge --abort; exit 1; }; done

npm run build

rsync -az .next/static/ "$VPS:$APP_DIR/.next/static/"                       # add-only
rsync -az --delete --exclude=.env --exclude=.env.local --exclude=.git \
      --exclude=/.next/static .next/standalone/ "$VPS:$APP_DIR/"
rsync -az --delete public/ "$VPS:$APP_DIR/public/"

ssh "$VPS" "
  cd $APP_DIR
  [ -f .env ] || cp <ENV_BACKUP> .env
  cp .env <ENV_BACKUP>
  pm2 delete $APP_NAME; pm2 start server.js --name $APP_NAME --node-args '--env-file $APP_DIR/.env'
  pm2 save
  find .next/static -type f -mtime +7 -delete
"
ssh "$VPS" "rmdir $VPS_LOCK"

git update-ref refs/heads/main HEAD
git push origin "$BRANCH" main || true
git push vps "$BRANCH" main || true
```

### Environment variables are never shipped

- `.env` lives only on the server (`<APP_DIR>/.env`). rsync excludes it, so `--delete` cannot remove
  it, and PM2 passes it to Node with `--env-file`.
- A second copy sits outside the app folder (`<ENV_BACKUP>`). Deploy restores from it if `.env` ever
  goes missing and refreshes it from `.env` on every run. When you add or change a variable, edit
  `.env` on the server and the backup copy (or deploy right after editing `.env`).
- `.env.local` is excluded too, so a developer's local config is never pushed to production.
- `NEXT_PUBLIC_*` values (for example `NEXT_PUBLIC_APP_DOMAIN`) are inlined at build time on the
  deploying machine, so they must be set in that machine's build environment, not only on the server.
- Nothing in git holds a value: `.gitignore` excludes every `.env*` except `.env.example`, which lists
  names only.

### Database changes

Schema lives in `src/server/db/schema/`. Apply changes with drizzle-kit (`npm run db:push` or
`db:generate` + migrate) against the production database before deploying code that needs them. The
database listens on the VPS's `localhost:5432`, so run drizzle-kit on the server or through an ssh
tunnel. The module's list queries return `[]` on error, so a page never hard-fails on a missing table,
but writes will.

### Preview environment

A sibling script deploys the current branch as-is (no `main` merge, `main` not advanced) to a separate
folder, PM2 process and port with its own database copy, served at `<PREVIEW_DOMAIN>`. Use it to check a
change before running `deploy.sh`. It is not included in this repo.

## Workers are copied separately

`deploy.sh` ships only the Next app. The engage worker is deployed by hand:

```bash
# ship worker changes
scp workers/engage/*.mjs workers/engage/engage-library.json deploy@<VPS_HOST>:/var/www/acme-gtm-workers/engage/
ssh deploy@<VPS_HOST> pm2 restart engage-worker

# first start
ssh deploy@<VPS_HOST> 'cd /var/www/acme-gtm-workers && pm2 start engage/engage-worker.mjs --name engage-worker && pm2 save'

# logs
ssh deploy@<VPS_HOST> pm2 logs engage-worker --lines 100
```

Notes:

- The worker loads its own env from `<WORKERS_DIR>/.env` (then `engage/.env`): `ANTHROPIC_API_KEY`,
  `RELAY_SECRET` (same value as the app's), `APP_DOMAIN`, optional `ENGAGE_MODEL`, `ENGAGE_APP`.
  Its npm dependencies are installed once in `<WORKERS_DIR>`.
- The app's `POST /api/create/scout` runs `engage-scout.mjs` from the workers folder (`ENGAGE_SCOUT`),
  so a worker deploy also updates the site reader the Create pane uses.
- The slide library exists in three copies that must stay in sync: `src/lib/engage-library.json`
  (app), `workers/engage/engage-library.json` (worker) and the web-deck template's
  `components/library/library.json`.

## The engage template has its own script

Every generated sales deck is a copy of one static page. `engine/web-deck/deploy-engage-template.sh`:

1. Builds the template as a static export with the base path baked in:
   `DECK_EXPORT=1 DECK_BASE_PATH=/p/_engage/deck ASSET_PREFIX=/p/_engage/deck NEXT_PUBLIC_DECK_BASE_PATH=/p/_engage/deck npm run build`.
2. Checks that `out/engage.html` exists and that the base path really is in it, then copies it to
   `out/index.html`.
3. rsyncs `out/` to `/var/www/presentation-public/_engage/deck/` **without** `--delete`, so a deck that
   was open during the deploy keeps finding its old chunks.
4. Unless `--no-refresh` is passed, walks every `/var/www/presentation-public/*/deck/` that has a
   `spec.json`, copies the new `engage.html` over its `index.html` (chunk hashes changed), and re-injects
   the `<script src="/pp-edit.js">` tag if the deck had one.

## Master decks, viewer and relay

- **Master decks.** Build `engine/web-deck` once per deck with `DECK_EXPORT=1
  DECK_BASE_PATH=/presentations/<deck>`, copy the route's exported HTML to `out/index.html` (the export
  emits flat files), and `rsync -az --delete out/ <VPS>:/var/www/presentation-decks/<deck>/`. The first
  time, add one nginx location for the deck (alias + `auth_request`), then `nginx -t && systemctl reload
  nginx`.
- **Viewer.** Copy the live `/var/www/presentation-public/_viewer.html` to a dated backup, then copy
  `engine/viewer/_viewer.html` over it. No build.
- **Local relay.** Edit sources in `engine/create-engine`, run `sync-bundle.sh` (copies scripts, the
  external exporter and its `node_modules`, fonts and brand assets into the bundle under
  `~/Library/Application Support/`, keeping `relay.env`), then
  `launchctl kickstart -k gui/$(id -u)/<LAUNCHD_LABEL>`.
