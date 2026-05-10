# Atrium brand assets

Vector source + AI-generated marketing illustrations for everywhere Atrium needs a logo or social preview.

## Logo (SVG, infinitely scalable)

| File                 | Use                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `logo-mark.svg`      | Cyan mark on transparent — for dark backgrounds (X header, Discord avatar fallback, npm avatar fallback). |
| `logo-mark-dark.svg` | Navy mark on transparent — for light backgrounds (light docs sites, light README themes).                 |
| `logo.svg`           | Horizontal lockup, dark wordmark — README header on light, light marketing pages.                         |
| `logo-light.svg`     | Horizontal lockup, light wordmark — dark sites, X profile header.                                         |
| `favicon.svg`        | Simplified mark on rounded dark tile — `<link rel="icon" type="image/svg+xml">`.                          |

The SVG mark, wordmark, and favicon are **the canonical brand identity**. Use them anywhere a logo is needed. They scale crisply from 16px favicon to billboard.

## AI-generated marketing illustrations

Atmospheric variants generated with Gemini Nano Banana 2 (`gemini-3.1-flash-image-preview`) at 2K, anchored to a single reference image so the visual language stays consistent across assets. Stored under `generated/`.

| File                                               | Aspect | Use                                                                                                                           |
| -------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `generated/og-base-v3.png`                         | 16:9   | **Primary OG / social-share background.** Cleanest left negative space + atmospheric particles. Used by `og-image-final.svg`. |
| `generated/readme-hero-v1.png`                     | 21:9   | **GitHub README hero banner.** Drop at the top of the root README via `<img>`.                                                |
| `generated/landing-hero-v1.png`                    | 16:9   | **Landing-page hero (atriumjs.dev).** Shows depth via receding arches.                                                        |
| `generated/avatar-square-v1.png`                   | 1:1    | **Profile avatars** for npm org, X, Discord, GitHub org. Crops to circle cleanly.                                             |
| `generated/product-mockup-v1.png`                  | 16:9   | **"Embedded in your app" visual.** The Mac-window framing tells the product story without a screenshot.                       |
| `generated/og-base-v1.png`, `og-base-v2-right.png` | 16:9   | Alternate compositions kept as variants — not the primary picks but useful as fallbacks or for A/B testing.                   |

## Composited social card

`og-image-final.svg` composites `generated/og-base-v3.png` with a pixel-perfect SVG type overlay (wordmark + tagline + repo URL + install one-liner). Rasterize before uploading anywhere that wants PNG (X cards, GitHub repo "Social preview" setting, LinkedIn previews):

```bash
# Pick one — all three produce the same 1200×630 PNG.
rsvg-convert -w 1200 og-image-final.svg -o og-image-final.png      # macOS: brew install librsvg
inkscape og-image-final.svg --export-filename=og-image-final.png --export-width=1200
npx -y @resvg/resvg-js-cli og-image-final.svg -o og-image-final.png
```

Rasterizing through SVG (rather than asking the AI to bake in text) guarantees the wordmark renders crisp at every zoom level — Gemini and other image models occasionally mangle small letterforms, especially when text overlaps a glow.

## Color palette

| Token     | Hex       | Use                                                  |
| --------- | --------- | ---------------------------------------------------- |
| Navy      | `#0b0d12` | Primary dark / canvas background / wordmark on light |
| Surface   | `#0e1119` | OG image gradient top, secondary surfaces            |
| Slate-300 | `#cbd5e1` | OG image tagline                                     |
| Slate-400 | `#94a3b8` | OG image sub-text, secondary captions                |
| Slate-500 | `#64748b` | OG image dividers                                    |
| Cyan      | `#22d3ee` | Accent / mark / loading bar / control pill           |
| White     | `#f9fafb` | Wordmark on dark                                     |

The cyan accent matches the in-product loading bar (`packages/react/src/index.tsx`) and the control pill background, so brand and product feel cohesive.

## Typography

Wordmark: **Inter** (700 / 800 weight) with `letter-spacing: -1` to `-3` depending on size. Falls back through `ui-sans-serif → system-ui → -apple-system → Segoe UI → sans-serif`.

For print or any medium where the system might not have Inter, open the SVG in Figma / Illustrator and convert text to outlines.

## Required exports for launch day

| Asset                           | Source                                    | Where it goes                                                 |
| ------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `og-image-final.png` (1200×630) | `og-image-final.svg` (rasterize)          | GitHub Settings → Social preview, OG meta tag on atriumjs.dev |
| `avatar-512.png` (512×512)      | `generated/avatar-square-v1.png` (resize) | npm org settings, X profile, Discord avatar                   |
| `favicon.png` (32×32 + 180×180) | `favicon.svg` (rasterize at each size)    | atriumjs.dev `<link rel="icon">` and Apple touch icon         |

## Regenerating illustrations

The illustration generation flow is reproducible:

1. Start the local image-gen-api: `cd ~/ohmaseclaro/claude-tools/image-gen-api && npm run start`
2. Use `og-base-v1.png` as the **anchor reference image** for any new variant — pass it via `input_image_paths` so the new generation inherits the navy + cyan palette and arch silhouette without me having to re-describe the brand each time.
3. The exact prompts used for each existing asset are preserved in the conversation history and can be tweaked for variants (different aspect ratios, alternate compositions, or seasonal themes).

## Don't

- Stretch or recolor the SVG wordmark outside the palette above.
- Use the cyan stroke at < 6 logical pixels — it loses contrast.
- Place the dark variant on a dark background or vice versa.
- Embed an AI-generated illustration where a vector logo belongs (favicon, app icon, chrome buttons).
- Bake text into AI illustrations — the wordmark always overlays via SVG so it stays sharp.
