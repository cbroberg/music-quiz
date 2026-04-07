#!/usr/bin/env node
// Builds the tvOS App Icon brand asset from logo/music-quiz-logo-new.svg.
//
// Output: apps/tvos/MusicQuiz/Assets.xcassets/AppIcon.brandassets/
//   ├── Contents.json
//   ├── App Icon - App Store.imagestack/   (1280x768 — App Store)
//   │   ├── Contents.json
//   │   ├── Back.imagestacklayer/Content.imageset/{Contents.json, back.png}
//   │   ├── Middle.imagestacklayer/Content.imageset/{Contents.json}
//   │   └── Front.imagestacklayer/Content.imageset/{Contents.json}
//   ├── App Icon.imagestack/                (400x240 — home screen)
//   │   └── ...same structure
//   └── Top Shelf Image.imageset/           (1920x720)
//       └── Contents.json + topshelf.png
//
// Strategy: render the SVG centered on a #180a1b background with the glyph
// scaled to fit the icon's short edge. Single visible layer (back); middle
// + front are empty placeholders so tvOS accepts the brand asset.
//
// Re-run any time the source logo changes:
//   node apps/tvos/scripts/build-icon.mjs
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const sharp = require("../../../node_modules/sharp");

const HERE   = dirname(fileURLToPath(import.meta.url));
const TVOS   = join(HERE, "..");                                  // apps/tvos
const REPO   = join(TVOS, "..", "..");                            // repo root
const LOGO   = join(REPO, "logo", "music-quiz-logo.svg");
const ASSETS = join(TVOS, "MusicQuiz", "Assets.xcassets");
const BRAND  = join(ASSETS, "AppIcon.brandassets");

const BG_COLOR = { r: 0x18, g: 0x0a, b: 0x1b, alpha: 1 };  // #180a1b

// ── Render helper ────────────────────────────────────────
async function renderIcon(width, height, glyphScale = 0.85) {
  // Render the SVG at the icon's short edge × glyphScale, then composite
  // centered onto a solid background of the full icon size.
  const short = Math.min(width, height);
  const glyph = Math.round(short * glyphScale);

  const logoPng = await sharp(LOGO, { density: 150 })
    .resize(glyph, glyph, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: BG_COLOR,
    },
  })
    .composite([{ input: logoPng, gravity: "center" }])
    .png()
    .toBuffer();
}

async function renderTopShelf(width, height) {
  // Top shelf is 16:6 — give the logo more breathing room and shift right of center.
  const glyph = Math.round(height * 0.75);
  const logoPng = await sharp(LOGO, { density: 150 })
    .resize(glyph, glyph, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width, height, channels: 4, background: BG_COLOR },
  })
    .composite([{ input: logoPng, gravity: "center" }])
    .png()
    .toBuffer();
}

// ── Imagestack layer scaffolding ─────────────────────────
function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

function writeLayer(stackDir, name, opts) {
  const layerDir   = join(stackDir, `${name}.imagestacklayer`);
  const contentDir = join(layerDir, "Content.imageset");
  mkdirSync(contentDir, { recursive: true });
  writeJson(join(layerDir, "Contents.json"), {
    info: { author: "xcode", version: 1 },
  });
  if (opts.images) {
    // Multiple scales (1x + 2x)
    opts.images.forEach((img) =>
      writeFileSync(join(contentDir, img.filename), img.buffer)
    );
    writeJson(join(contentDir, "Contents.json"), {
      images: opts.images.map((img) => ({
        idiom: "tv",
        filename: img.filename,
        scale: img.scale,
      })),
      info: { author: "xcode", version: 1 },
    });
  } else {
    writeJson(join(contentDir, "Contents.json"), {
      images: [
        { idiom: "tv", scale: "1x" },
        { idiom: "tv", scale: "2x" },
      ],
      info: { author: "xcode", version: 1 },
    });
  }
}

async function writeStack(stackPath, width, height, fileTag) {
  rmSync(stackPath, { recursive: true, force: true });
  mkdirSync(stackPath, { recursive: true });
  writeJson(join(stackPath, "Contents.json"), {
    layers: [
      { filename: "Front.imagestacklayer" },
      { filename: "Middle.imagestacklayer" },
      { filename: "Back.imagestacklayer" },
    ],
    info: { author: "xcode", version: 1 },
  });
  // Generate 1x + 2x for both back layer (with logo) and the empty parallax layers.
  const back1x = await renderIcon(width, height);
  const back2x = await renderIcon(width * 2, height * 2);
  const makeBlank = async (w, h) =>
    sharp({
      create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();
  const blank1x = await makeBlank(width, height);
  const blank2x = await makeBlank(width * 2, height * 2);

  writeLayer(stackPath, "Back", {
    images: [
      { filename: `back-${fileTag}.png`,    buffer: back1x, scale: "1x" },
      { filename: `back-${fileTag}@2x.png`, buffer: back2x, scale: "2x" },
    ],
  });
  writeLayer(stackPath, "Middle", {
    images: [
      { filename: `middle-${fileTag}.png`,    buffer: blank1x, scale: "1x" },
      { filename: `middle-${fileTag}@2x.png`, buffer: blank2x, scale: "2x" },
    ],
  });
  writeLayer(stackPath, "Front", {
    images: [
      { filename: `front-${fileTag}.png`,    buffer: blank1x, scale: "1x" },
      { filename: `front-${fileTag}@2x.png`, buffer: blank2x, scale: "2x" },
    ],
  });
}

// ── Top Shelf imagesets (regular + wide) ─────────────────
async function writeTopShelfImagesets() {
  // Regular Top Shelf — 1920x720 @1x + 3840x1440 @2x
  const dir1 = join(BRAND, "Top Shelf Image.imageset");
  rmSync(dir1, { recursive: true, force: true });
  mkdirSync(dir1, { recursive: true });
  const ts1x = await renderTopShelf(1920, 720);
  const ts2x = await renderTopShelf(3840, 1440);
  writeFileSync(join(dir1, "topshelf.png"),    ts1x);
  writeFileSync(join(dir1, "topshelf@2x.png"), ts2x);
  writeJson(join(dir1, "Contents.json"), {
    images: [
      { idiom: "tv", filename: "topshelf.png",    scale: "1x" },
      { idiom: "tv", filename: "topshelf@2x.png", scale: "2x" },
    ],
    info: { author: "xcode", version: 1 },
  });

  // Wide Top Shelf — 2320x720 @1x + 4640x1440 @2x
  const dir2 = join(BRAND, "Top Shelf Image Wide.imageset");
  rmSync(dir2, { recursive: true, force: true });
  mkdirSync(dir2, { recursive: true });
  const wide1x = await renderTopShelf(2320, 720);
  const wide2x = await renderTopShelf(4640, 1440);
  writeFileSync(join(dir2, "topshelf-wide.png"),    wide1x);
  writeFileSync(join(dir2, "topshelf-wide@2x.png"), wide2x);
  writeJson(join(dir2, "Contents.json"), {
    images: [
      { idiom: "tv", filename: "topshelf-wide.png",    scale: "1x" },
      { idiom: "tv", filename: "topshelf-wide@2x.png", scale: "2x" },
    ],
    info: { author: "xcode", version: 1 },
  });
}

// ── Brand Asset top-level ────────────────────────────────
function writeBrandContents() {
  writeJson(join(BRAND, "Contents.json"), {
    assets: [
      {
        filename: "App Icon - App Store.imagestack",
        idiom: "tv",
        role: "primary-app-icon",
        size: "1280x768",
      },
      {
        filename: "App Icon.imagestack",
        idiom: "tv",
        role: "primary-app-icon",
        size: "400x240",
      },
      {
        filename: "Top Shelf Image.imageset",
        idiom: "tv",
        role: "top-shelf-image",
        size: "1920x720",
      },
      {
        filename: "Top Shelf Image Wide.imageset",
        idiom: "tv",
        role: "top-shelf-image-wide",
        size: "2320x720",
      },
    ],
    info: { author: "xcode", version: 1 },
  });
}

// ── Main ─────────────────────────────────────────────────
(async () => {
  console.log("🎨 Building tvOS App Icon brand asset…");
  rmSync(BRAND, { recursive: true, force: true });
  mkdirSync(BRAND, { recursive: true });

  await writeStack(join(BRAND, "App Icon - App Store.imagestack"), 1280, 768, "1280");
  await writeStack(join(BRAND, "App Icon.imagestack"),               400, 240,  "400");
  await writeTopShelfImagesets();
  writeBrandContents();

  console.log("✅ Brand asset written to:", BRAND);
})().catch((err) => {
  console.error("❌ Icon build failed:", err);
  process.exit(1);
});
