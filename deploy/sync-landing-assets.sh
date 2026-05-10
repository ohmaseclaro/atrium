#!/usr/bin/env bash
#
# Atrium landing static asset sync.
#
# Copies brand assets (logo, hero illustration, favicon) into
# `deploy/landing/img/` so nginx serves them at /img/* alongside index.html.
#
# Run from anywhere; resolves the repo root via the script path.
# Idempotent — safe to run on every deploy.

set -eo pipefail

ATRIUM_ROOT="${ATRIUM_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRAND_DIR="$ATRIUM_ROOT/assets/brand"
LANDING_IMG_DIR="$ATRIUM_ROOT/deploy/landing/img"

mkdir -p "$LANDING_IMG_DIR"

copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [ -f "$src" ]; then
    cp "$src" "$dst"
    echo "  • $(basename "$src") → $(realpath --relative-to="$ATRIUM_ROOT" "$dst" 2>/dev/null || echo "$dst")"
  else
    echo "  ⚠ missing: $src" >&2
  fi
}

echo "📦 Syncing landing assets into $LANDING_IMG_DIR"

# Hero illustration on the landing page (atmospheric arch with receding depth).
copy_if_exists "$BRAND_DIR/generated/landing-hero-v1.png" "$LANDING_IMG_DIR/landing-hero.png"

# Vector favicon — modern browsers prefer SVG when offered.
copy_if_exists "$BRAND_DIR/favicon.svg" "$LANDING_IMG_DIR/favicon.svg"

# Composited OG / Twitter card. Rasterize the SVG so social-card crawlers
# (which don't render SVG) get a proper PNG. We try rsvg-convert first, then
# fall back to a few common alternatives. If none are available, the script
# warns rather than failing the whole deploy — the page still works without
# a custom OG image, just with degraded social previews.
OG_SVG="$BRAND_DIR/og-image-final.svg"
OG_PNG="$LANDING_IMG_DIR/og-image.png"
if [ -f "$OG_SVG" ]; then
  if command -v rsvg-convert >/dev/null 2>&1; then
    (cd "$BRAND_DIR" && rsvg-convert -w 1200 og-image-final.svg -o "$OG_PNG")
    echo "  • og-image.png (1200×630) — rasterized via rsvg-convert"
  elif command -v inkscape >/dev/null 2>&1; then
    inkscape "$OG_SVG" --export-filename="$OG_PNG" --export-width=1200 >/dev/null
    echo "  • og-image.png (1200×630) — rasterized via inkscape"
  elif command -v npx >/dev/null 2>&1; then
    # resvg-js-cli resolves <image href="..."> against the cwd, not the SVG
    # path — so we cd into BRAND_DIR (the SVG references generated/og-base-v3.png).
    # Flag form: --fit-width <num>, output is positional.
    (cd "$BRAND_DIR" && npx -y @resvg/resvg-js-cli --fit-width 1200 og-image-final.svg "$OG_PNG") >/dev/null 2>&1 || true
    if [ -f "$OG_PNG" ]; then
      echo "  • og-image.png (1200×630) — rasterized via @resvg/resvg-js-cli"
    else
      echo "  ⚠ og-image.png not produced — install rsvg-convert (brew install librsvg) or inkscape and re-run." >&2
    fi
  else
    echo "  ⚠ no SVG rasterizer found (rsvg-convert / inkscape / npx). Social previews will fall back to default." >&2
  fi
else
  echo "  ⚠ missing: $OG_SVG" >&2
fi

# Favicon raster fallbacks (32 + 180). Same rasterizer detection as above.
FAV_SVG="$BRAND_DIR/favicon.svg"
if [ -f "$FAV_SVG" ]; then
  for size in 32 180; do
    out="$LANDING_IMG_DIR/favicon-${size}.png"
    if command -v rsvg-convert >/dev/null 2>&1; then
      rsvg-convert -w "$size" "$FAV_SVG" -o "$out"
      echo "  • favicon-${size}.png — rasterized via rsvg-convert"
    elif command -v inkscape >/dev/null 2>&1; then
      inkscape "$FAV_SVG" --export-filename="$out" --export-width="$size" >/dev/null
      echo "  • favicon-${size}.png — rasterized via inkscape"
    elif command -v npx >/dev/null 2>&1; then
      # See OG block above for the resvg-js-cli flag/cwd notes. The favicon
      # has no external <image href>, so we don't strictly need to cd, but
      # we do anyway for consistency with the OG path.
      (cd "$BRAND_DIR" && npx -y @resvg/resvg-js-cli --fit-width "$size" favicon.svg "$out") >/dev/null 2>&1 || true
      [ -f "$out" ] && echo "  • favicon-${size}.png — rasterized via @resvg/resvg-js-cli"
    fi
  done
fi

echo "✓ landing assets synced"
