// scripts/rasterize-icon.mjs — turn public/icon.svg into icon-16/48/128.png
// using real Chrome via Playwright. ImageMagick's SVG parser drops fills
// inconsistently across versions; Chrome renders the file the same way it
// will inside the extension, so what you see is what ships.
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PUB = join(process.cwd(), 'public');
const svg = await readFile(join(PUB, 'icon.svg'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();

const SIZES = [16, 48, 128];
for (const size of SIZES) {
  // Wrap the SVG in a transparent page sized exactly to the target dimensions.
  // The SVG's viewBox stretches to fit the <div>; width/height attributes are
  // set inline so the renderer doesn't pick the SVG's intrinsic size.
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>
       html, body { margin: 0; padding: 0; background: transparent; }
       svg { display: block; width: ${size}px; height: ${size}px; }
     </style>${svg}`,
    { waitUntil: 'load' },
  );
  const png = await page.locator('svg').screenshot({ omitBackground: true });
  await writeFile(join(PUB, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png (${png.length} bytes)`);
}

await browser.close();
