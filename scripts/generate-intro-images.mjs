#!/usr/bin/env node

import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND_DIR = path.join(ROOT, 'docs', 'brand');

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------
const C = {
  text:        '#1F2937',
  textMed:     '#4B5563',
  textLight:   '#6B7280',
  textMuted:   '#9CA3AF',
  blue:        '#3B82F6',
  blueBg:      '#EFF6FF',
  purple:      '#8B5CF6',
  purpleBg:    '#F5F3FF',
  green:       '#10B981',
  greenBg:     '#ECFDF5',
  orange:      '#F59E0B',
  orangeBg:    '#FFFBEB',
  indigo:      '#6366F1',
  indigoBg:    '#EEF2FF',
  rose:        '#F43F5E',
  roseBg:      '#FFF1F2',
  white:       '#FFFFFF',
  canvas:      '#F8FAFC',
  border:      '#E5E7EB',
  borderLight: '#F3F4F6',
  chromeBg:    '#F1F3F4',
  urlBg:       '#E8EAED',
  iconStroke:  '#202124',
};

// ---------------------------------------------------------------------------
// Font system — 4-tier hierarchy
// ---------------------------------------------------------------------------
// Latin: Didot (display title) / Georgia (body)
// CJK:   Kaiti SC (calligraphic serif) / STKaiti fallback
// Georgia listed first so Latin chars use it, CJK falls through to Kaiti
const FT_TITLE = 'Didot, Kaiti SC, STKaiti, Georgia, serif';
const FT_BODY  = 'Georgia, Kaiti SC, STKaiti, serif';

const FS = {
  heroTitle:    28,   // product name (Tier 1)
  heroVersion:  13,   // version tag
  heroSubtitle: 14,   // one-line subtitle
  heroDesc:     12,   // description paragraph
  badge:        11,   // badge pill text
  cardTitle:    14,   // feature card titles (Tier 2)
  cardDesc:     11.5, // card descriptions (Tier 3)
  sectionTitle: 14.5, // bottom section titles
  itemTitle:    12.5, // use-case labels, steps, privacy items
  itemDesc:     11,   // sub-descriptions
  urlBar:       10,   // browser mockup URL
  dockLabel:    10,   // dock panel labels (Tier 4)
};

const DESC_LH = 14; // line height for wrapped body text

// ---------------------------------------------------------------------------
// Locale copy
// ---------------------------------------------------------------------------
const COPY = {
  en: {
    title: 'Web TOC Assistant',
    version: '1.x',
    subtitle: 'Interactive floating table of contents for any webpage',
    desc: 'Auto-detect headings, preview the docked outline, hover to expand, click to jump.',
    badges: [
      { text: 'Live Preview', color: C.blue },
      { text: 'Hover to Expand', color: C.purple },
      { text: 'Click to Jump', color: C.indigo },
      { text: '100% Local', color: C.green },
    ],
    features: [
      { title: 'Automatic TOC',
        desc: 'Detects headings via CSS, XPath, or smart content-region analysis.',
        color: C.blue, icon: 'doc' },
      { title: 'Quick Navigation',
        desc: 'Click any heading to scroll. Active section highlighted in real time.',
        color: C.purple, icon: 'nav' },
      { title: 'Hierarchy Preview',
        desc: 'Collapsed Edge Dock shows heading depth and reading position at a glance.',
        color: C.orange, icon: 'layers' },
      { title: 'Chatbot TOC',
        desc: 'Works on ChatGPT, Claude, Gemini and more \u2014 AI chats as navigable outline.',
        color: C.indigo, icon: 'chat' },
    ],
    browser: {
      url: 'example.com/docs/frontend-performance-guide',
      pageTitle: 'Frontend Performance Guide',
      headings: [
        { text: '1. Metrics & Measurement', level: 1 },
        { text: '1.1 Core Web Vitals', level: 2 },
        { text: '1.2 Performance Budget', level: 2 },
        { text: '2. Loading Optimization', level: 1, active: true },
        { text: '2.1 Resource Priority', level: 2 },
        { text: '3. Rendering & Interaction', level: 1 },
      ],
      dockItems: [
        { text: '1. Metrics & Measurement', indent: 0 },
        { text: '1.1 Core Web Vitals', indent: 1 },
        { text: '1.2 Performance Budget', indent: 1 },
        { text: '2. Loading Optimization', indent: 0, active: true },
        { text: '2.1 Resource Priority', indent: 1 },
        { text: '3. Rendering & Interaction', indent: 0 },
      ],
    },
    rightFeatures: [
      { title: 'Element Picker',
        desc: 'Pick any element to generate a CSS selector for custom site config.',
        color: C.rose, icon: 'pick' },
      { title: 'Dark Theme',
        desc: 'Auto-adapts to system theme. Looks great in both light and dark mode.',
        color: C.orange, icon: 'theme' },
      { title: 'Per-Site Config',
        desc: 'Custom selectors, dock side, and position \u2014 saved per website.',
        color: C.green, icon: 'config' },
    ],
    useCases: {
      title: 'Use Cases',
      items: [
        { label: 'Long-form Reading', desc: 'Articles, blogs, essays' },
        { label: 'Study & Research', desc: 'Papers, textbooks, Wikipedia' },
        { label: 'Technical Docs', desc: 'API docs, user guides' },
        { label: 'AI Conversations', desc: 'ChatGPT, Claude, Gemini' },
      ],
    },
    howItWorks: {
      title: 'How It Works',
      steps: [
        { num: 1, text: 'Install the extension from store' },
        { num: 2, text: 'Open any long-form webpage' },
        { num: 3, text: 'Edge Dock appears on the side' },
        { num: 4, text: 'Hover to expand, click to jump' },
      ],
    },
    privacy: {
      title: 'Privacy & Security',
      items: [
        'All processing runs locally in your browser',
        'No data collection, tracking, or uploads',
        'No external servers or analytics',
        'Works fully offline after installation',
      ],
    },
  },
  zh: {
    title: '网页目录助手',
    version: '1.x',
    subtitle: '为任意网页生成可交互的浮动目录',
    desc: '自动识别标题层级，贴边预览目录轮廓，悬停展开，点击跳转。',
    badges: [
      { text: '实时预览', color: C.blue },
      { text: '悬停展开', color: C.purple },
      { text: '点击跳转', color: C.indigo },
      { text: '完全本地', color: C.green },
    ],
    features: [
      { title: '自动生成目录',
        desc: '通过 CSS 选择器、XPath 或智能内容区域分析识别标题。',
        color: C.blue, icon: 'doc' },
      { title: '快速定位导航',
        desc: '点击目录标题即可跳转，实时高亮当前阅读位置。',
        color: C.purple, icon: 'nav' },
      { title: '层级路线预览',
        desc: '收起状态的贴边栏可一览标题层级和当前阅读位置。',
        color: C.orange, icon: 'layers' },
      { title: 'AI 对话目录',
        desc: '支持 ChatGPT、Claude、Gemini 等平台，对话变可导航目录。',
        color: C.indigo, icon: 'chat' },
    ],
    browser: {
      url: 'example.com/docs/frontend-performance-guide',
      pageTitle: '前端性能优化指南',
      headings: [
        { text: '1. 性能指标与测量', level: 1 },
        { text: '1.1 核心体验指标', level: 2 },
        { text: '1.2 建立性能预算', level: 2 },
        { text: '2. 加载链路优化', level: 1, active: true },
        { text: '2.1 资源优先级', level: 2 },
        { text: '3. 渲染与交互响应', level: 1 },
      ],
      dockItems: [
        { text: '1. 性能指标与测量', indent: 0 },
        { text: '1.1 核心体验指标', indent: 1 },
        { text: '1.2 建立性能预算', indent: 1 },
        { text: '2. 加载链路优化', indent: 0, active: true },
        { text: '2.1 资源优先级', indent: 1 },
        { text: '3. 渲染与交互响应', indent: 0 },
      ],
    },
    rightFeatures: [
      { title: '元素拾取器',
        desc: '拾取页面任意元素，自动生成 CSS 选择器并保存为配置。',
        color: C.rose, icon: 'pick' },
      { title: '深色主题',
        desc: '自动适配系统主题，亮色和暗色模式下均有出色表现。',
        color: C.orange, icon: 'theme' },
      { title: '按站点配置',
        desc: '自定义选择器、停靠方向和位置，每站独立保存。',
        color: C.green, icon: 'config' },
    ],
    useCases: {
      title: '适用场景',
      items: [
        { label: '长文阅读', desc: '文章、博客、随笔' },
        { label: '学习研究', desc: '论文、教材、百科' },
        { label: '技术文档', desc: 'API 文档、使用指南' },
        { label: 'AI 对话', desc: 'ChatGPT、Claude、Gemini' },
      ],
    },
    howItWorks: {
      title: '使用步骤',
      steps: [
        { num: 1, text: '从应用商店安装扩展' },
        { num: 2, text: '打开任意长文网页' },
        { num: 3, text: '贴边目录自动出现' },
        { num: 4, text: '悬停展开，点击跳转' },
      ],
    },
    privacy: {
      title: '隐私与安全',
      items: [
        '所有处理均在浏览器本地完成',
        '不收集、不上传、不追踪任何数据',
        '无外部服务器或分析脚本',
        '安装后即可完全离线使用',
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Text measurement & wrapping
// ---------------------------------------------------------------------------
const CJK_RE = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2000-\u206f]/;

function measureText(str, fontSize) {
  let w = 0;
  for (const ch of str) {
    w += CJK_RE.test(ch) ? fontSize : fontSize * 0.55;
  }
  return w;
}

function wrapToLines(str, maxWidth, fontSize) {
  const lines = [];
  let line = '';
  for (const ch of str) {
    const test = line + ch;
    if (measureText(test, fontSize) > maxWidth && line.length > 0) {
      const sp = line.lastIndexOf(' ');
      if (sp > 0 && !CJK_RE.test(ch)) {
        lines.push(line.slice(0, sp));
        line = line.slice(sp + 1) + ch;
      } else {
        lines.push(line);
        line = ch;
      }
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function renderWrappedText(x, y, text, maxWidth, fontSize, fill, weight) {
  const lines = wrapToLines(text, maxWidth, fontSize);
  return lines.map((l, i) =>
    `<text x="${x}" y="${y + i * DESC_LH}" font-family="${FT_BODY}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${esc(l)}</text>`
  ).join('\n    ');
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function card(x, y, w, h, opts = {}) {
  const rx = opts.rx ?? 10;
  const fill = opts.fill ?? C.white;
  const shadow = opts.shadow ?? true;
  const sw = opts.stroke ?? C.border;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${sw}" stroke-width="0.5" ${shadow ? 'filter="url(#shadow)"' : ''}/>`;
}

function checkCircle(cx, cy, r) {
  const s = r * 0.5;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.green}"/>
  <path d="M${cx - s * 0.7} ${cy} L${cx - s * 0.15} ${cy + s * 0.6} L${cx + s * 0.8} ${cy - s * 0.55}" stroke="${C.white}" stroke-width="${r * 0.28}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
}

function stepCircle(cx, cy, r, num, color) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>
  <text x="${cx}" y="${cy + 1}" text-anchor="middle" dominant-baseline="central" font-family="${FT_BODY}" font-size="${r * 1.05}" font-weight="700" fill="${C.white}">${num}</text>`;
}

function badgePill(x, y, w, h, bg, text) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${bg}"/>
  <text x="${x + w / 2}" y="${y + h / 2 + 1}" text-anchor="middle" dominant-baseline="central" font-family="${FT_BODY}" font-size="${FS.badge}" font-weight="600" fill="${C.white}">${esc(text)}</text>`;
}

// ---------------------------------------------------------------------------
// Brand mark — embedded from web-toc-assistant-mark-enabled.svg
// Draws the document-outline icon at (x, y) scaled to height `h`.
// ---------------------------------------------------------------------------
function brandMark(x, y, h, strokeColor) {
  const sc = C.iconStroke;
  const col = strokeColor || sc;
  // Original viewBox: 0 0 128 128. Scale to target height.
  const s = h / 128;
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M33 14H78L105 41V108C105 113.523 100.523 118 95 118H33C27.477 118 23 113.523 23 108V24C23 18.477 27.477 14 33 14Z" fill="${C.white}"/>
    <path d="M78 14V36C78 41.523 82.477 46 88 46H105" fill="${C.borderLight}"/>
    <path d="M33 14H78L105 41V108C105 113.523 100.523 118 95 118H33C27.477 118 23 113.523 23 108V24C23 18.477 27.477 14 33 14Z" stroke="${col}" stroke-width="4" stroke-linejoin="round" fill="none"/>
    <path d="M78 14V36C78 41.523 82.477 46 88 46H105" stroke="${col}" stroke-width="4" stroke-linejoin="round" fill="none"/>
    <rect x="38" y="44" width="9" height="9" rx="2" fill="${col}"/>
    <rect x="38" y="65" width="9" height="9" rx="2" fill="${col}"/>
    <rect x="38" y="86" width="9" height="9" rx="2" fill="${col}"/>
    <path d="M58 48.5H88" stroke="${col}" stroke-width="7" stroke-linecap="round"/>
    <path d="M58 69.5H82" stroke="${col}" stroke-width="7" stroke-linecap="round"/>
    <path d="M58 90.5H88" stroke="${col}" stroke-width="7" stroke-linecap="round"/>
  </g>`;
}

// Small icons for feature cards
function icon(name, x, y, s, color) {
  const paths = {
    doc: () => `<g transform="translate(${x} ${y}) scale(${s})">
      <rect x="0" y="0" width="12" height="15" rx="1.5" fill="${color}" opacity="0.15"/>
      <rect x="0" y="0" width="12" height="15" rx="1.5" stroke="${color}" stroke-width="1" fill="none"/>
      <line x1="3" y1="5" x2="9" y2="5" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
      <line x1="3" y1="8" x2="7.5" y2="8" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
      <line x1="3" y1="11" x2="8.5" y2="11" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
    </g>`,
    nav: () => `<g transform="translate(${x} ${y}) scale(${s})">
      <circle cx="8" cy="8" r="7" fill="${color}" opacity="0.12"/>
      <circle cx="8" cy="8" r="7" stroke="${color}" stroke-width="1" fill="none"/>
      <circle cx="8" cy="4.5" r="1.5" fill="${color}"/>
      <line x1="8" y1="6.5" x2="8" y2="12" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M5 10 L8 13 L11 10" stroke="${color}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </g>`,
    layers: () => `<g transform="translate(${x} ${y}) scale(${s})">
      <path d="M8 2 L15 6 L8 10 L1 6 Z" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="0.8"/>
      <path d="M1 9 L8 13 L15 9" stroke="${color}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M1 12 L8 16 L15 12" stroke="${color}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </g>`,
    chat: () => `<g transform="translate(${x} ${y}) scale(${s})">
      <rect x="1" y="1" width="14" height="10" rx="3" fill="${color}" opacity="0.12" stroke="${color}" stroke-width="0.8"/>
      <line x1="4" y1="5" x2="12" y2="5" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
      <line x1="4" y1="8" x2="9" y2="8" stroke="${color}" stroke-width="1" stroke-linecap="round"/>
      <path d="M5 11 L3 15 L8 11" fill="${color}" opacity="0.2"/>
    </g>`,
    pick: () => `<g transform="translate(${x} ${y}) scale(${s})">
      <circle cx="8" cy="8" r="7" fill="${color}" opacity="0.1" stroke="${color}" stroke-width="0.8"/>
      <circle cx="8" cy="8" r="3" fill="${color}" opacity="0.3"/>
      <line x1="8" y1="1" x2="8" y2="4" stroke="${color}" stroke-width="1"/>
      <line x1="8" y1="12" x2="8" y2="15" stroke="${color}" stroke-width="1"/>
      <line x1="1" y1="8" x2="4" y2="8" stroke="${color}" stroke-width="1"/>
      <line x1="12" y1="8" x2="15" y2="8" stroke="${color}" stroke-width="1"/>
    </g>`,
    theme: () => `<g transform="translate(${x} ${y}) scale(${s})">
      <circle cx="8" cy="8" r="7" fill="${color}" opacity="0.12" stroke="${color}" stroke-width="0.8"/>
      <path d="M8 2 A6 6 0 1 0 8 14 A4.5 4.5 0 0 1 8 2" fill="${color}" opacity="0.4"/>
    </g>`,
    config: () => `<g transform="translate(${x} ${y}) scale(${s})">
      <circle cx="8" cy="8" r="3" fill="${color}" opacity="0.3" stroke="${color}" stroke-width="1"/>
      <line x1="8" y1="1" x2="8" y2="3.5" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="8" y1="12.5" x2="8" y2="15" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="1" y1="8" x2="3.5" y2="8" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>
      <line x1="12.5" y1="8" x2="15" y2="8" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/>
    </g>`,
  };
  return (paths[name] || paths.doc)();
}

// ---------------------------------------------------------------------------
// Layout — all positions verified for no overlaps (gaps >= 10px)
// ---------------------------------------------------------------------------
const M = 24;
const W = 1280, H = 800;
const UW = W - 2 * M; // 1232

// Top section ends at y=126 (badge bottom)
// 10px gap
const TOP_Y = 12;
const MID_Y = 136;
// Middle left cards bottom: 136 + 3*(94+8)+94 = 536
// 16px gap
const BOT_Y = 552;
// Bottom card bottom: 552 + (800-552-24) = 776 = H - M

// Columns
const LEFT_W   = 296;
const CENTER_W  = 510;
const RIGHT_W   = UW - LEFT_W - CENTER_W - 18; // 408
const CENTER_X  = M + LEFT_W + 12;              // 332
const RIGHT_X   = CENTER_X + CENTER_W + 6;      // 848

const LEFT_CARD_H   = 94;
const LEFT_CARD_GAP  = 8;
const RIGHT_CARD_H  = 118;
const RIGHT_CARD_GAP = 10;
const BROWSER_H     = 396;
const BOTTOM_SH     = H - BOT_Y - M; // 224

// ---------------------------------------------------------------------------
// Top Section — hero with brand mark
// ---------------------------------------------------------------------------
function topSection(copy) {
  let s = '';

  // Brand mark icon (56px tall)
  const iconX = M + 6, iconY = TOP_Y + 6, iconH = 56;
  s += brandMark(iconX, iconY, iconH, C.iconStroke);

  // Text starts after icon
  const tx = M + 72;

  // Title
  s += `<text x="${tx}" y="${TOP_Y + 38}" font-family="${FT_TITLE}" font-size="${FS.heroTitle}" font-weight="800" fill="${C.text}">${esc(copy.title)}</text>`;

  // Version — positioned via measurement
  const titleW = measureText(copy.title, FS.heroTitle);
  s += `<text x="${tx + titleW + 10}" y="${TOP_Y + 38}" font-family="${FT_BODY}" font-size="${FS.heroVersion}" font-weight="500" fill="${C.textMuted}">${esc(copy.version)}</text>`;

  // Subtitle
  s += `<text x="${tx}" y="${TOP_Y + 60}" font-family="${FT_BODY}" font-size="${FS.heroSubtitle}" font-weight="500" fill="${C.textMed}">${esc(copy.subtitle)}</text>`;

  // Description
  s += `<text x="${M}" y="${TOP_Y + 80}" font-family="${FT_BODY}" font-size="${FS.heroDesc}" font-weight="400" fill="${C.textLight}">${esc(copy.desc)}</text>`;

  // Badge pills
  const badgeH = 22, badgeGap = 8, badgeY = TOP_Y + 92;
  let bx = M;
  for (const b of copy.badges) {
    const bw = measureText(b.text, FS.badge) + 22;
    s += badgePill(bx, badgeY, bw, badgeH, b.color, b.text);
    bx += bw + badgeGap;
  }
  // Badges bottom = TOP_Y + 92 + 22 = 126

  return s;
}

// ---------------------------------------------------------------------------
// Middle Left — feature cards (4)
// ---------------------------------------------------------------------------
function featureCards(copy) {
  let s = '';
  const cx = M;
  for (let i = 0; i < copy.features.length; i++) {
    const f = copy.features[i];
    const cy = MID_Y + i * (LEFT_CARD_H + LEFT_CARD_GAP);

    s += card(cx, cy, LEFT_W, LEFT_CARD_H);
    s += `<rect x="${cx}" y="${cy + 8}" width="3.5" height="${LEFT_CARD_H - 16}" rx="1.75" fill="${f.color}"/>`;

    // Icon
    s += `<rect x="${cx + 14}" y="${cy + 14}" width="38" height="38" rx="10" fill="${f.color}" opacity="0.1"/>`;
    s += icon(f.icon, cx + 21, cy + 20, 1.5, f.color);

    // Title
    s += `<text x="${cx + 62}" y="${cy + 32}" font-family="${FT_BODY}" font-size="${FS.cardTitle}" font-weight="700" fill="${C.text}">${esc(f.title)}</text>`;

    // Description (wrapped)
    s += renderWrappedText(cx + 62, cy + 48, f.desc, LEFT_W - 62 - 12, FS.cardDesc, C.textLight, '400');

    // Dotted connector to browser
    if (i < 2) {
      const ay = cy + LEFT_CARD_H / 2;
      s += `<path d="M${cx + LEFT_W + 1} ${ay} L${cx + LEFT_W + 11} ${ay}" stroke="${f.color}" stroke-width="1.5" stroke-dasharray="3 2" fill="none"/>`;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Middle Center — browser mockup with Edge Dock
// ---------------------------------------------------------------------------
function browserMockup(copy) {
  let s = '';
  const bx = CENTER_X, by = MID_Y;
  const bw = CENTER_W, bh = BROWSER_H;

  s += card(bx, by, bw, bh, { rx: 12 });

  // Chrome bar
  s += `<rect x="${bx}" y="${by}" width="${bw}" height="38" rx="12" fill="${C.chromeBg}"/>`;
  s += `<rect x="${bx}" y="${by + 28}" width="${bw}" height="10" fill="${C.chromeBg}"/>`;
  s += `<circle cx="${bx + 20}" cy="${by + 19}" r="6" fill="#EF4444"/>`;
  s += `<circle cx="${bx + 40}" cy="${by + 19}" r="6" fill="#F59E0B"/>`;
  s += `<circle cx="${bx + 60}" cy="${by + 19}" r="6" fill="#22C55E"/>`;
  s += `<rect x="${bx + 80}" y="${by + 9}" width="${bw - 100}" height="20" rx="10" fill="${C.urlBg}"/>`;
  s += `<text x="${bx + 94}" y="${by + 23}" font-family="${FT_BODY}" font-size="${FS.urlBar}" font-weight="500" fill="${C.textLight}">${esc(copy.browser.url)}</text>`;

  // Page content
  const px = bx + 28, py = by + 54;
  s += `<text x="${px}" y="${py + 16}" font-family="${FT_BODY}" font-size="15" font-weight="800" fill="${C.text}">${esc(copy.browser.pageTitle)}</text>`;
  s += `<line x1="${px}" y1="${py + 26}" x2="${px + 280}" y2="${py + 26}" stroke="${C.border}" stroke-width="0.6"/>`;

  // Heading bars
  const headingWidths = [230, 175, 195, 250, 165, 210];
  let ly = py + 42;
  for (let i = 0; i < copy.browser.headings.length; i++) {
    const hd = copy.browser.headings[i];
    const w = headingWidths[i];
    const indent = hd.level === 2 ? 22 : 0;
    const isH2 = hd.level === 2;
    const barH = hd.active ? 12 : (isH2 ? 7 : 9);

    if (hd.active) {
      s += `<rect x="${px - 6 + indent}" y="${ly - 2}" width="${w + 12}" height="${barH + 4}" rx="4" fill="${C.blueBg}"/>`;
      s += `<rect x="${px + indent}" y="${ly}" width="${w}" height="${barH}" rx="5" fill="${C.blue}"/>`;
    } else {
      s += `<rect x="${px + indent}" y="${ly}" width="${w}" height="${barH}" rx="4" fill="${C.border}" opacity="0.55"/>`;
    }
    const bodyY = ly + barH + 5;
    s += `<rect x="${px + indent}" y="${bodyY}" width="${w + 25}" height="4" rx="2" fill="${C.border}" opacity="0.28"/>`;
    s += `<rect x="${px + indent}" y="${bodyY + 8}" width="${w - 15}" height="4" rx="2" fill="${C.border}" opacity="0.18"/>`;
    ly += 52;
  }

  // Edge Dock TOC Panel
  const dockW = 145, dockH = bh - 66;
  const dockX = bx + bw - dockW - 14, dockY = by + 50;

  s += `<rect x="${dockX}" y="${dockY}" width="${dockW}" height="${dockH}" rx="12" fill="${C.white}" stroke="${C.border}" stroke-width="0.8" filter="url(#shadow)"/>`;
  s += `<rect x="${dockX + 8}" y="${dockY + 8}" width="30" height="30" rx="15" fill="${C.blueBg}"/>`;
  // Small brand mark in dock header (24px tall)
  s += brandMark(dockX + 12, dockY + 11, 24, C.blue);
  s += `<text x="${dockX + 46}" y="${dockY + 28}" font-family="${FT_BODY}" font-size="${FS.dockLabel}" font-weight="700" fill="${C.text}">TOC</text>`;
  s += `<line x1="${dockX + 10}" y1="${dockY + 46}" x2="${dockX + dockW - 10}" y2="${dockY + 46}" stroke="${C.borderLight}" stroke-width="0.6"/>`;

  let tocY = dockY + 58;
  for (const item of copy.browser.dockItems) {
    const indentPx = item.indent * 14;
    const textW = dockW - 30 - indentPx;
    const fill = item.active ? C.blue : C.textMuted;
    const opacity = item.active ? 1 : 0.5;
    const th = item.active ? 8 : 5;
    if (item.active) s += `<rect x="${dockX + 6}" y="${tocY}" width="3" height="${th}" rx="1.5" fill="${C.blue}"/>`;
    s += `<rect x="${dockX + 14 + indentPx}" y="${tocY}" width="${textW}" height="${th}" rx="3" fill="${fill}" opacity="${opacity}"/>`;
    tocY += 16;
  }

  // Keyboard nav hint
  s += `<line x1="${dockX + 10}" y1="${dockY + dockH - 28}" x2="${dockX + dockW - 10}" y2="${dockY + dockH - 28}" stroke="${C.borderLight}" stroke-width="0.6"/>`;
  s += `<rect x="${dockX + 12}" y="${dockY + dockH - 20}" width="22" height="14" rx="4" fill="${C.borderLight}"/>`;
  s += `<text x="${dockX + 23}" y="${dockY + dockH - 10}" text-anchor="middle" font-family="${FT_BODY}" font-size="7" font-weight="600" fill="${C.textMuted}">\u2191</text>`;
  s += `<rect x="${dockX + 38}" y="${dockY + dockH - 20}" width="22" height="14" rx="4" fill="${C.borderLight}"/>`;
  s += `<text x="${dockX + 49}" y="${dockY + dockH - 10}" text-anchor="middle" font-family="${FT_BODY}" font-size="7" font-weight="600" fill="${C.textMuted}">\u2193</text>`;
  s += `<text x="${dockX + 66}" y="${dockY + dockH - 10}" font-family="${FT_BODY}" font-size="7.5" font-weight="400" fill="${C.textMuted}">keyboard nav</text>`;

  // Connector
  const pageActiveY = py + 42 + 3 * 52 + 4;
  const dockActiveY = dockY + 58 + 3 * 16 + 3;
  s += `<line x1="${dockX - 4}" y1="${pageActiveY}" x2="${dockX}" y2="${dockActiveY}" stroke="${C.blue}" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.45"/>`;

  return s;
}

// ---------------------------------------------------------------------------
// Middle Right — extra features (3)
// ---------------------------------------------------------------------------
function rightFeatures(copy) {
  let s = '';
  const cx = RIGHT_X;
  for (let i = 0; i < copy.rightFeatures.length; i++) {
    const f = copy.rightFeatures[i];
    const cy = MID_Y + i * (RIGHT_CARD_H + RIGHT_CARD_GAP);

    s += card(cx, cy, RIGHT_W, RIGHT_CARD_H);
    s += `<rect x="${cx + 10}" y="${cy}" width="${RIGHT_W - 20}" height="3" rx="1.5" fill="${f.color}"/>`;

    s += `<rect x="${cx + 12}" y="${cy + 14}" width="36" height="36" rx="10" fill="${f.color}" opacity="0.1"/>`;
    s += icon(f.icon, cx + 18, cy + 20, 1.35, f.color);

    s += `<text x="${cx + 58}" y="${cy + 32}" font-family="${FT_BODY}" font-size="${FS.cardTitle}" font-weight="700" fill="${C.text}">${esc(f.title)}</text>`;

    s += renderWrappedText(cx + 58, cy + 48, f.desc, RIGHT_W - 58 - 12, FS.cardDesc, C.textLight, '400');

    // Mini visual element
    if (f.icon === 'pick') {
      const tx = cx + 24, ty = cy + 88;
      s += `<circle cx="${tx}" cy="${ty}" r="14" fill="none" stroke="${f.color}" stroke-width="0.8" opacity="0.3"/>`;
      s += `<circle cx="${tx}" cy="${ty}" r="8" fill="none" stroke="${f.color}" stroke-width="0.8" opacity="0.5"/>`;
      s += `<circle cx="${tx}" cy="${ty}" r="3" fill="${f.color}" opacity="0.4"/>`;
    } else if (f.icon === 'theme') {
      const ty = cy + 96;
      s += `<rect x="${cx + 12}" y="${ty - 8}" width="50" height="16" rx="8" fill="${C.borderLight}"/>`;
      s += `<circle cx="${cx + 50}" cy="${ty}" r="6" fill="${f.color}" opacity="0.5"/>`;
    } else if (f.icon === 'config') {
      const ty = cy + 96;
      s += `<circle cx="${cx + 20}" cy="${ty}" r="4" fill="${f.color}" opacity="0.3"/>`;
      s += `<circle cx="${cx + 34}" cy="${ty}" r="4" fill="${f.color}" opacity="0.5"/>`;
      s += `<circle cx="${cx + 48}" cy="${ty}" r="4" fill="${f.color}" opacity="0.3"/>`;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Bottom — Use Cases
// ---------------------------------------------------------------------------
function useCasesSection(copy) {
  let s = '';
  const sx = M, sy = BOT_Y;
  const sw = Math.floor((UW - 14) / 3);
  const sh = BOTTOM_SH;

  s += card(sx, sy, sw, sh);
  s += `<rect x="${sx + 16}" y="${sy + 14}" width="4" height="16" rx="2" fill="${C.blue}"/>`;
  s += `<text x="${sx + 28}" y="${sy + 26}" font-family="${FT_BODY}" font-size="${FS.sectionTitle}" font-weight="700" fill="${C.text}">${esc(copy.useCases.title)}</text>`;

  const items = copy.useCases.items;
  const colors = [C.blue, C.purple, C.orange, C.indigo];
  const icons = ['doc', 'layers', 'config', 'chat'];

  for (let i = 0; i < items.length; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    const halfW = Math.floor((sw - 36) / 2);
    const ix = sx + 16 + col * halfW;
    const iy = sy + 48 + row * 82;
    s += `<circle cx="${ix + 8}" cy="${iy + 4}" r="8" fill="${colors[i]}" opacity="0.1"/>`;
    s += icon(icons[i], ix + 1, iy - 2, 0.85, colors[i]);
    s += `<text x="${ix + 22}" y="${iy + 8}" font-family="${FT_BODY}" font-size="${FS.itemTitle}" font-weight="700" fill="${C.text}">${esc(items[i].label)}</text>`;
    s += `<text x="${ix + 22}" y="${iy + 23}" font-family="${FT_BODY}" font-size="${FS.itemDesc}" font-weight="400" fill="${C.textLight}">${esc(items[i].desc)}</text>`;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Bottom — How It Works
// ---------------------------------------------------------------------------
function howItWorksSection(copy) {
  let s = '';
  const gap = 7;
  const sx = M + Math.floor((UW - 14) / 3) + gap;
  const sy = BOT_Y;
  const sw = Math.floor((UW - 14) / 3);
  const sh = BOTTOM_SH;

  s += card(sx, sy, sw, sh);
  s += `<rect x="${sx + 16}" y="${sy + 14}" width="4" height="16" rx="2" fill="${C.purple}"/>`;
  s += `<text x="${sx + 28}" y="${sy + 26}" font-family="${FT_BODY}" font-size="${FS.sectionTitle}" font-weight="700" fill="${C.text}">${esc(copy.howItWorks.title)}</text>`;

  const steps = copy.howItWorks.steps;
  const stepColors = [C.blue, C.purple, C.indigo, C.green];
  const stepSpacing = 44;
  for (let i = 0; i < steps.length; i++) {
    const iy = sy + 50 + i * stepSpacing;
    s += stepCircle(sx + 30, iy + 8, 12, steps[i].num, stepColors[i]);
    s += `<text x="${sx + 52}" y="${iy + 6}" font-family="${FT_BODY}" font-size="${FS.itemTitle}" font-weight="600" fill="${C.text}">${esc(steps[i].text)}</text>`;
    if (i < steps.length - 1) {
      s += `<line x1="${sx + 30}" y1="${iy + 22}" x2="${sx + 30}" y2="${iy + 32}" stroke="${C.border}" stroke-width="1.2" stroke-dasharray="3 2"/>`;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Bottom — Privacy & Security
// ---------------------------------------------------------------------------
function privacySection(copy) {
  let s = '';
  const gap = 7;
  const sx = M + 2 * (Math.floor((UW - 14) / 3) + gap);
  const sy = BOT_Y;
  const sw = UW - 2 * (Math.floor((UW - 14) / 3) + gap);
  const sh = BOTTOM_SH;

  s += card(sx, sy, sw, sh);
  s += `<rect x="${sx + 16}" y="${sy + 14}" width="4" height="16" rx="2" fill="${C.green}"/>`;
  s += `<text x="${sx + 28}" y="${sy + 26}" font-family="${FT_BODY}" font-size="${FS.sectionTitle}" font-weight="700" fill="${C.text}">${esc(copy.privacy.title)}</text>`;

  // Shield icon
  const shX = sx + sw - 42, shY = sy + 10;
  s += `<path d="M${shX + 10} ${shY} L${shX + 20} ${shY + 5} L${shX + 20} ${shY + 15} Q${shX + 20} ${shY + 22} ${shX + 10} ${shY + 26} Q${shX} ${shY + 22} ${shX} ${shY + 15} L${shX} ${shY + 5} Z" fill="${C.greenBg}" stroke="${C.green}" stroke-width="0.8"/>`;

  const items = copy.privacy.items;
  const itemSpacing = 44;
  for (let i = 0; i < items.length; i++) {
    const iy = sy + 50 + i * itemSpacing;
    s += checkCircle(sx + 30, iy + 4, 9);
    s += `<text x="${sx + 48}" y="${iy + 1}" font-family="${FT_BODY}" font-size="${FS.itemTitle}" font-weight="600" fill="${C.text}">${esc(items[i])}</text>`;
    if (i < items.length - 1) {
      s += `<line x1="${sx + 16}" y1="${iy + 24}" x2="${sx + sw - 16}" y2="${iy + 24}" stroke="${C.borderLight}" stroke-width="0.6"/>`;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Main SVG
// ---------------------------------------------------------------------------
function introSvg(locale) {
  const copy = COPY[locale];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1280" height="800" viewBox="0 0 1280 800" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-3%" y="-3%" width="106%" height="114%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.07"/>
    </filter>
  </defs>
  <rect width="1280" height="800" fill="${C.canvas}"/>
  ${topSection(copy)}
  ${featureCards(copy)}
  ${browserMockup(copy)}
  ${rightFeatures(copy)}
  ${useCasesSection(copy)}
  ${howItWorksSection(copy)}
  ${privacySection(copy)}
</svg>`;
}

// ---------------------------------------------------------------------------
// Render at 2x resolution
// ---------------------------------------------------------------------------
const RENDER_WIDTH = 2560;

async function renderPng(svg, relativePath) {
  const target = path.join(ROOT, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const renderer = new Resvg(svg, {
    fitTo: { mode: 'width', value: RENDER_WIDTH },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Georgia',
    },
  });
  await writeFile(target, renderer.render().asPng());
}

async function generate() {
  await mkdir(BRAND_DIR, { recursive: true });
  console.log(`Generating store-extension-intro-en.png (${RENDER_WIDTH}px) ...`);
  await renderPng(introSvg('en'), 'docs/brand/store-extension-intro-en.png');
  console.log(`Generating store-extension-intro-zh-CN.png (${RENDER_WIDTH}px) ...`);
  await renderPng(introSvg('zh'), 'docs/brand/store-extension-intro-zh-CN.png');
  console.log('Done.');
}

generate().catch((err) => { console.error(err); process.exit(1); });
