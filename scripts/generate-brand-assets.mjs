#!/usr/bin/env node

import { Resvg } from '@resvg/resvg-js';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICON_SVG_DIR = path.join(ROOT, 'icons', 'svg');
const ICON_PNG_DIR = path.join(ROOT, 'icons', 'png');
const PUBLIC_ICON_DIR = path.join(ROOT, 'public/icons');
const BRAND_DIR = path.join(ROOT, 'docs', 'brand');
const ICON_SIZES = [16, 32, 48, 128];

// ── Design tokens ─────────────────────────────────────────────────────────
const C = {
  indigo800: '#3730A3', indigo700: '#4338CA', indigo600: '#4F46E5',
  indigo500: '#6366F1', indigo400: '#818CF8',
  indigo100: '#E0E7FF', indigo50: '#EEF2FF',
  emerald500: '#10B981', amber500: '#F59E0B', red500: '#EF4444',
  gray900: '#111827', gray700: '#374151', gray500: '#6B7280',
  gray400: '#9CA3AF', gray300: '#D1D5DB', gray200: '#E5E7EB',
  gray100: '#F3F4F6', gray50: '#F9FAFB', white: '#FFFFFF',
  enabledMark: '#202124', outlineGray: '#737373',
};

const COPY = {
  en: {
    name: 'Web TOC Assistant',
    tagline: 'Interactive outlines for long webpages',
    version: 'Version 1.0',
    bullets: [
      { text: 'Live outline preview', color: C.indigo500 },
      { text: 'Hover-to-expand Edge Dock', color: C.emerald500 },
      { text: 'Per-site navigation settings', color: C.amber500 },
      { text: 'Privacy-first, no server calls', color: C.red500 },
    ],
    cta: 'Read faster. Navigate cleaner.',
    screenshotTitle: 'Turn long pages into a live outline',
    screenshotSubtitle: 'Edge Dock keeps the current section visible while you read.',
    features: [
      { title: 'Smart Detection', desc: 'Auto-extract headings from any page', icon: 'scan', color: C.indigo500 },
      { title: 'Edge Dock', desc: 'Floating sidebar with live preview', icon: 'dock', color: C.emerald500 },
      { title: 'Per-site Config', desc: 'Customize selectors per website', icon: 'config', color: C.amber500 },
      { title: 'Privacy First', desc: 'No data sent to external servers', icon: 'shield', color: C.red500 },
    ],
  },
  zh: {
    name: '网页目录助手',
    tagline: '为长网页生成可交互目录',
    version: '1.0 正式版',
    bullets: [
      { text: '实时目录缩略预览', color: C.indigo500 },
      { text: '贴边悬停展开目录', color: C.emerald500 },
      { text: '按网站保存导航偏好', color: C.amber500 },
      { text: '隐私优先，无外部请求', color: C.red500 },
    ],
    cta: '阅读更快，定位更稳。',
    screenshotTitle: '把长网页变成实时目录',
    screenshotSubtitle: 'Edge Dock 会在阅读时同步显示当前章节。',
    features: [
      { title: '智能检测', desc: '自动提取页面标题结构', icon: 'scan', color: C.indigo500 },
      { title: 'Edge Dock', desc: '浮动侧边栏实时预览', icon: 'dock', color: C.emerald500 },
      { title: '按站配置', desc: '自定义每个网站的目录规则', icon: 'config', color: C.amber500 },
      { title: '隐私优先', desc: '不向外部服务器发送数据', icon: 'shield', color: C.red500 },
    ],
  },
};

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function ensureDirs() {
  for (const d of [ICON_SVG_DIR, ICON_PNG_DIR, path.join(PUBLIC_ICON_DIR, 'svg'), path.join(PUBLIC_ICON_DIR, 'png'), BRAND_DIR])
    await mkdir(d, { recursive: true });
}

async function writeText(rel, content) {
  const t = path.join(ROOT, rel);
  await mkdir(path.dirname(t), { recursive: true });
  await writeFile(t, content.trimStart() + '\n', 'utf8');
}

async function renderPng(svg, rel, width) {
  const t = path.join(ROOT, rel);
  await mkdir(path.dirname(t), { recursive: true });
  const renderer = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: 'Inter, Arial, sans-serif' },
  });
  await writeFile(t, renderer.render().asPng());
}

async function syncRuntimeIconsToPublic() {
  await cp(ICON_SVG_DIR, path.join(PUBLIC_ICON_DIR, 'svg'), { recursive: true, force: true });
  await cp(ICON_PNG_DIR, path.join(PUBLIC_ICON_DIR, 'png'), { recursive: true, force: true });
}

// ── SVG building blocks ──────────────────────────────────────────────────
function documentOutlineSvg(state = 'enabled') {
  const enabled = state === 'enabled';
  const color = enabled ? C.enabledMark : C.outlineGray;
  const pageFill = enabled ? C.white : 'transparent';
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
  return documentOutlineSvg(state).replace('<svg width="128" height="128"', '<svg width="512" height="512"');
}

function indigoIconAt(x, y, size) {
  const scale = size / 128;
  const svg = documentOutlineSvg('enabled')
    .replace(/^[\s\S]*?<g id="document-outline-icon">/, '<g id="document-outline-icon">')
    .replace(/<\/svg>\s*$/, '')
    .replace(/#202124/g, C.indigo600)
    .replace(/#ffffff/g, C.white);
  return `<g transform="translate(${x} ${y}) scale(${scale})">${svg}</g>`;
}

function brandDefs() {
  return `<defs>
    <linearGradient id="saturated-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.indigo700}"/>
      <stop offset="100%" stop-color="${C.indigo500}"/>
    </linearGradient>
    <linearGradient id="light-bg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#F5F3FF"/>
      <stop offset="100%" stop-color="${C.indigo50}"/>
    </linearGradient>
    <linearGradient id="indigo-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.indigo400}"/>
      <stop offset="100%" stop-color="${C.indigo600}"/>
    </linearGradient>
    <filter id="card-shadow" x="-8%" y="-8%" width="116%" height="124%">
      <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#000" flood-opacity="0.15"/>
    </filter>
    <filter id="soft-shadow" x="-8%" y="-8%" width="116%" height="124%">
      <feDropShadow dx="0" dy="6" stdDeviation="14" flood-color="#000" flood-opacity="0.20"/>
    </filter>
    <filter id="icon-shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="2" stdDeviation="8" flood-color="#000" flood-opacity="0.25"/>
    </filter>
  </defs>`;
}

/** Mini TOC lines block */
function tocLines(x, y, s) {
  const ln = (dy, w, indent, active) => {
    const bg = active ? C.indigo500 : C.gray300;
    const op = active ? 1 : 0.6;
    return `<rect x="${x + indent * s}" y="${y + dy * s}" width="${w * s}" height="${(active ? 5 : 4) * s}" rx="${2.5 * s}" fill="${bg}" opacity="${op}"/>`;
  };
  return [ln(0, 36, 0, false), ln(10, 28, 7, false), ln(20, 40, 0, true), ln(30, 22, 11, false), ln(40, 32, 4, false), ln(50, 24, 9, false), ln(60, 30, 0, false), ln(70, 20, 7, false)].join('\n    ');
}

/** Mini TOC lines block (white, for dark/saturated backgrounds) */
function whiteTocLines(x, y, s) {
  const ln = (dy, w, indent, active) => {
    const op = active ? 0.9 : 0.2;
    return `<rect x="${x + indent * s}" y="${y + dy * s}" width="${w * s}" height="${(active ? 5 : 4) * s}" rx="${2.5 * s}" fill="white" opacity="${op}"/>`;
  };
  return [ln(0, 36, 0, false), ln(10, 28, 7, false), ln(20, 40, 0, true), ln(30, 22, 11, false), ln(40, 32, 4, false), ln(50, 24, 9, false), ln(60, 30, 0, false), ln(70, 20, 7, false)].join('\n    ');
}

/** Feature icon mini-shapes */
function featureIcon(type, x, y, color, s = 1) {
  const g = [];
  if (type === 'scan') {
    // magnifying glass
    g.push(`<circle cx="${x + 10 * s}" cy="${y + 10 * s}" r="${7 * s}" fill="none" stroke="${color}" stroke-width="${2 * s}"/>`);
    g.push(`<line x1="${x + 15 * s}" y1="${y + 15 * s}" x2="${x + 20 * s}" y2="${y + 20 * s}" stroke="${color}" stroke-width="${2 * s}" stroke-linecap="round"/>`);
  } else if (type === 'dock') {
    // sidebar/dock
    g.push(`<rect x="${x + 2 * s}" y="${y + 2 * s}" width="${16 * s}" height="${18 * s}" rx="${2 * s}" fill="none" stroke="${color}" stroke-width="${1.5 * s}"/>`);
    g.push(`<line x1="${x + 7 * s}" y1="${y + 2 * s}" x2="${x + 7 * s}" y2="${y + 20 * s}" stroke="${color}" stroke-width="${1.5 * s}"/>`);
    g.push(`<rect x="${x + 9 * s}" y="${y + 6 * s}" width="${6 * s}" height="${2 * s}" rx="${1 * s}" fill="${color}"/>`);
    g.push(`<rect x="${x + 9 * s}" y="${y + 10 * s}" width="${5 * s}" height="${2 * s}" rx="${1 * s}" fill="${color}" opacity="0.5"/>`);
    g.push(`<rect x="${x + 9 * s}" y="${y + 14 * s}" width="${6 * s}" height="${2 * s}" rx="${1 * s}" fill="${color}" opacity="0.5"/>`);
  } else if (type === 'config') {
    // gear
    g.push(`<circle cx="${x + 10 * s}" cy="${y + 10 * s}" r="${4 * s}" fill="none" stroke="${color}" stroke-width="${2 * s}"/>`);
    g.push(`<circle cx="${x + 10 * s}" cy="${y + 10 * s}" r="${8 * s}" fill="none" stroke="${color}" stroke-width="${1.5 * s}" stroke-dasharray="${4 * s} ${3 * s}"/>`);
  } else if (type === 'shield') {
    // shield
    g.push(`<path d="M${x + 10 * s} ${y + 2 * s}L${x + 18 * s} ${y + 6 * s}L${x + 18 * s} ${y + 13 * s}Q${x + 18 * s} ${y + 19 * s} ${x + 10 * s} ${y + 21 * s}Q${x + 2 * s} ${y + 19 * s} ${x + 2 * s} ${y + 13 * s}L${x + 2 * s} ${y + 6 * s}Z" fill="none" stroke="${color}" stroke-width="${1.5 * s}"/>`);
    g.push(`<path d="M${x + 7 * s} ${y + 11 * s}L${x + 9.5 * s} ${y + 14 * s}L${x + 14 * s} ${y + 8 * s}" fill="none" stroke="${color}" stroke-width="${1.5 * s}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  return g.join('\n    ');
}

// ── Small promo (440×280) — saturated, full-bleed, minimal text ───────────
function smallPromoSvg(locale) {
  const copy = COPY[locale];
  const W = 440, H = 280;
  const ff = 'Inter, Arial, PingFang SC, Microsoft YaHei, sans-serif';

  // Large centered icon on white rounded square
  const iconBox = 90;
  const iconBoxX = (W - iconBox) / 2;
  const iconBoxY = 38;
  const iconSize = 66;
  const iconPad = (iconBox - iconSize) / 2;

  const nameY = iconBoxY + iconBox + 32;
  const taglineY = nameY + 24;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg">
  ${brandDefs()}
  <!-- Full-bleed saturated background — no padding, no cards -->
  <rect width="${W}" height="${H}" fill="url(#saturated-bg)"/>
  <!-- Decorative background: subtle white TOC lines at very low opacity -->
  <g opacity="0.07">
    ${whiteTocLines(18, 12, 0.75)}
    ${whiteTocLines(310, 30, 0.6)}
    ${whiteTocLines(50, 185, 0.5)}
    ${whiteTocLines(330, 210, 0.65)}
  </g>
  <!-- Icon on white rounded square -->
  <rect x="${iconBoxX}" y="${iconBoxY}" width="${iconBox}" height="${iconBox}" rx="22" fill="${C.white}" filter="url(#icon-shadow)"/>
  ${indigoIconAt(iconBoxX + iconPad, iconBoxY + iconPad, iconSize)}
  <!-- App name -->
  <text x="${W / 2}" y="${nameY}" font-family="${ff}" font-size="24" font-weight="800" fill="${C.white}" text-anchor="middle">${esc(copy.name)}</text>
  <!-- Tagline -->
  <text x="${W / 2}" y="${taglineY}" font-family="${ff}" font-size="13" font-weight="500" fill="white" opacity="0.7" text-anchor="middle">${esc(copy.tagline)}</text>
</svg>`;
}

// ── Marquee (1400×560) — saturated brand + product demo ───────────────────
function marqueeSvg(locale) {
  const copy = COPY[locale];
  const W = 1400, H = 560;
  const ff = 'Inter, Arial, PingFang SC, Microsoft YaHei, sans-serif';

  // Left section: branding on saturated bg (0 ~ 520)
  // Right section: browser mockup card (540 ~ 1380)
  const cardX = 540, cardY = 30, cardW = 840, cardH = 500;
  const chromeH = 32;

  // Dock panel inside browser card
  const dockW = 200;
  const dockX = cardX + cardW - dockW - 16;
  const dockY = cardY + chromeH + 12;
  const dockH = cardH - chromeH - 36;

  // Page content area inside browser card
  const pageX = cardX + 20;
  const pageRight = dockX - 12;
  const pageW = pageRight - pageX;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg">
  ${brandDefs()}
  <!-- Full-bleed saturated background -->
  <rect width="${W}" height="${H}" fill="url(#saturated-bg)"/>

  <!-- ═══ Left: Branding ═══ -->
  <rect x="50" y="90" width="88" height="88" rx="20" fill="white" filter="url(#icon-shadow)"/>
  ${indigoIconAt(59, 99, 70)}
  <!-- Name -->
  <text x="50" y="224" font-family="${ff}" font-size="38" font-weight="800" fill="white">${esc(copy.name)}</text>
  <!-- Tagline -->
  <text x="50" y="260" font-family="${ff}" font-size="15" font-weight="500" fill="white" opacity="0.7">${esc(copy.tagline)}</text>
  <!-- Feature bullets -->
  ${copy.bullets.map((b, i) => {
    const by = 300 + i * 28;
    return `<circle cx="54" cy="${by - 4}" r="4" fill="${b.color}"/>
    <text x="66" y="${by}" font-family="${ff}" font-size="13" font-weight="600" fill="white" opacity="0.85">${esc(b.text)}</text>`;
  }).join('\n  ')}

  <!-- ═══ Right: Browser mockup card ═══ -->
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="14" fill="${C.white}" filter="url(#soft-shadow)"/>
  <!-- Chrome bar -->
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${chromeH}" rx="14" fill="${C.gray50}"/>
  <rect x="${cardX}" y="${cardY + 14}" width="${cardW}" height="${chromeH - 14}" fill="${C.gray50}"/>
  <circle cx="${cardX + 16}" cy="${cardY + 12}" r="4.5" fill="#EF4444" opacity="0.7"/>
  <circle cx="${cardX + 30}" cy="${cardY + 12}" r="4.5" fill="#F59E0B" opacity="0.7"/>
  <circle cx="${cardX + 44}" cy="${cardY + 12}" r="4.5" fill="#10B981" opacity="0.7"/>
  <rect x="${cardX + 62}" y="${cardY + 4}" width="320" height="16" rx="8" fill="${C.gray200}" opacity="0.6"/>

  <!-- Page content: headings + body lines -->
  ${(() => {
    const items = [];
    const headingData = [
      { w: 0.50, sub: [0.62, 0.55, 0.45] },
      { w: 0.45, sub: [0.58, 0.50] },
      { w: 0.52, sub: [0.65, 0.52, 0.40] },
      { w: 0.40, sub: [0.55, 0.48] },
      { w: 0.48, sub: [0.60, 0.42, 0.35] },
      { w: 0.44, sub: [0.58, 0.46] },
    ];
    let y = cardY + chromeH + 20;
    for (let hi = 0; hi < headingData.length; hi++) {
      const hd = headingData[hi];
      const isActive = hi === 2;
      const hw = Math.round(pageW * hd.w);
      items.push(`<rect x="${pageX}" y="${y}" width="${hw}" height="11" rx="5.5" fill="${isActive ? C.indigo500 : C.gray700}" opacity="${isActive ? 0.7 : 0.4}"/>`);
      y += 18;
      for (const sw of hd.sub) {
        const bw = Math.round(pageW * sw);
        items.push(`<rect x="${pageX + 12}" y="${y}" width="${bw}" height="6" rx="3" fill="${C.gray400}" opacity="0.25"/>`);
        y += 12;
      }
      y += 10;
    }
    return items.join('\n  ');
  })()}

  <!-- Edge Dock panel -->
  <rect x="${dockX}" y="${dockY}" width="${dockW}" height="${dockH}" rx="10" fill="${C.white}" stroke="${C.indigo100}" stroke-width="0.8" filter="url(#card-shadow)"/>
  <!-- Dock header -->
  <rect x="${dockX}" y="${dockY}" width="${dockW}" height="28" rx="10" fill="${C.indigo50}"/>
  <rect x="${dockX}" y="${dockY + 16}" width="${dockW}" height="12" fill="${C.indigo50}"/>
  <rect x="${dockX + 8}" y="${dockY + 4}" width="16" height="16" rx="4" fill="${C.indigo100}"/>
  <rect x="${dockX + 11}" y="${dockY + 7}" width="3" height="3" rx="0.5" fill="${C.indigo600}"/>
  <rect x="${dockX + 16}" y="${dockY + 7}" width="5" height="2" rx="1" fill="${C.indigo600}"/>
  <rect x="${dockX + 11}" y="${dockY + 12}" width="3" height="3" rx="0.5" fill="${C.indigo600}"/>
  <rect x="${dockX + 16}" y="${dockY + 12}" width="4" height="2" rx="1" fill="${C.indigo600}"/>
  <text x="${dockX + 30}" y="${dockY + 18}" font-family="${ff}" font-size="10" font-weight="700" fill="${C.indigo600}">Outline</text>

  <!-- Dock TOC items -->
  ${[
    { indent: 0, active: false },
    { indent: 1, active: false },
    { indent: 0, active: false },
    { indent: 1, active: false },
    { indent: 0, active: true },
    { indent: 1, active: false },
    { indent: 2, active: false },
    { indent: 0, active: false },
    { indent: 1, active: false },
    { indent: 0, active: false },
    { indent: 1, active: false },
  ].map((item, i) => {
    const iy = dockY + 40 + i * 34;
    const ix = dockX + 12 + item.indent * 14;
    const maxW = dockW - 28 - item.indent * 14;
    const w = item.active ? maxW : maxW * (0.6 + (i % 3) * 0.1);
    const h = item.active ? 8 : 5;
    const fill = item.active ? C.indigo500 : C.gray400;
    const op = item.active ? 1 : 0.4;
    const bg = item.active ? `<rect x="${dockX + 4}" y="${iy - 6}" width="${dockW - 8}" height="24" rx="4" fill="${C.indigo50}"/>` : '';
    return `${bg}<rect x="${ix}" y="${iy}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" opacity="${op}"/>`;
  }).join('\n  ')}
</svg>`;
}

// ── Screenshot cover (1280×800) — full browser mockup ─────────────────────
function screenshotCoverSvg(locale) {
  const copy = COPY[locale];
  const W = 1280, H = 800;
  const P = 20;
  const ff = 'Inter, Arial, PingFang SC, Microsoft YaHei, sans-serif';
  const chromeH = 38;
  const contentTop = P + chromeH;

  // Dock panel dimensions
  const dockW = 220, dockH = 620;
  const dockX = W - P - dockW - 10;
  const dockY = contentTop + 12;

  // Page content area (left of dock)
  const pageX = P + 30;
  const pageRight = dockX - 16;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg">
  ${brandDefs()}
  <!-- Light indigo-tinted background -->
  <rect width="${W}" height="${H}" fill="url(#light-bg)"/>

  <!-- Browser window -->
  <rect x="${P}" y="${P}" width="${W - P * 2}" height="${H - P * 2}" rx="14" fill="${C.white}" filter="url(#soft-shadow)"/>
  <!-- Chrome bar — indigo tinted -->
  <rect x="${P}" y="${P}" width="${W - P * 2}" height="${chromeH}" rx="14" fill="${C.indigo50}"/>
  <rect x="${P}" y="${P + 14}" width="${W - P * 2}" height="${chromeH - 14}" fill="${C.indigo50}"/>
  <circle cx="${P + 20}" cy="${P + 12}" r="5.5" fill="#EF4444" opacity="0.8"/>
  <circle cx="${P + 38}" cy="${P + 12}" r="5.5" fill="#F59E0B" opacity="0.8"/>
  <circle cx="${P + 56}" cy="${P + 12}" r="5.5" fill="#10B981" opacity="0.8"/>
  <rect x="${P + 80}" y="${P + 3}" width="380" height="18" rx="9" fill="${C.indigo100}" opacity="0.5"/>
  <!-- Extension icon in chrome -->
  <rect x="${W - P - 40}" y="${P + 3}" width="18" height="18" rx="4" fill="${C.indigo100}"/>
  <rect x="${W - P - 38}" y="${P + 7}" width="3" height="3" rx="0.5" fill="${C.indigo600}"/>
  <rect x="${W - P - 33}" y="${P + 7}" width="7" height="2" rx="1" fill="${C.indigo600}"/>
  <rect x="${W - P - 38}" y="${P + 12}" width="3" height="3" rx="0.5" fill="${C.indigo600}"/>
  <rect x="${W - P - 33}" y="${P + 12}" width="5" height="2" rx="1" fill="${C.indigo600}"/>

  <!-- Page content: title + subtitle -->
  <text x="${pageX}" y="${contentTop + 42}" font-family="${ff}" font-size="28" font-weight="800" fill="${C.gray900}">${esc(copy.screenshotTitle)}</text>
  <text x="${pageX}" y="${contentTop + 64}" font-family="${ff}" font-size="14" font-weight="500" fill="${C.gray500}">${esc(copy.screenshotSubtitle)}</text>
  <!-- Separator -->
  <rect x="${pageX}" y="${contentTop + 76}" width="${pageRight - pageX}" height="1" fill="${C.gray200}"/>

  <!-- Dense simulated page content — headings + body paragraph blocks -->
  ${(() => {
    const items = [];
    const headingData = [
      { w: 0.48, sub: [0.62, 0.55, 0.45] },
      { w: 0.42, sub: [0.58, 0.50] },
      { w: 0.50, sub: [0.65, 0.52, 0.40] },
      { w: 0.38, sub: [0.55, 0.48] },
      { w: 0.46, sub: [0.60, 0.42] },
      { w: 0.44, sub: [0.58, 0.50, 0.38] },
      { w: 0.40, sub: [0.52, 0.46] },
      { w: 0.48, sub: [0.60, 0.42, 0.35] },
    ];
    let y = contentTop + 94;
    for (let hi = 0; hi < headingData.length; hi++) {
      const hd = headingData[hi];
      const isActive = hi === 2;
      const hw = Math.round((pageRight - pageX) * hd.w);
      items.push(`<rect x="${pageX}" y="${y}" width="${hw}" height="12" rx="6" fill="${isActive ? C.indigo500 : C.gray700}" opacity="${isActive ? 0.6 : 0.45}"/>`);
      y += 20;
      for (const sw of hd.sub) {
        const bw = Math.round((pageRight - pageX) * sw);
        items.push(`<rect x="${pageX + 14}" y="${y}" width="${bw}" height="7" rx="3.5" fill="${C.gray400}" opacity="0.28"/>`);
        y += 14;
      }
      y += 10;
    }
    return items.join('\n  ');
  })()}

  <!-- Edge Dock panel -->
  <rect x="${dockX}" y="${dockY}" width="${dockW}" height="${dockH}" rx="12" fill="${C.white}" stroke="${C.indigo100}" stroke-width="1" filter="url(#card-shadow)"/>
  <!-- Dock header -->
  <rect x="${dockX}" y="${dockY}" width="${dockW}" height="32" rx="12" fill="${C.indigo50}"/>
  <rect x="${dockX}" y="${dockY + 20}" width="${dockW}" height="12" fill="${C.indigo50}"/>
  <rect x="${dockX + 10}" y="${dockY + 6}" width="18" height="18" rx="5" fill="${C.indigo100}"/>
  <rect x="${dockX + 14}" y="${dockY + 10}" width="3" height="3" rx="0.5" fill="${C.indigo600}"/>
  <rect x="${dockX + 19}" y="${dockY + 10}" width="6" height="2" rx="1" fill="${C.indigo600}"/>
  <rect x="${dockX + 14}" y="${dockY + 16}" width="3" height="3" rx="0.5" fill="${C.indigo600}"/>
  <rect x="${dockX + 19}" y="${dockY + 16}" width="4" height="2" rx="1" fill="${C.indigo600}"/>
  <text x="${dockX + 34}" y="${dockY + 20}" font-family="${ff}" font-size="11" font-weight="700" fill="${C.indigo600}">Outline</text>
  <!-- Search icon -->
  <circle cx="${dockX + dockW - 22}" cy="${dockY + 15}" r="6" fill="none" stroke="${C.gray400}" stroke-width="1.2"/>
  <line x1="${dockX + dockW - 18}" y1="${dockY + 19}" x2="${dockX + dockW - 14}" y2="${dockY + 23}" stroke="${C.gray400}" stroke-width="1.2" stroke-linecap="round"/>

  <!-- TOC items in dock — dense list -->
  ${[
    { indent: 0, active: false },
    { indent: 1, active: false },
    { indent: 0, active: true },
    { indent: 1, active: false },
    { indent: 2, active: false },
    { indent: 1, active: false },
    { indent: 0, active: false },
    { indent: 1, active: false },
    { indent: 0, active: false },
    { indent: 1, active: false },
    { indent: 1, active: false },
    { indent: 0, active: false },
    { indent: 1, active: false },
    { indent: 0, active: false },
  ].map((item, i) => {
    const iy = dockY + 44 + i * 40;
    const ix = dockX + 14 + item.indent * 14;
    const activeW = dockW - 36 - item.indent * 14;
    const inactiveW = activeW * (0.7 + (i % 3) * 0.1);
    const w = item.active ? activeW : inactiveW;
    const h = item.active ? 10 : 6;
    const fill = item.active ? C.indigo500 : C.gray400;
    const op = item.active ? 1 : 0.45;
    const bg = item.active ? `<rect x="${dockX + 4}" y="${iy - 5}" width="${dockW - 8}" height="30" rx="5" fill="${C.indigo50}"/>` : '';
    return `${bg}<rect x="${ix}" y="${iy}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" opacity="${op}"/>`;
  }).join('\n    ')}

  <!-- Dock footer: item count -->
  <text x="${dockX + dockW / 2}" y="${dockY + dockH - 10}" font-family="${ff}" font-size="9" font-weight="500" fill="${C.gray400}" text-anchor="middle">14 items</text>

  <!-- Brand icon + tagline at bottom -->
  <rect x="${P + 14}" y="${H - P - 34}" width="28" height="28" rx="7" fill="${C.indigo50}"/>
  ${indigoIconAt(P + 17, H - P - 31, 22)}
  <text x="${P + 48}" y="${H - P - 16}" font-family="${ff}" font-size="11" font-weight="600" fill="${C.gray500}">${esc(copy.name)} — ${esc(copy.tagline)}</text>
</svg>`;
}

// ── Main ──────────────────────────────────────────────────────────────────
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
  await syncRuntimeIconsToPublic();

  await writeText('docs/brand/web-toc-assistant-mark-enabled.svg', standaloneMarkSvg('enabled'));
  await writeText('docs/brand/web-toc-assistant-mark-disabled.svg', standaloneMarkSvg('disabled'));

  console.log('Generating small promo tiles (440×280)...');
  await renderPng(smallPromoSvg('en'), 'docs/brand/chrome-web-store-small-promo-en.png', 440);
  await renderPng(smallPromoSvg('zh'), 'docs/brand/chrome-web-store-small-promo-zh-CN.png', 440);

  console.log('Generating marquee tiles (1400×560)...');
  await renderPng(marqueeSvg('en'), 'docs/brand/chrome-web-store-marquee-en.png', 1400);
  await renderPng(marqueeSvg('zh'), 'docs/brand/chrome-web-store-marquee-zh-CN.png', 1400);

  console.log('Generating screenshot covers (1280×800)...');
  await renderPng(screenshotCoverSvg('en'), 'docs/brand/store-screenshot-cover-en.png', 1280);
  await renderPng(screenshotCoverSvg('zh'), 'docs/brand/store-screenshot-cover-zh-CN.png', 1280);

  console.log('All brand assets generated.');
}

generate().catch((err) => { console.error(err); process.exit(1); });
