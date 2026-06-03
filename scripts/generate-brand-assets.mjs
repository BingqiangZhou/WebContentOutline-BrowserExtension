#!/usr/bin/env node

import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICON_SVG_DIR = path.join(ROOT, 'icons', 'svg');
const ICON_PNG_DIR = path.join(ROOT, 'icons', 'png');
const BRAND_DIR = path.join(ROOT, 'docs', 'brand');
const ICON_SIZES = [16, 32, 48, 128];

const COLORS = {
  appInk: '#0f172a',
  appInkSoft: '#1e293b',
  page: '#ffffff',
  enabledMark: '#202124',
  outlineGray: '#737373',
  text: '#111827',
  muted: '#4b5563',
  surface: '#f8fafc',
  border: '#d8dee8'
};

const COPY = {
  en: {
    name: 'Web TOC Assistant',
    tagline: 'Interactive outlines for long webpages',
    eyebrow: 'Version 1.0',
    bullets: ['Live outline preview', 'Hover-to-expand Edge Dock', 'Per-site navigation settings'],
    cta: 'Read faster. Navigate cleaner.',
    screenshotTitle: 'Turn long pages into a live outline',
    screenshotSubtitle: 'Edge Dock keeps the current section visible while you read.'
  },
  zh: {
    name: '网页目录助手',
    tagline: '为长网页生成可交互目录',
    eyebrow: '1.0 正式版',
    bullets: ['实时目录缩略预览', '贴边悬停展开目录', '按网站保存导航偏好'],
    cta: '阅读更快，定位更稳。',
    screenshotTitle: '把长网页变成实时目录',
    screenshotSubtitle: 'Edge Dock 会在阅读时同步显示当前章节。'
  }
};

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function ensureDirs() {
  await mkdir(ICON_SVG_DIR, { recursive: true });
  await mkdir(ICON_PNG_DIR, { recursive: true });
  await mkdir(BRAND_DIR, { recursive: true });
}

async function writeText(relativePath, content) {
  const target = path.join(ROOT, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content.trimStart() + '\n', 'utf8');
}

async function renderPng(svg, relativePath, width, height = width) {
  const target = path.join(ROOT, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const renderer = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Arial'
    }
  });
  const png = renderer.render().asPng();
  await writeFile(target, png);
}

function documentOutlineSvg(state = 'enabled') {
  const enabled = state === 'enabled';
  const color = enabled ? COLORS.enabledMark : COLORS.outlineGray;
  const pageFill = enabled ? COLORS.page : 'transparent';
  const foldFill = enabled ? '#f3f4f6' : 'transparent';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
  <title>Web TOC Assistant ${enabled ? 'enabled' : 'disabled'} icon</title>
  <g id="document-outline-icon">
    <path d="M33 14H78L105 41V108C105 113.523 100.523 118 95 118H33C27.477 118 23 113.523 23 108V24C23 18.477 27.477 14 33 14Z" fill="${pageFill}"/>
    <path d="M78 14V36C78 41.523 82.477 46 88 46H105L78 14Z" fill="${foldFill}"/>
    <path d="M33 14H78L105 41V108C105 113.523 100.523 118 95 118H33C27.477 118 23 113.523 23 108V24C23 18.477 27.477 14 33 14Z" stroke="${color}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M78 14V36C78 41.523 82.477 46 88 46H105" stroke="${color}" stroke-width="4" stroke-linejoin="round"/>
    <rect x="38" y="44" width="9" height="9" rx="2" fill="${color}"/>
    <rect x="38" y="65" width="9" height="9" rx="2" fill="${color}"/>
    <rect x="38" y="86" width="9" height="9" rx="2" fill="${color}"/>
    <path d="M58 48.5H88" stroke="${color}" stroke-width="7" stroke-linecap="round"/>
    <path d="M58 69.5H82" stroke="${color}" stroke-width="7" stroke-linecap="round"/>
    <path d="M58 90.5H88" stroke="${color}" stroke-width="7" stroke-linecap="round"/>
  </g>
</svg>`;
}

function standaloneMarkSvg(state) {
  return documentOutlineSvg(state).replace(
    '<svg width="128" height="128"',
    '<svg width="512" height="512"'
  );
}

function brandDefs() {
  return `
  <defs>
    <linearGradient id="brand-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8fafc"/>
      <stop offset="0.58" stop-color="#f3f4f6"/>
      <stop offset="1" stop-color="#e5e7eb"/>
    </linearGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f172a"/>
      <stop offset="1" stop-color="#1e293b"/>
    </linearGradient>
    <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#0f172a" flood-opacity="0.18"/>
    </filter>
  </defs>`;
}

function iconUse(x, y, size) {
  const scale = size / 128;
  return `<g transform="translate(${x} ${y}) scale(${scale})">${documentOutlineSvg('enabled')
    .replace(/^[\s\S]*?<g id="document-outline-icon">/, '<g id="document-outline-icon">')
    .replace(/<\/svg>\s*$/, '')}</g>`;
}

function tocPreviewMock(x, y, scale = 1) {
  const line = (dy, width, inset = 0, active = false) =>
    `<rect x="${x + inset * scale}" y="${y + dy * scale}" width="${width * scale}" height="${4 * scale}" rx="${2 * scale}" fill="${active ? COLORS.enabledMark : COLORS.outlineGray}" opacity="${active ? 1 : 0.74}"/>`;
  return `
    <g>
      <rect x="${x - 10 * scale}" y="${y - 18 * scale}" width="${54 * scale}" height="${188 * scale}" rx="${24 * scale}" fill="#ffffff" stroke="${COLORS.border}" filter="url(#soft-shadow)"/>
      <circle cx="${x + 17 * scale}" cy="${y + 7 * scale}" r="${13 * scale}" fill="#ffffff" stroke="${COLORS.border}"/>
      ${line(48, 30, 0)}
      ${line(68, 22, 6)}
      ${line(88, 34, 0, true)}
      ${line(108, 18, 11)}
      ${line(128, 27, 4)}
      ${line(148, 21, 9)}
    </g>`;
}

function promoSvg(locale, width, height) {
  const copy = COPY[locale];
  const isWide = width > 800;
  const nameSize = isWide ? 74 : 31;
  const taglineSize = isWide ? 34 : 16;
  const xText = isWide ? 104 : 34;
  const iconSize = isWide ? 164 : 86;
  const iconX = isWide ? width - 298 : width - 130;
  const iconY = isWide ? 86 : 40;
  const dockX = isWide ? width - 162 : width - 72;
  const dockY = isWide ? 280 : 143;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  ${brandDefs()}
  <rect width="${width}" height="${height}" fill="url(#brand-bg)"/>
  <rect x="${isWide ? 72 : 22}" y="${isWide ? 54 : 22}" width="${isWide ? width - 144 : width - 44}" height="${isWide ? height - 108 : height - 44}" rx="${isWide ? 38 : 22}" fill="#ffffff" opacity="0.74" stroke="${COLORS.border}"/>
  <text x="${xText}" y="${isWide ? 132 : 59}" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="${isWide ? 22 : 12}" font-weight="700" fill="${COLORS.enabledMark}" letter-spacing="0.5">${esc(copy.eyebrow)}</text>
  <text x="${xText}" y="${isWide ? 214 : 96}" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="${nameSize}" font-weight="800" fill="${COLORS.text}">${esc(copy.name)}</text>
  <text x="${xText}" y="${isWide ? 270 : 124}" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="${taglineSize}" font-weight="500" fill="${COLORS.muted}">${esc(copy.tagline)}</text>
  ${copy.bullets.map((item, index) => {
    const y = (isWide ? 342 : 166) + index * (isWide ? 42 : 24);
    return `<circle cx="${xText + 7}" cy="${y - 7}" r="${isWide ? 5 : 3.5}" fill="${COLORS.enabledMark}"/>
  <text x="${xText + (isWide ? 24 : 17)}" y="${y}" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="${isWide ? 24 : 13}" font-weight="600" fill="${COLORS.text}">${esc(item)}</text>`;
  }).join('\n  ')}
  <rect x="${xText}" y="${isWide ? 464 : 230}" width="${isWide ? 438 : 200}" height="${isWide ? 54 : 28}" rx="${isWide ? 27 : 14}" fill="${COLORS.appInk}"/>
  <text x="${xText + (isWide ? 28 : 16)}" y="${isWide ? 500 : 249}" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="${isWide ? 22 : 12}" font-weight="700" fill="#ffffff">${esc(copy.cta)}</text>
  ${iconUse(iconX, iconY, iconSize)}
  ${tocPreviewMock(dockX, dockY, isWide ? 1.18 : 0.54)}
</svg>`;
}

function screenshotSvg(locale) {
  const copy = COPY[locale];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1280" height="800" viewBox="0 0 1280 800" fill="none" xmlns="http://www.w3.org/2000/svg">
  ${brandDefs()}
  <rect width="1280" height="800" fill="url(#brand-bg)"/>
  <rect x="84" y="70" width="988" height="640" rx="28" fill="#ffffff" stroke="${COLORS.border}" filter="url(#soft-shadow)"/>
  <rect x="84" y="70" width="988" height="58" rx="28" fill="#f8fafc"/>
  <circle cx="124" cy="99" r="8" fill="#ef4444"/>
  <circle cx="151" cy="99" r="8" fill="#f59e0b"/>
  <circle cx="178" cy="99" r="8" fill="#22c55e"/>
  <rect x="220" y="88" width="420" height="22" rx="11" fill="#e5e7eb"/>
  <text x="132" y="191" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="38" font-weight="800" fill="${COLORS.text}">${esc(copy.screenshotTitle)}</text>
  <text x="132" y="236" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="22" font-weight="500" fill="${COLORS.muted}">${esc(copy.screenshotSubtitle)}</text>
  ${[0, 1, 2, 3, 4, 5].map((row) => {
    const y = 306 + row * 58;
    const w = [680, 530, 610, 470, 590, 420][row];
    const x = 132 + (row % 3) * 28;
    const color = row === 2 ? COLORS.enabledMark : COLORS.outlineGray;
    return `<rect x="${x}" y="${y}" width="${w}" height="15" rx="7.5" fill="${color}" opacity="${row === 2 ? 1 : 0.32}"/>
  <rect x="${x}" y="${y + 27}" width="${Math.max(280, w - 160)}" height="11" rx="5.5" fill="${COLORS.outlineGray}" opacity="0.18"/>`;
  }).join('\n  ')}
  <g transform="translate(1074 188)">
    <rect x="0" y="0" width="64" height="64" rx="32" fill="#ffffff" stroke="${COLORS.border}" filter="url(#soft-shadow)"/>
    <g transform="translate(11 10) scale(0.33)">${documentOutlineSvg('enabled')
      .replace(/^[\s\S]*?<g id="document-outline-icon">/, '<g id="document-outline-icon">')
      .replace(/<\/svg>\s*$/, '')}</g>
    ${tocPreviewMock(18, 102, 0.86)}
  </g>
  <rect x="886" y="318" width="268" height="232" rx="22" fill="#ffffff" stroke="${COLORS.border}" filter="url(#soft-shadow)"/>
  <text x="918" y="366" font-family="Arial, PingFang SC, Microsoft YaHei, sans-serif" font-size="22" font-weight="800" fill="${COLORS.text}">Edge Dock</text>
  <rect x="918" y="396" width="176" height="9" rx="4.5" fill="${COLORS.enabledMark}"/>
  <rect x="918" y="425" width="198" height="9" rx="4.5" fill="${COLORS.outlineGray}" opacity="0.36"/>
  <rect x="938" y="456" width="150" height="9" rx="4.5" fill="${COLORS.outlineGray}" opacity="0.36"/>
  <rect x="918" y="487" width="212" height="9" rx="4.5" fill="${COLORS.outlineGray}" opacity="0.36"/>
  <rect x="958" y="518" width="136" height="9" rx="4.5" fill="${COLORS.outlineGray}" opacity="0.36"/>
  ${iconUse(90, 594, 86)}
</svg>`;
}

async function generate() {
  await ensureDirs();

  const enabledSvg = documentOutlineSvg('enabled');
  const disabledSvg = documentOutlineSvg('disabled');
  await writeText('icons/svg/toc-enabled.svg', enabledSvg);
  await writeText('icons/svg/toc-disabled.svg', disabledSvg);

  for (const size of ICON_SIZES) {
    await renderPng(enabledSvg, `icons/png/toc-enabled-${size}.png`, size);
    await renderPng(disabledSvg, `icons/png/toc-disabled-${size}.png`, size);
  }

  await writeText('docs/brand/web-toc-assistant-mark-enabled.svg', standaloneMarkSvg('enabled'));
  await writeText('docs/brand/web-toc-assistant-mark-disabled.svg', standaloneMarkSvg('disabled'));

  await renderPng(promoSvg('en', 440, 280), 'docs/brand/chrome-web-store-small-promo-en.png', 440, 280);
  await renderPng(promoSvg('zh', 440, 280), 'docs/brand/chrome-web-store-small-promo-zh-CN.png', 440, 280);
  await renderPng(promoSvg('en', 1400, 560), 'docs/brand/chrome-web-store-marquee-en.png', 1400, 560);
  await renderPng(promoSvg('zh', 1400, 560), 'docs/brand/chrome-web-store-marquee-zh-CN.png', 1400, 560);
  await renderPng(screenshotSvg('en'), 'docs/brand/store-screenshot-cover-en.png', 1280, 800);
  await renderPng(screenshotSvg('zh'), 'docs/brand/store-screenshot-cover-zh-CN.png', 1280, 800);

  await writeText('docs/brand/README.md', `# Web TOC Assistant Brand Assets

Generated with \`npm run assets:brand\`.

## Icon System

- Direction: transparent document outline mark that mirrors the Edge Dock collapsed bars.
- Enabled state: white document fill with \`${COLORS.enabledMark}\` foreground.
- Disabled state: transparent document fill with \`${COLORS.outlineGray}\` foreground.
- The mark shape stays identical across states; state is communicated by the document fill and foreground tone.

## Files

- \`web-toc-assistant-mark-enabled.svg\` and \`web-toc-assistant-mark-disabled.svg\`: master brand marks.
- \`chrome-web-store-small-promo-en.png\` and \`chrome-web-store-small-promo-zh-CN.png\`: 440x280 small promotional tiles.
- \`chrome-web-store-marquee-en.png\` and \`chrome-web-store-marquee-zh-CN.png\`: 1400x560 marquee tiles.
- \`store-screenshot-cover-en.png\` and \`store-screenshot-cover-zh-CN.png\`: 1280x800 bilingual screenshot cover images.
- \`docs/descriptions/ChatGPT_Desc_screenshots1280x800_EN_1.x.png\` and \`docs/descriptions/ChatGPT_Desc_screenshots1280x800_CN_1.x.png\`: GPT image generated 1.x description screenshots, kept outside the deterministic generator so reruns do not overwrite them.

The extension runtime icon paths in \`manifest.json\` remain unchanged; regenerated PNGs are written to \`icons/png/toc-*-{16,32,48,128}.png\`.
`);
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
