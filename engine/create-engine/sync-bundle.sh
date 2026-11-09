#!/bin/bash
# Redeploy the create-engine + export tooling into the self-contained launchd bundle
# (~/Library/Application Support/pp-create-relay), which runs outside ~/Documents to dodge macOS
# TCC restrictions on launchd. Run this after editing any source script, then:
#   launchctl kickstart -k gui/$(id -u)/com.acme.create-relay
set -e
CE="$(cd "$(dirname "$0")" && pwd)"
RUI="${EXPORT_SRC:-$HOME/presentation-agent/export}"
CANVADIR="${CANVA_SRC:-$HOME/presentation-agent/canva}"
B="$HOME/Library/Application Support/pp-create-relay"
mkdir -p "$B/export/node_modules"
cp "$CE/relay.mjs" "$CE/build-one.mjs" "$CE/build-gamma.mjs" "$CE/generate.mjs" "$CE/ingest.py" "$B/"
cp "$CANVADIR/canva.py" "$B/canva.py" 2>/dev/null || echo "WARN: canva.py not copied"
cp "$RUI/export-deck.mjs" "$B/export/"
cp "$RUI/export-pptx-editable.mjs" "$B/export/"   # editable-PPTX exporter (native text boxes + detached images)
rsync -a --delete "$RUI/node_modules/" "$B/export/node_modules/"
# brand font so generated decks match the master templates under launchd
FONTS="${BRAND_FONTS_SRC:-$HOME/presentation-agent/assets/fonts}"
mkdir -p "$B/fonts"
cp "$FONTS/Inter-Light.ttf" "$FONTS/Inter-Medium.ttf" "$B/fonts/" 2>/dev/null || echo "WARN: brand fonts not copied"
# brand-kit assets from the master deck (emblem, product shots, app posters)
PUB="${BRAND_ASSETS_SRC:-$HOME/presentation-agent/web-deck/public}"
mkdir -p "$B/brand-assets/gen" "$B/brand-assets/products" "$B/brand-assets/screens" "$B/brand-assets/acme"
cp "$PUB/gen/emblem.png" "$B/brand-assets/gen/" 2>/dev/null
cp "$PUB/gen/worldmap.svg" "$B/brand-assets/gen/" 2>/dev/null
cp "$PUB/gen/townhall-master.json" "$B/brand-assets/gen/" 2>/dev/null   # town-hall master for reuse
cp "$PUB/gen/sp-devices.png" "$B/brand-assets/gen/" 2>/dev/null   # captured short-pack device cluster (hybrid cover)
cp "$PUB/gen/target3d.png" "$B/brand-assets/gen/" 2>/dev/null   # 3D dart target (vision slide)
cp "$PUB/acme/logo.png" "$B/brand-assets/acme/" 2>/dev/null
cp "$PUB/acme/logo-allwhite.png" "$B/brand-assets/acme/" 2>/dev/null   # white logo for dark slides
cp "$PUB/acme/device.png" "$B/brand-assets/acme/" 2>/dev/null   # short-pack device mockup
mkdir -p "$B/brand-assets/screens-mobile"; cp "$PUB/screens-mobile/products.webp" "$B/brand-assets/screens-mobile/" 2>/dev/null   # mobile screen for hybrid cover phone
cp "$PUB"/products/*.png "$PUB"/products/*.jpg "$B/brand-assets/products/" 2>/dev/null
cp "$PUB"/screens/poster-*.webp "$B/brand-assets/screens/" 2>/dev/null   # includes poster-*-current.webp (live UI)
echo "bundle synced -> $B  (relay.env preserved)"
