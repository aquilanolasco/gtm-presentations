#!/bin/bash
# Build + deploy the ENGAGEMENT DECK TEMPLATE (app/engage), shared by every generated sales deck.
#
#   ./deploy-engage-template.sh            # build, deploy, refresh every existing engagement deck
#   ./deploy-engage-template.sh --no-refresh
#
# The template is built ONCE with its assets under /p/_engage/deck/ and deployed there. A generated
# deck (/var/www/presentation-public/<slug>/deck/) is just a copy of out/engage.html as index.html
# plus spec.json + logo/hero, which the engage worker writes; the page fetches spec.json at runtime.
# After a rebuild the chunk hashes change, so every existing engagement deck gets a fresh copy of the
# template HTML (its pp-edit.js tag re-injected if the Slide Editor had added one). Old chunks are
# kept on the VPS (rsync without --delete), so a deck that was open mid-deploy keeps working.
set -euo pipefail
VPS="${VPS:-root@<VPS_HOST>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
BP="/p/_engage/deck"
REFRESH=1
[ "${1:-}" = "--no-refresh" ] && REFRESH=0
cd "$HERE"
echo "[engage] building template (base $BP) ..."
rm -rf .next out
DECK_EXPORT=1 DECK_BASE_PATH="$BP" ASSET_PREFIX="$BP" NEXT_PUBLIC_DECK_BASE_PATH="$BP" npm run build > /tmp/engage-template-build.log 2>&1 || { echo "BUILD FAILED"; tail -40 /tmp/engage-template-build.log; exit 1; }
[ -f out/engage.html ] || { echo "MISSING out/engage.html"; exit 1; }
grep -q "$BP/_next" out/engage.html || { echo "BASE PATH NOT BAKED"; exit 1; }
cp out/engage.html out/index.html
echo "[engage] deploying to $BP/ ..."
ssh "$VPS" "mkdir -p /var/www/presentation-public/_engage/deck"
rsync -az --no-perms --no-owner --no-group out/ "$VPS:/var/www/presentation-public/_engage/deck/"
if [ "$REFRESH" = 1 ]; then
  echo "[engage] refreshing existing engagement decks ..."
  ssh "$VPS" 'for d in /var/www/presentation-public/*/deck; do
      [ -f "$d/spec.json" ] || continue
      had_edit=0; grep -q "/pp-edit.js" "$d/index.html" 2>/dev/null && had_edit=1
      cp /var/www/presentation-public/_engage/deck/engage.html "$d/index.html"
      [ "$had_edit" = 1 ] && sed -i "s#</body>#<script src=\"/pp-edit.js\"></script></body>#" "$d/index.html"
      echo "  refreshed $d"
    done'
fi
echo "[engage] template live: https://${APP_DOMAIN:-app.example.com}$BP/"
