#!/usr/bin/env node
/**
 * Regenerate optimized brand-image derivatives from the lossless masters in
 * `assets/brand/generated/`.
 *
 *   node scripts/regenerate-brand-images.mjs
 *
 * Inputs (lossless masters, committed):
 *   assets/brand/generated/landing-hero-v1.png  (~4 MB, 16:9)
 *   assets/brand/generated/readme-hero-v1.png   (~4.6 MB, 21:9)
 *
 * Outputs (committed, served by the landing/GitHub):
 *   deploy/landing/img/landing-hero.webp        (~28 KB, primary on the landing)
 *   deploy/landing/img/landing-hero.jpg         (~60 KB, picture-element fallback)
 *   assets/brand/readme-hero.jpg                (~30 KB, README hero <img src>)
 *
 * Run this whenever the master PNGs change. Not invoked by the deploy script —
 * deploy/sync-landing-assets.sh just copies the committed derivatives.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { stat } from "node:fs/promises";
import sharp from "sharp";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const tasks = [
  {
    label: "landing hero",
    input: "assets/brand/generated/landing-hero-v1.png",
    outputs: [
      {
        path: "deploy/landing/img/landing-hero.webp",
        width: 1920,
        encode: (p) => p.webp({ quality: 86, effort: 6 }),
      },
      {
        path: "deploy/landing/img/landing-hero.jpg",
        width: 1920,
        encode: (p) => p.jpeg({ quality: 85, mozjpeg: true }),
      },
    ],
  },
  {
    label: "README hero",
    input: "assets/brand/generated/readme-hero-v1.png",
    outputs: [
      {
        path: "assets/brand/readme-hero.jpg",
        width: 1600,
        encode: (p) => p.jpeg({ quality: 88, mozjpeg: true }),
      },
    ],
  },
];

const human = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;

for (const t of tasks) {
  const inAbs = resolve(repoRoot, t.input);
  const inSize = (await stat(inAbs)).size;
  console.log(`\n• ${t.label} (${t.input}, ${human(inSize)})`);
  for (const o of t.outputs) {
    const outAbs = resolve(repoRoot, o.path);
    let pipeline = sharp(inAbs).resize({ width: o.width, withoutEnlargement: true });
    pipeline = o.encode(pipeline);
    await pipeline.toFile(outAbs);
    const outSize = (await stat(outAbs)).size;
    const pct = ((outSize / inSize) * 100).toFixed(1);
    console.log(`    → ${o.path}  ${human(outSize)}  (${pct}% of master)`);
  }
}

console.log("\n✓ done — review the diffs and commit any changed derivatives.");
