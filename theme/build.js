#!/usr/bin/env node
// Black & white profile README builder.
//   theme/profile.json (content) + theme/tokens.json (design) -> theme/assets/{light,dark}/*.svg + the README file.
// Usage: node theme/build.js [--offline] [--only <section type>]
// Live data (contributions, top repos, Medium posts, GitHub activity) is fetched when online and cached in
// theme/data/cache.json, so an offline or failed fetch falls back to the last good copy.
'use strict';

const fs = require('fs');
const path = require('path');

const THEME = __dirname;
const ROOT = path.resolve(THEME, '..');
const OFFLINE = process.argv.includes('--offline');
// --only <type> re-renders just the sections of that type in place (README untouched), e.g. --only spotify.
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const TOKEN = process.env.GITHUB_TOKEN || '';

const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const profile = readJSON(path.join(THEME, 'profile.json'));
const tokens = readJSON(path.join(THEME, 'tokens.json'));
const CACHE_FILE = path.join(THEME, 'data', 'cache.json');
const cache = fs.existsSync(CACHE_FILE) ? readJSON(CACHE_FILE) : {};
const ASSETS = path.join(THEME, 'assets');
const MODES = Object.keys(tokens.modes);
const OUTPUT = path.join(ROOT, profile.output);

const warnings = [];
const W = 1000; // card width, as in the reference theme
const L = 48; // left margin
const R = 952; // right margin
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ─── text ────────────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad2 = (n) => String(n).padStart(2, '0');
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const width = (s, size, ls = 0) => [...String(s)].length * (size * tokens.charWidth + ls);

function wrap(s, size, ls, max) {
  const lines = [];
  let cur = '';
  for (const word of String(s).split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && width(next, size, ls) > max) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function truncate(s, size, ls, max) {
  if (width(s, size, ls) <= max) return s;
  const chars = [...s];
  while (chars.length && width(chars.join('') + '…', size, ls) > max) chars.pop();
  return chars.join('') + '…';
}

function checkFit(where, s, size, ls, max) {
  if (width(s, size, ls) > max) warnings.push(`${where}: "${s}" may overflow (${Math.round(width(s, size, ls))}px > ${max}px)`);
}

// ─── svg primitives (colour-free; ink is applied per mode in svgDoc) ──────────

const attrs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(' ');
const delay = (d) => (d == null ? undefined : `animation-delay:${d}s`);

const text = (x, y, s, o = {}) =>
  `<text class="${['m', o.cls].filter(Boolean).join(' ')}" ${attrs({
    x, y, 'font-size': o.size || 14, 'letter-spacing': o.ls, 'text-anchor': o.anchor, 'font-weight': o.weight, opacity: o.op, style: delay(o.delay),
  })}>${esc(s)}</text>`;

const line = (x1, y1, x2, y2, o = {}) =>
  `<line class="${['ln', o.draw && 'draw'].filter(Boolean).join(' ')}" ${attrs({
    x1, y1, x2, y2, pathLength: o.draw ? 1 : undefined, opacity: o.op ?? tokens.tones.rule, style: delay(o.delay),
  })}/>`;

const group = (cls, d, inner) => `<g class="${cls}" ${attrs({ style: delay(d) })}>${inner}</g>`;

function svgDoc(card, mode) {
  const { ink, paper } = tokens.modes[mode];
  const css = [
    `.m{font-family:${tokens.font}}`,
    `text{fill:${ink}}`,
    `.ln{stroke:${ink};stroke-width:1;fill:none}`,
    `.ink{fill:${ink}}`,
    `.stroke{stroke:${ink};fill:none}`,
    `.outline{stroke:${ink}}`,
    `text.paper{fill:${paper}}`,
    '.pop{transform-box:fill-box;transform-origin:center;opacity:0;animation:pop .5s cubic-bezier(.2,1.4,.4,1) forwards}',
    '@keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}',
    '.draw{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1.4s cubic-bezier(.6,0,.2,1) forwards}',
    '@keyframes draw{to{stroke-dashoffset:0}}',
    '.rise{opacity:0;animation:rise .8s cubic-bezier(.2,.7,.2,1) forwards}',
    '@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}',
    '.fade{opacity:0;animation:fade .7s ease forwards}',
    '@keyframes fade{to{opacity:1}}',
    '.pulse{animation:pulse 2.4s ease-in-out infinite}',
    '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}',
    '.ring{transform-box:fill-box;transform-origin:center;animation:ring 2.4s ease-out infinite}',
    '@keyframes ring{0%{transform:scale(.4);opacity:.8}80%,100%{transform:scale(2.6);opacity:0}}',
    '.grow{transform-box:fill-box;transform-origin:left;transform:scaleX(0);animation:grow 1.1s cubic-bezier(.2,.7,.2,1) forwards}',
    '@keyframes grow{to{transform:scaleX(1)}}',
    '.eq{transform-box:fill-box;transform-origin:bottom;animation:eq .9s ease-in-out infinite alternate}',
    '@keyframes eq{from{transform:scaleY(.2)}to{transform:scaleY(1)}}',
    '.spin{transform-box:fill-box;transform-origin:center;animation:spin 3.2s linear infinite}',
    '@keyframes spin{to{transform:rotate(360deg)}}',
    '.blink{animation:blink 1.1s steps(1) infinite}',
    '@keyframes blink{50%{opacity:0}}',
    '.caret{animation:caret 1.1s steps(1) infinite}',
    '@keyframes caret{50%{fill-opacity:0}}',
    '.nudge{animation:nudge 1.6s ease-in-out infinite}',
    '@keyframes nudge{0%,100%{transform:translateX(0)}50%{transform:translateX(8px)}}',
    ...(card.css || []),
    '@media (prefers-reduced-motion:reduce){.draw,.rise,.fade,.pulse,.ring,.grow,.eq,.spin,.blink,.caret,.nudge,.anim,.pop{animation:none}.draw{stroke-dashoffset:0}.rise,.fade,.pop{opacity:1}.grow{transform:none}.ring{opacity:0}}',
  ].join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${card.w} ${card.h}" width="${card.w}" height="${card.h}" fill="none" role="img" aria-label="${esc(card.label)}">
  <style>
    ${css}
  </style>
  ${card.body}
</svg>
`;
}

// ─── output ──────────────────────────────────────────────────────────────────

const emitted = new Set();
function emit(name, card) {
  for (const mode of MODES) fs.writeFileSync(path.join(ASSETS, mode, `${name}.svg`), svgDoc(card, mode));
  emitted.add(name);
  return name;
}
function emitRaw(name, mode, svg) {
  fs.writeFileSync(path.join(ASSETS, mode, `${name}.svg`), svg);
  emitted.add(name);
}

const rel = (p) => path.relative(path.dirname(OUTPUT), p).split(path.sep).join('/');
const assetPath = (mode, name) => rel(path.join(ASSETS, mode, `${name}.svg`));
const picture = (light, dark, alt, w) =>
  `<picture><source media="(prefers-color-scheme: dark)" srcset="${esc(dark)}"/><img src="${esc(light)}" alt="${esc(alt)}"${w ? ` width="${w}"` : ''}/></picture>`;
const pic = (name, alt, w) => picture(assetPath('light', name), assetPath('dark', name), alt, w);
const center = (inner) => `<div align="center">\n\n${inner}\n\n</div>`;

// ─── components ──────────────────────────────────────────────────────────────

function badge(label, url) {
  const size = 11;
  const ls = 2;
  const w = Math.round(width(label, size, ls) - ls + 22);
  const h = 28;
  const name = emit(`badge-${slugify(label.replace('↗', ' ext').replace('↓', ' more')) || 'link'}`, {
    w, h, label,
    body: `<rect class="stroke" x=".5" y=".5" width="${w - 1}" height="${h - 1}"/>${text(w / 2 + ls / 2, 18.5, label, { size, ls, anchor: 'middle' })}`,
  });
  return url ? `<a href="${esc(url)}">${pic(name, label)}</a>` : pic(name, label);
}
// Inline items share one line: a newline would become <br> wherever Markdown is rendered with hard breaks.
const badgeRow = (links = []) => (links.length ? center(links.map((l) => badge(l.label, l.url)).join(' ')) : '');

function kicker(left, right) {
  checkFit('kicker', `${left}${right}`, 11, 3.5, R - L - 40);
  return group('fade', 0.1, text(L, 28, left, { size: 11, ls: 3.5 }) + text(R, 28, right, { size: 11, ls: 3.5, anchor: 'end' }))
    + line(L, 40, R, 40, { draw: true, delay: 0.1 });
}

function header(h) {
  const parts = [];
  parts.push(line(L, 58, R, 58, { draw: true, delay: 0.2 }));
  parts.push(group('fade', 0.2, text(L, 44, h.kicker, { size: 11, ls: 3.5 }) + text(R, 44, h.location, { size: 11, ls: 3.5, anchor: 'end' })));
  checkFit('header name', h.name, 72, -2, R - L);
  parts.push(group('rise', 0.5, text(L - 2, 176, h.name, { size: 72, ls: -2 })));
  checkFit('header tagline', h.tagline, 19, 0, R - L);
  parts.push(group('fade', 0.9, text(L, 214, h.tagline, { size: 19 })));
  const focusX = L + width('focus  ▸', 12.5, 1) + 24;
  checkFit('header focus', h.focus, 12.5, 1, R - focusX);
  parts.push(group('fade', 1.2, text(L, 274, 'focus  ▸', { size: 12.5, ls: 1 }) + text(focusX, 274, h.focus, { size: 12.5, ls: 1 })));
  checkFit('header status', h.status, 12.5, 1, R - L);
  // the cursor is a tspan so it follows the real text width, whatever font the viewer ends up with
  parts.push(group('fade', 1.4, text(L, 300, h.status, { size: 12.5, ls: 1 }).replace('</text>', ' <tspan class="caret">█</tspan></text>')));
  parts.push(line(L, 342, R, 342, { draw: true, delay: 1.4 }));
  let x = L;
  const strip = [];
  h.strip.forEach((item, i) => {
    if (i) {
      strip.push(text(x + 16, 374, '·', { size: 11.5, anchor: 'middle' }));
      x += 32;
    }
    strip.push(text(x, 374, item, { size: 11.5, ls: 3 }));
    x += width(item, 11.5, 3) - 3; // trailing letter-spacing is not ink
  });
  const rightW = width(h.stripRight, 11.5, 3);
  if (x > R - rightW - 24) warnings.push('header strip collides with stripRight — shorten one of them');
  strip.push(text(R, 374, h.stripRight, { size: 11.5, ls: 3, anchor: 'end' }));
  parts.push(group('fade', 1.7, strip.join('')));
  if (h.globe) parts.push(globe(h.globe));
  return { w: W, h: 400, label: `${h.name} — ${h.tagline}`, css: GLOBE_CSS, body: parts.join('\n  ') };
}

// Wireframe globe in the header: meridians sweep round (scaleX 1 → -1 → 1, staggered) over fixed parallels,
// with a pulsing pin at g.lat / g.lon (the pin sits on the front face, offset east of the centre meridian).
const GLOBE_CSS = [
  '.mer{transform-box:fill-box;transform-origin:center;animation:mer 9s linear infinite}',
  // scaleX follows cos(angle), so evenly staggered meridians stay evenly spaced like a real rotating sphere
  `@keyframes mer{${Array.from({ length: 17 }, (_, k) => `${((k / 16) * 100).toFixed(2)}%{transform:scaleX(${Math.cos((2 * Math.PI * k) / 16).toFixed(3)})}`).join('')}}`,
];
function globe(g) {
  const [cx, cy, r] = [872, 196, 74];
  const rad = (d) => (d * Math.PI) / 180;
  const soft = tokens.tones.softRule;
  const parts = [`<circle class="stroke" cx="${cx}" cy="${cy}" r="${r}"/>`];
  for (const lat of [-60, -30, 0, 30, 60]) {
    const y = cy - r * Math.sin(rad(lat));
    const half = r * Math.cos(rad(lat));
    parts.push(line(cx - half, y, cx + half, y, { op: lat ? soft * 0.6 : soft }));
  }
  const n = 6;
  for (let i = 0; i < n; i++) {
    // the inline transform is the resting pose shown when motion is reduced; the animation overrides it otherwise
    const rest = Math.cos((Math.PI * i) / n).toFixed(3);
    parts.push(`<ellipse class="stroke mer anim" cx="${cx}" cy="${cy}" rx="${r}" ry="${r}" opacity="${soft}" style="transform:scaleX(${rest});animation-delay:-${((4.5 / n) * i).toFixed(2)}s"/>`);
  }
  const px = cx + r * Math.cos(rad(g.lat)) * Math.sin(rad(25));
  const py = cy - r * Math.sin(rad(g.lat));
  parts.push(`<circle class="stroke ring" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5"/><circle class="ink pulse" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5"/>`);
  parts.push(line(px + 5, py - 5, R - 4, cy - r - 4, { op: soft }));
  parts.push(text(R, cy - r - 12, g.label, { size: 10, ls: 2, anchor: 'end' }));
  parts.push(text(R, cy + r + 22, `${g.lat.toFixed(2)}° N · ${g.lon.toFixed(2)}° E`, { size: 10, ls: 2, anchor: 'end', op: 0.6 }));
  return group('fade', 1, parts.join(''));
}

function divider(num, title) {
  const n = pad2(num);
  const p = `~/${n}-${slugify(title)}`;
  const x1 = 128 + width(title, 14, 6) + 24;
  const x2 = R - 14 - width(p, 11, 2) - 24;
  if (x2 - x1 < 40) warnings.push(`divider ${n}: title "${title}" is too long`);
  // a node rides the leading edge of the rule as it draws, and comes to rest at its end
  const run = (x2 - x1).toFixed(1);
  return {
    w: W, h: 92, label: `Section ${n} — ${title}`,
    css: [
      '.spark{animation:spark 1.4s cubic-bezier(.6,0,.2,1) .2s both}',
      `@keyframes spark{from{transform:translateX(-${run}px)}to{transform:translateX(0)}}`,
    ],
    body: group('fade', 0.1, text(L, 68, n, { size: 52 }) + text(128, 58, title, { size: 14, ls: 6 }) + text(R - 14, 58, p, { size: 11, ls: 2, anchor: 'end' }) + `<rect class="ink blink" x="${R - 7}" y="48" width="7" height="12"/>`)
      + line(x1, 53, x2, 53, { draw: true, delay: 0.2 })
      + `<circle class="stroke" cx="${x1}" cy="53" r="3"/><rect class="ink spark anim" x="${x2 - 3}" y="50" width="6" height="6"/>`,
  };
}

// Label/value rows with an optional paragraph on top (WHOAMI, STACK, FACTS).
function rowsCard(s) {
  const parts = [];
  let y = 32;
  let d = 0.1;
  (s.bio || []).forEach((para, i) => {
    const size = i === 0 ? 16 : 15;
    for (const ln of wrap(para, size, 0, R - L)) {
      parts.push(group('rise', d, text(L, y, ln, { size })));
      y += 26;
    }
    y += 6;
    d += 0.08;
  });
  const rows = s.rows || [];
  if (s.bio?.length && rows.length) {
    parts.push(line(L, y - 4, R, y - 4, { op: tokens.tones.softRule, draw: true, delay: d }));
    y += 32;
  }
  if (rows.length) {
    const labelW = Math.max(...rows.map(([k]) => width(k, 11, 2.5)));
    const vx = Math.max(154, Math.round(L + labelW + 34));
    if (s.rule) parts.push(line(vx - 16, y - 24, vx - 16, y + rows.length * 34 - 22, { op: tokens.tones.softRule * 0.8 }));
    for (const [k, v] of rows) {
      const lines = wrap(v, 15, 0, R - vx);
      let inner = text(L, y, k, { size: 11, ls: 2.5 });
      lines.forEach((ln, j) => (inner += text(vx, y + j * 22, ln, { size: 15 })));
      parts.push(group('rise', d, inner));
      y += 34 + (lines.length - 1) * 22;
      d += 0.08;
    }
    y -= 34;
  } else y -= 26;
  return { w: W, h: Math.round(y + 22), label: s.alt, body: parts.join('\n  ') };
}

// Numbered list with a right-hand meta column (WRITING, ACTIVITY).
function listCard(kick, fig, items, alt) {
  const parts = [kicker(kick, fig)];
  let y = 78;
  if (!items.length) {
    parts.push(group('rise', 0.2, text(L, y, '— nothing to show yet —', { size: 15 })));
    y += 10;
  }
  const metaW = Math.max(0, ...items.map((it) => width(it.meta || '', 11, 2)));
  const tx = 130;
  const maxW = R - tx - (metaW ? metaW + 28 : 0);
  items.forEach((it, i) => {
    const lines = wrap(it.title, 15, 0, maxW);
    let inner = text(L, y, `Nº ${pad2(i + 1)}`, { size: 11, ls: 2.5 });
    lines.forEach((ln, j) => (inner += text(tx, y + j * 22, ln, { size: 15 })));
    if (it.meta) inner += text(R, y, it.meta, { size: 11, ls: 2, anchor: 'end' });
    parts.push(group('rise', 0.2 + i * 0.08, inner));
    y += lines.length * 22;
    if (i < items.length - 1) {
      parts.push(line(L, y - 6, R, y - 6, { op: tokens.tones.softRule * 0.5 }));
      y += 18;
    }
  });
  return { w: W, h: Math.round(y + 4), label: alt, body: parts.join('\n  ') };
}

const monthYear = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const GAP = 48; // gutter between the two columns of a grid card
const COL = (R - L - GAP) / 2;
const colX = (c) => L + c * (COL + GAP);

// Two-column grid of labelled notes (CURRENTLY). item = { label, text, note?, live? } — live adds the pulse dot.
function currentlyCard(s, fig) {
  const parts = [kicker(s.kicker, s.updated ? `${fig} · UPDATED ${s.updated}` : fig)];
  let y = 84;
  for (let r = 0; r < s.items.length; r += 2) {
    const row = s.items.slice(r, r + 2).map((it) => ({ ...it, lines: wrap(it.text, 15, 0, COL) }));
    const n = Math.max(...row.map((it) => it.lines.length));
    if (r) parts.push(line(L, y - 26, R, y - 26, { op: tokens.tones.softRule * 0.5 }));
    row.forEach((it, c) => {
      const x = colX(c);
      let inner = text(x, y, pad2(r + c + 1), { size: 11, ls: 2.5, op: 0.6 });
      const lx = x + 34;
      if (it.live) inner += `<circle class="stroke ring" cx="${lx + 4}" cy="${y - 4}" r="4"/><circle class="ink pulse" cx="${lx + 4}" cy="${y - 4}" r="3"/>`;
      inner += text(it.live ? lx + 16 : lx, y, it.label, { size: 11, ls: 3 });
      it.lines.forEach((ln, j) => (inner += text(x, y + 30 + j * 22, ln, { size: 15 })));
      if (it.note) inner += text(x, y + 30 + it.lines.length * 22 + 2, truncate(it.note.toUpperCase(), 10, 2, COL), { size: 10, ls: 2, op: 0.6 });
      parts.push(group('rise', 0.2 + (r + c) * 0.08, inner));
    });
    const hasNote = row.some((it) => it.note);
    if (row.length === 2) parts.push(line(L + COL + GAP / 2, y - 14, L + COL + GAP / 2, y + 16 + n * 22 + (hasNote ? 18 : 0), { op: tokens.tones.softRule * 0.5 }));
    y += 30 + n * 22 + (hasNote ? 22 : 0) + 44;
  }
  return { w: W, h: Math.round(y - 44 + 6), label: s.alt, body: parts.join('\n  ') };
}

// Featured projects as a two-column grid. p = { name, note, tags, stars, forks, pushed, demo }.
function projectsCard(s, fig, projects) {
  const parts = [kicker(s.kicker, fig)];
  let y = 70;
  for (let r = 0; r < projects.length; r += 2) {
    const row = projects.slice(r, r + 2).map((p) => {
      const all = wrap(p.note, 14, 0, COL);
      const lines = all.slice(0, 3);
      if (all.length > 3) lines[2] = truncate(`${lines[2]}…`, 14, 0, COL);
      return { ...p, lines };
    });
    const n = Math.max(...row.map((p) => p.lines.length));
    if (r) parts.push(line(L, y - 22, R, y - 22, { op: tokens.tones.softRule * 0.5 }));
    row.forEach((p, c) => {
      const x = colX(c);
      const right = x + COL;
      let inner = text(x, y + 12, `Nº ${pad2(r + c + 1)}`, { size: 11, ls: 2.5 });
      inner += text(right, y + 12, `★ ${p.stars}  ·  ${p.forks} FORKS`, { size: 11, ls: 2, anchor: 'end' });
      inner += text(x, y + 48, truncate(p.name, 24, -0.5, COL), { size: 24, ls: -0.5 });
      p.lines.forEach((ln, j) => (inner += text(x, y + 78 + j * 21, ln, { size: 14 })));
      const ty = y + 78 + n * 21 + 10;
      inner += text(x, ty, truncate(p.tags.join(' · ').toUpperCase(), 10, 2, COL), { size: 10, ls: 2, op: 0.6 });
      inner += line(x, ty + 14, right, ty + 14, { op: tokens.tones.softRule * 0.5 });
      inner += text(x, ty + 34, p.pushed ? `UPDATED ${monthYear(p.pushed)}` : '', { size: 10, ls: 2 });
      inner += text(right, ty + 34, p.demo ? 'LIVE DEMO ↗' : 'SOURCE ↗', { size: 10, ls: 2, anchor: 'end' });
      parts.push(group('rise', 0.2 + (r + c) * 0.1, inner));
    });
    if (row.length === 2) parts.push(line(L + COL + GAP / 2, y, L + COL + GAP / 2, y + 78 + n * 21 + 44, { op: tokens.tones.softRule * 0.5 }));
    y += 78 + n * 21 + 44 + 48;
  }
  return { w: W, h: Math.round(y - 48 + 10), label: s.alt, body: parts.join('\n  ') };
}

// Published packages with live version and 30-day downloads. p = { registry, name, note, version, downloads }.
function packagesCard(s, fig, pkgs) {
  const total = pkgs.reduce((a, p) => a + (p.downloads || 0), 0);
  const parts = [kicker(`${s.kicker} — ${total} DOWNLOADS / 30 DAYS`, fig)];
  const max = Math.max(1, ...pkgs.map((p) => p.downloads || 0));
  const tagW = 56;
  const nx = 118 + tagW + 22;
  const bw = 120;
  const bx = R - bw;
  let y = 82;
  pkgs.forEach((p, i) => {
    const tag = p.registry.toUpperCase();
    let inner = text(L, y, `Nº ${pad2(i + 1)}`, { size: 11, ls: 2.5 });
    inner += `<rect class="stroke" x="118.5" y="${y - 14.5}" width="${tagW}" height="20"/>` + text(118 + tagW / 2 + 1, y, tag, { size: 10, ls: 2, anchor: 'middle' });
    inner += text(nx, y, p.name, { size: 16 });
    inner += text(nx + width(p.name, 16) + 14, y, p.version ? `v${p.version}` : '', { size: 10, ls: 2, op: 0.6 });
    inner += text(nx, y + 22, truncate(p.note, 12, 0, bx - nx - 32), { size: 12, op: 0.7 });
    const fw = Math.max(2, Math.round(((p.downloads || 0) / max) * bw));
    inner += text(R, y, p.downloads == null ? '—' : String(p.downloads), { size: 18, anchor: 'end' });
    inner += `<rect class="ink" opacity="${tokens.tones.track}" x="${bx}" y="${y + 14}" width="${bw}" height="4"/>`
      + `<rect class="ink grow" style="animation-delay:${0.4 + i * 0.1}s" x="${bx}" y="${y + 14}" width="${fw}" height="4"/>`;
    parts.push(group('rise', 0.2 + i * 0.08, inner));
    y += 42;
    if (i < pkgs.length - 1) {
      parts.push(line(L, y - 4, R, y - 4, { op: tokens.tones.softRule * 0.5 }));
      y += 28;
    }
  });
  return { w: W, h: Math.round(y - 12), label: `${s.alt} — ${total} downloads in the last 30 days`, body: parts.join('\n  ') };
}

// Tech stack as chip rows: core tools are solid ink with paper text, the rest outlined. Chips pop in one by one.
// row = { label, core: [...], more: [...] }
function stackCard(s, fig) {
  const parts = [kicker(s.kicker, fig)];
  const legend = group('fade', 0.3,
    `<rect class="ink" x="${R - 250}" y="57" width="10" height="10"/>` + text(R - 234, 66, 'CORE', { size: 10, ls: 2 })
    + `<rect class="stroke" x="${R - 160.5}" y="57.5" width="9" height="9"/>` + text(R - 144, 66, 'ALSO USE', { size: 10, ls: 2 }));
  parts.push(legend);
  const cx0 = 214; // chips start here; the label column sits left of it
  const H = 30;
  const gap = 10;
  let y = 96;
  let k = 0;
  s.rows.forEach((row, i) => {
    const chips = [...(row.core || []).map((t) => [t, true]), ...(row.more || []).map((t) => [t, false])];
    let x = cx0;
    let top = y;
    const inner = [text(L, top + 20, pad2(i + 1), { size: 11, ls: 2.5, op: 0.6 }), text(L + 34, top + 20, row.label, { size: 11, ls: 3 }),
      text(L + 34, top + 38, `${chips.length} TOOL${chips.length === 1 ? '' : 'S'}`, { size: 9, ls: 2, op: 0.5 })];
    chips.forEach(([t, core]) => {
      const w = Math.round(width(t, 13, 0.5) + 26);
      if (x + w > R) {
        x = cx0;
        top += H + gap;
      }
      const d = (0.25 + k++ * 0.035).toFixed(3);
      const box = core ? `<rect class="ink" x="${x}" y="${top}" width="${w}" height="${H}"/>` : `<rect class="stroke" x="${x + 0.5}" y="${top + 0.5}" width="${w - 1}" height="${H - 1}"/>`;
      inner.push(`<g class="pop" style="animation-delay:${d}s">${box}${text(x + w / 2, top + 20, t, { size: 13, ls: 0.5, anchor: 'middle', cls: core ? 'paper' : '' })}</g>`);
      x += w + gap;
    });
    parts.push(group('fade', 0.15 + i * 0.06, inner.join('')));
    y = top + H + 26;
    if (i < s.rows.length - 1) parts.push(line(L, y - 13, R, y - 13, { op: tokens.tones.softRule * 0.4 }));
  });
  const all = s.rows.flatMap((r) => [...(r.core || []), ...(r.more || [])]);
  return { w: W, h: y - 14, label: `${s.alt}: ${all.join(', ')}`, body: parts.join('\n  ') };
}

// Facts as a terminal session: each line types itself out (a stepped clip reveal), dotted leaders join key and value.
function terminalCard(s, fig) {
  const parts = [];
  const top = 12;
  const bar = 36;
  const LH = 34;
  const keyW = Math.max(...s.rows.map(([k]) => width(k, 11, 3)));
  const vx = Math.max(266, Math.round(L + 46 + keyW + 60));
  const lines = [];
  lines.push({ prompt: true, body: text(L + 40, 0, s.command, { size: 14 }) });
  s.rows.forEach(([k, v]) => lines.push({
    chars: k.length + v.length,
    body: text(L + 40, 0, k, { size: 11, ls: 3 })
      + `<line class="ln" x1="${L + 48 + keyW}" y1="-4" x2="${vx - 14}" y2="-4" stroke-dasharray="1 5" opacity="${tokens.tones.softRule}"/>`
      + text(vx, 0, truncate(v, 15, 0, R - 24 - vx), { size: 15 }),
  }));
  const css = [
    '.type{transform-box:fill-box;transform-origin:left;transform:scaleX(0);animation-name:type;animation-fill-mode:forwards}',
    '@keyframes type{to{transform:scaleX(1)}}',
    '@media (prefers-reduced-motion:reduce){.type{animation:none;transform:none}}',
  ];
  let y = top + bar + 38;
  let t = 0.5;
  lines.forEach((ln, i) => {
    const dur = ln.prompt ? 0.9 : 0.55;
    const steps = ln.prompt ? s.command.length : Math.min(28, ln.chars);
    parts.push(`<clipPath id="ty${i}"><rect class="type" x="${L + 4}" y="${y - 22}" width="${R - L - 8}" height="${LH}" style="animation-duration:${dur}s;animation-timing-function:steps(${steps});animation-delay:${t.toFixed(2)}s"/></clipPath>`);
    const prompt = ln.prompt ? text(L + 20, y, '$', { size: 14, op: 0.6 }) : '';
    parts.push(`<g clip-path="url(#ty${i})"><g transform="translate(0 ${y})">${ln.body}</g>${prompt}</g>`);
    t += dur + (ln.prompt ? 0.3 : 0.12);
    y += i === 0 ? LH + 10 : LH;
  });
  // closing prompt with a blinking caret
  parts.push(group('fade', t, text(L + 20, y, '$', { size: 14, op: 0.6 }) + `<rect class="ink blink" x="${L + 40}" y="${y - 13}" width="8" height="15"/>`));
  const h = y + 30;
  const frame = [
    `<rect class="stroke" x="${L + 0.5}" y="${top + 0.5}" width="${R - L - 1}" height="${h - top - 12}"/>`,
    line(L, top + bar, R, top + bar, { op: tokens.tones.softRule }),
    ...[0, 1, 2].map((j) => `<circle class="${j ? 'stroke' : 'ink'}" cx="${L + 20 + j * 18}" cy="${top + bar / 2}" r="5"/>`),
    text(W / 2, top + bar / 2 + 4, s.title, { size: 11, ls: 2, anchor: 'middle', op: 0.7 }),
    text(R - 16, top + bar / 2 + 4, fig, { size: 10, ls: 2, anchor: 'end', op: 0.6 }),
  ];
  return { w: W, h, css, label: `${s.alt}: ${s.rows.map(([k, v]) => `${k} — ${v}`).join('; ')}`, body: [...frame, ...parts].join('\n  ') };
}

// Endless keyword marquee under the header; edges fade out through a luminance mask.
function tickerCard(t) {
  const sep = '   /   ';
  const seq = t.items.map((x) => x.toUpperCase()).join(sep) + sep;
  const sw = width(seq, 13, 4);
  const reps = Math.ceil((2 * W) / sw) + 1;
  const h = 52;
  return {
    w: W, h, label: t.items.join(' · '),
    css: [`.marquee{animation:marquee ${Math.round(sw / (t.speed || 45))}s linear infinite}`, `@keyframes marquee{to{transform:translateX(-${sw.toFixed(1)}px)}}`],
    body: [
      '<defs><linearGradient id="edge"><stop offset="0" stop-color="#000"/><stop offset=".08" stop-color="#fff"/><stop offset=".92" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>'
        + `<mask id="fade"><rect width="${W}" height="${h}" fill="url(#edge)"/></mask></defs>`,
      line(0, 0.5, W, 0.5, { op: tokens.tones.softRule, draw: true }),
      `<g mask="url(#fade)"><g class="marquee anim">${text(0, 31, seq.repeat(reps), { size: 13, ls: 4 })}</g></g>`,
      line(0, h - 0.5, W, h - 0.5, { op: tokens.tones.softRule, draw: true, delay: 0.2 }),
    ].join('\n  '),
  };
}

// Big numbers that roll into place like an odometer. item = { label, value, caption }.
function glanceCard(s, fig, items) {
  const parts = [kicker(s.kicker, fig)];
  const css = ['.odo{animation-duration:1.8s;animation-timing-function:cubic-bezier(.2,.7,.1,1);animation-fill-mode:both}'];
  const LH = 56; // spacing of the stacked digits
  const size = 40;
  const base = 132;
  const colW = (R - L) / items.length;
  for (let d = 1; d <= 9; d++) css.push(`.odo${d}{animation-name:odo${d}}`, `@keyframes odo${d}{from{transform:translateY(${d * LH}px)}to{transform:translateY(0)}}`);
  items.forEach((it, i) => {
    const x = L + i * colW;
    const pad = i ? 20 : 0;
    let inner = text(x + pad, 78, truncate(it.label, 11, 2.5, colW - pad - 12), { size: 11, ls: 2.5 });
    parts.push(`<clipPath id="odo-${i}"><rect x="${x + pad - 2}" y="${base - size}" width="${colW - pad}" height="${size + 14}"/></clipPath>`);
    let digits = '';
    [...String(it.value)].forEach((ch, k) => {
      const cx = x + pad + k * size * tokens.charWidth;
      if (!/\d/.test(ch)) return void (digits += text(cx, base, ch, { size }));
      const dd = +ch;
      const col = Array.from({ length: 10 }, (_, n) => text(cx, base + (n - dd) * LH, String(n), { size })).join('');
      digits += `<g class="anim odo odo${dd}" style="animation-delay:${(0.3 + i * 0.12 + k * 0.08).toFixed(2)}s">${col}</g>`;
    });
    inner += `<g clip-path="url(#odo-${i})">${digits}</g>`;
    if (it.caption) inner += text(x + pad, base + 30, truncate(it.caption, 10, 2, colW - pad - 12), { size: 10, ls: 2, op: 0.6 });
    parts.push(group('fade', 0.2 + i * 0.08, inner));
    if (i) parts.push(line(x, 62, x, base + 36, { op: tokens.tones.softRule * 0.5, draw: true, delay: 0.3 + i * 0.1 }));
  });
  return { w: W, h: base + 50, label: `${s.alt}: ${items.map((it) => `${it.value} ${it.label.toLowerCase()}`).join(', ')}`, css, body: parts.join('\n  ') };
}

// Closing call to action: headline, a line of copy, availability and the e-mail with a nudging arrow.
function contactCard(s, fig) {
  const parts = [kicker(s.kicker, fig)];
  let y = 104;
  wrap(s.headline, 44, -1.5, R - L).forEach((ln, i) => {
    parts.push(group('rise', 0.2 + i * 0.1, text(L - 2, y, ln, { size: 44, ls: -1.5 })));
    y += 52;
  });
  for (const ln of wrap(s.text, 16, 0, R - L)) {
    parts.push(group('fade', 0.5, text(L, y, ln, { size: 16 })));
    y += 26;
  }
  y += 22;
  parts.push(line(L, y - 22, R, y - 22, { op: tokens.tones.softRule, draw: true, delay: 0.6 }));
  y += 14;
  parts.push(group('fade', 0.8, `<circle class="stroke ring" cx="${L + 5}" cy="${y - 4}" r="5"/><circle class="ink pulse" cx="${L + 5}" cy="${y - 4}" r="4"/>` + text(L + 24, y, s.status, { size: 11, ls: 3 })));
  parts.push(group('fade', 0.9, text(R - 34, y + 1, s.email, { size: 18, anchor: 'end' })
    + `<g class="nudge"><path class="ln" stroke-width="1.5" d="M${R - 24} ${y - 5} H${R - 2} M${R - 9} ${y - 12} L${R - 2} ${y - 5} L${R - 9} ${y + 2}"/></g>`));
  return { w: W, h: y + 26, label: `${s.headline} ${s.text} ${s.email}`, body: parts.join('\n  ') };
}

function routeCard(s, fig) {
  const parts = [kicker(s.kicker, fig)];
  const tx = 150;
  let y = 80;
  const dots = [];
  s.items.forEach((it, i) => {
    const marker = it.link ? 'LINK ↗' : '';
    const lines = wrap(it.text, 15, 0, R - tx - (marker ? width(marker, 10, 2) + 28 : 0));
    const last = i === s.items.length - 1;
    dots.push(y - 5);
    let inner = last
      ? `<circle class="stroke ring" cx="60" cy="${y - 5}" r="5"/><circle class="ink pulse" cx="60" cy="${y - 5}" r="4"/>`
      : `<circle class="ink" cx="60" cy="${y - 5}" r="4"/>`;
    inner += text(84, y, `Nº ${pad2(i + 1)}`, { size: 11, ls: 2.5 });
    lines.forEach((ln, j) => (inner += text(tx, y + j * 22, ln, { size: 15 })));
    if (marker) inner += text(R, y, marker, { size: 10, ls: 2, anchor: 'end' });
    parts.push(group('rise', 0.2 + i * 0.1, inner));
    y += lines.length * 22 + 20;
  });
  parts.splice(1, 0, line(60, dots[0], 60, dots[dots.length - 1], { op: tokens.tones.softRule, draw: true, delay: 0.2 }));
  return { w: W, h: Math.round(y - 14), label: s.alt, body: parts.join('\n  ') };
}

function telemetryCard(days, fig) {
  const parts = [kicker('CONTRIBUTION TELEMETRY', fig)];
  if (!days.length) {
    parts.push(text(L, 80, '— contribution data unavailable —', { size: 15 }));
    return { w: W, h: 100, label: 'Contribution telemetry', body: parts.join('') };
  }
  const total = days.reduce((a, d) => a + d.count, 0);
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  let i = days.length - 1;
  if (!days[i].count) i--; // today may not have a contribution yet
  for (; i >= 0 && days[i].count; i--) current++;
  const best = days.reduce((a, d) => (d.count > a.count ? d : a), days[0]);
  const fmt = (iso) => {
    const [yy, mm, dd] = iso.split('-');
    return `${dd} ${MONTHS[+mm - 1]} ${yy}`;
  };
  const stats = [
    ['LAST 12 MONTHS', String(total)],
    ['CURRENT STREAK', `${current}d`],
    ['LONGEST STREAK', `${longest}d`],
    ['BEST DAY', best.count ? `${best.count} · ${fmt(best.date)}` : '—'],
  ];
  const colW = (R - L) / stats.length;
  stats.forEach(([k, v], j) => {
    const x = L + j * colW;
    parts.push(group('rise', 0.2 + j * 0.08, text(x, 76, k, { size: 11, ls: 2.5 }) + text(x, 108, v, { size: j === 3 ? 18 : 26 })));
  });

  const weeks = [];
  for (let k = 0; k < days.length; k += 7) weeks.push(days.slice(k, k + 7));
  const sums = weeks.map((w) => w.reduce((a, d) => a + d.count, 0));
  const max = Math.max(1, ...sums);
  const top = 150;
  const base = 290;
  const step = (R - L) / Math.max(1, sums.length - 1);
  const pts = sums.map((v, k) => [L + k * step, base - (v / max) * (base - top)]);
  const pathD = pts.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  parts.push(line(L, base, R, base, { op: tokens.tones.softRule }));
  parts.push(line(L, top, R, top, { op: tokens.tones.softRule * 0.4 }));
  parts.push(text(R, top - 8, `PEAK ${max} / WEEK`, { size: 10, ls: 2, anchor: 'end' }));
  parts.push(group('fade', 0.9, `<path class="ink" opacity="${tokens.tones.area}" d="${pathD} L${R} ${base} L${L} ${base} Z"/>`));
  parts.push(`<path class="ln draw" pathLength="1" stroke-width="1.5" stroke-linejoin="round" style="animation-delay:.4s;stroke-width:1.5" d="${pathD}"/>`);
  const peak = pts[sums.indexOf(max)];
  parts.push(group('fade', 1.6, `<circle class="stroke ring" cx="${peak[0].toFixed(1)}" cy="${peak[1].toFixed(1)}" r="4"/><circle class="ink" cx="${peak[0].toFixed(1)}" cy="${peak[1].toFixed(1)}" r="3"/>`));
  let lastX = -100;
  weeks.forEach((w, k) => {
    const first = w.find((d) => d.date.endsWith('-01')) || (k === 0 ? w[0] : null);
    const x = L + k * step;
    if (first && x - lastX > 48 && x < R - 20) {
      parts.push(text(x, base + 22, MONTHS[+first.date.split('-')[1] - 1], { size: 10, ls: 2, anchor: k === 0 ? 'start' : 'middle' }));
      lastX = x;
    }
  });
  return { w: W, h: base + 36, label: `Contribution telemetry — ${total} contributions in the last 12 months`, body: parts.join('\n  ') };
}

function topReposCard(repos, fig, user) {
  const parts = [kicker('TOP REPOSITORIES — BY COMMITS', fig)];
  if (!repos.length) parts.push(text(L, 80, '— repository data unavailable —', { size: 15 }));
  const max = Math.max(1, ...repos.map((r) => r.commits));
  const bx = 440;
  const bw = 420;
  repos.forEach((r, i) => {
    const y = 80 + i * 36;
    const name = r.name.startsWith(`${user}/`) ? r.name.slice(user.length + 1) : r.name;
    const fw = Math.max(2, Math.round((r.commits / max) * bw));
    parts.push(group('rise', 0.2 + i * 0.08,
      text(L, y, `Nº ${pad2(i + 1)}`, { size: 11, ls: 2.5 })
      + text(118, y, truncate(name, 14, 0, bx - 118 - 20), { size: 14 })
      + `<rect class="ink" opacity="${tokens.tones.track}" x="${bx}" y="${y - 10}" width="${bw}" height="10"/>`
      + `<rect class="ink grow" style="animation-delay:${0.4 + i * 0.1}s" x="${bx}" y="${y - 10}" width="${fw}" height="10"/>`
      + text(R, y, String(r.commits), { size: 14, anchor: 'end' })));
  });
  const h = 80 + Math.max(1, repos.length) * 36 - 14;
  return { w: W, h, label: 'Top repositories by commits', body: parts.join('\n  ') };
}

function quoteCard(s, fig, quote, author) {
  const parts = [kicker(s.kicker, fig)];
  let y = 84;
  wrap(`“${quote}”`, 20, 0, R - L).forEach((ln, i) => {
    parts.push(group('rise', 0.2 + i * 0.08, text(L, y, ln, { size: 20 })));
    y += 32;
  });
  parts.push(group('fade', 0.6, text(L, y + 2, `— ${author.toUpperCase()}`, { size: 12, ls: 3 })));
  return { w: W, h: y + 20, label: `“${quote}” — ${author}`, body: parts.join('\n  ') };
}

const clock = (ms) => `${Math.floor(ms / 60000)}:${pad2(Math.floor((ms % 60000) / 1000))}`;

// Spotify track card: greyscale cover (or a vinyl disc when there is none), status, title, artist, album, progress.
// t = { playing, title, artist, album, duration, progress?, playedAt? }, cover = data URI or null.
function nowPlayingCard(s, fig, t, cover) {
  const parts = [kicker('NOW PLAYING — SPOTIFY', fig)];
  if (!t) {
    parts.push('<circle class="stroke ring" cx="60" cy="79" r="5"/><circle class="ink pulse" cx="60" cy="79" r="4"/>');
    parts.push(group('rise', 0.3, text(82, 84, 'Offline — nothing played yet', { size: 16 })));
    parts.push(group('fade', 0.6, text(82, 106, 'THE NEXT TRACK SHOWS UP HERE AUTOMATICALLY', { size: 10, ls: 2, op: 0.6 })));
    return { w: W, h: 130, label: s.alt, body: parts.join('\n  ') };
  }
  const A = 136; // cover size
  const top = 64;
  const x0 = L + A + 32;
  const max = R - x0;
  if (cover) {
    parts.push(`<filter id="mono"><feColorMatrix type="saturate" values="0"/></filter>`);
    parts.push(group('fade', 0.2, `<image href="${cover}" x="${L}" y="${top}" width="${A}" height="${A}" preserveAspectRatio="xMidYMid slice" filter="url(#mono)"/>`
      + `<rect class="stroke" x="${L + 0.5}" y="${top + 0.5}" width="${A - 1}" height="${A - 1}"/>`));
  } else {
    const [cx, cy] = [L + A / 2, top + A / 2];
    const grooves = [60, 50, 40].map((r) => `<circle class="stroke" cx="${cx}" cy="${cy}" r="${r}" opacity="${r === 60 ? 1 : tokens.tones.softRule * 0.6}"/>`).join('');
    parts.push(group('fade', 0.2, `<g class="${t.playing ? 'spin' : ''}">${grooves}<circle class="ink" cx="${cx}" cy="${cy}" r="20"/>`
      + `<path class="ln" d="M${cx + 26} ${cy - 30} A40 40 0 0 1 ${cx + 38} ${cy - 12}" stroke-width="2"/><circle class="stroke" cx="${cx}" cy="${cy}" r="3"/></g>`));
  }

  let status;
  if (t.playing) {
    const bars = [0, 0.3, 0.15, 0.45, 0.6].map((d, i) => `<rect class="ink eq" x="${x0 + i * 6}" y="68" width="3" height="14" style="animation-delay:-${d}s"/>`).join('');
    status = bars + text(x0 + 40, 82, 'PLAYING NOW', { size: 11, ls: 3 });
  } else if (t.playedAt) {
    const d = new Date(Date.parse(t.playedAt) + (s.utcOffset || 0) * 3600000);
    const when = `${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}${s.tz ? ` ${s.tz}` : ''}`;
    status = text(x0, 82, `LAST PLAYED · ${when}`, { size: 11, ls: 3 });
  } else status = text(x0, 82, 'PAUSED', { size: 11, ls: 3 });
  parts.push(group('fade', 0.3, status));
  parts.push(group('rise', 0.4, text(x0, 122, truncate(t.title, 28, -0.5, max), { size: 28, ls: -0.5 })));
  parts.push(group('rise', 0.5, text(x0, 150, truncate(t.artist, 15, 0, max), { size: 15 })));
  parts.push(group('fade', 0.6, text(x0, 174, truncate(t.album.toUpperCase(), 11, 2.5, max), { size: 11, ls: 2.5, op: 0.6 })));

  const barY = 190;
  if (t.progress != null) {
    const frac = Math.min(1, t.progress / Math.max(1, t.duration));
    parts.push(`<rect class="ink" x="${x0}" y="${barY}" width="${max}" height="2" opacity="${tokens.tones.track}"/>`);
    parts.push(`<rect class="ink grow" x="${x0}" y="${barY}" width="${(max * frac).toFixed(1)}" height="2" style="animation-delay:.6s"/>`);
    parts.push(group('fade', 0.8, text(x0, barY + 20, clock(t.progress), { size: 10, ls: 2 }) + text(R, barY + 20, clock(t.duration), { size: 10, ls: 2, anchor: 'end' })));
  } else {
    parts.push(line(x0, barY + 1, R, barY + 1, { op: tokens.tones.softRule, draw: true, delay: 0.6 }));
    parts.push(group('fade', 0.8, text(R, barY + 20, clock(t.duration), { size: 10, ls: 2, anchor: 'end' })));
  }
  const label = `${t.playing ? 'Now playing' : 'Last played'} on Spotify: ${t.title} — ${t.artist}`;
  return { w: W, h: 232, label, body: parts.join('\n  ') };
}

// Sign-off: the handle is traced in outline, then fills with ink.
function signatureCard(sg) {
  const size = 112;
  const y = 128;
  const dash = Math.round(width(sg.text, size, -4) * 3); // longer than any glyph outline
  return {
    w: W, h: 196, label: `${sg.text} — ${sg.caption}`,
    css: [
      `.sig{stroke-width:1.2;fill-opacity:0;stroke-dasharray:${dash};stroke-dashoffset:${dash};animation:sig 3.2s cubic-bezier(.5,0,.2,1) .3s forwards,sigfill 1.2s ease 2.8s forwards}`,
      '@keyframes sig{to{stroke-dashoffset:0}}',
      '@keyframes sigfill{to{fill-opacity:1}}',
      '@media (prefers-reduced-motion:reduce){.sig{animation:none;stroke-dashoffset:0;fill-opacity:1}}',
    ],
    body: [
      text(W / 2, y, sg.text, { size, ls: -4, anchor: 'middle', cls: 'outline sig' }),
      line(L, y + 26, R, y + 26, { op: tokens.tones.softRule, draw: true, delay: 2.4 }),
      group('fade', 3, text(W / 2, y + 52, sg.caption, { size: 10, ls: 4, anchor: 'middle' })),
    ].join('\n  '),
  };
}

function footer(f) {
  const right = f.right.replace('{year}', new Date().getFullYear());
  const leftEnd = 82 + Math.max(width(f.status, 12, 3), width(f.note, 11, 2));
  if (leftEnd > R - width(right, 15, 0) - 24) warnings.push('footer: left and right text collide');
  return {
    w: W, h: 110, label: `${f.status}. ${right}`,
    body: [
      line(L, 24, R, 24, { draw: true }),
      '<circle class="stroke ring" cx="60" cy="64" r="5"/><circle class="ink pulse" cx="60" cy="64" r="4"/>',
      text(82, 62, f.status, { size: 12, ls: 3 }),
      text(82, 82, f.note, { size: 11, ls: 2 }),
      text(R, 68, right, { size: 15, anchor: 'end' }),
    ].join('\n  '),
  };
}

// ─── greyscale conversion for third-party SVGs ───────────────────────────────

const HEX_RE = /(?<![&\w(#])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const RGB_RE = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/g;
const NAMED_RE = /((?:fill|stroke|stop-color|color)\s*[=:]\s*["']?)(white|black|gray|grey|silver)\b/gi;
const NAMED = { white: 'ffffff', black: '000000', gray: '808080', grey: '808080', silver: 'c0c0c0' };

function parseHex(h) {
  h = h.replace('#', '');
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const rgb = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16));
  return [...rgb, h.length === 8 ? +(parseInt(h.slice(6, 8), 16) / 255).toFixed(3) : null];
}
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function monochrome(file, mode, preset) {
  let svg = fs.readFileSync(path.join(ROOT, file), 'utf8');
  svg = svg.replace(NAMED_RE, (_, pre, name) => pre + '#' + NAMED[name.toLowerCase()]);
  const overrides = {};
  for (const [k, v] of Object.entries(preset.overrides?.[mode] || {})) overrides[toHex(...parseHex(k))] = v;

  // strategy is one name for every colour, or { hex, rgb } to treat the two notations differently
  // (e.g. the 3D graph writes contribution blocks as rgb() and language colours as hex).
  const strategyFor = (notation) => (typeof preset.strategy === 'string' ? preset.strategy : preset.strategy[notation]);
  const seen = { ramp: [], luma: [] };
  const collect = (notation, r, g, b) => {
    const k = toHex(r, g, b);
    const list = seen[strategyFor(notation)];
    if (!(k in overrides) && !seen.ramp.includes(k) && !seen.luma.includes(k)) list.push(k);
  };
  for (const m of svg.matchAll(HEX_RE)) collect('hex', ...parseHex(m[1]));
  for (const m of svg.matchAll(RGB_RE)) collect('rgb', +m[1], +m[2], +m[3]);

  const map = {};
  const ramp = preset.ramp?.[mode] || [];
  seen.ramp.forEach((k, i) => (map[k] = ramp[i % ramp.length]));
  const ls = seen.luma.map((k) => luma(...parseHex(k)));
  const lo = Math.min(...ls);
  const hi = Math.max(...ls);
  const [a, b] = preset.range?.[mode] || [0, 255];
  seen.luma.forEach((k, i) => {
    const v = Math.round(a + (hi > lo ? (ls[i] - lo) / (hi - lo) : 0) * (b - a));
    map[k] = toHex(v, v, v);
  });
  const out = (r, g, b, alpha) => {
    const k = toHex(r, g, b);
    const c = overrides[k] ?? map[k];
    if (alpha == null || !c.startsWith('#')) return c;
    const [R2, G2, B2] = parseHex(c);
    return `rgba(${R2}, ${G2}, ${B2}, ${alpha})`;
  };
  svg = svg.replace(HEX_RE, (_, h) => out(...parseHex(h)));
  svg = svg.replace(RGB_RE, (_, r, g, b, a) => out(+r, +g, +b, a ?? null));
  if (preset.font) {
    svg = svg.replace(/font-family\s*:\s*[^;}]+/g, `font-family: ${tokens.font}`);
    svg = svg.replace(/font-family="[^"]*"/g, `font-family='${tokens.font}'`);
  }
  // currentColor resolves to the page's text colour inside <img>; pin it to the ink.
  return svg.replace(/<svg\b/, `<svg color="${tokens.modes[mode].ink}"`);
}

function monoAsset(src) {
  const preset = tokens.mono[src.preset];
  for (const mode of MODES) {
    const file = src[mode];
    if (!fs.existsSync(path.join(ROOT, file))) {
      warnings.push(`missing source ${file}`);
      return null;
    }
    emitRaw(src.name, mode, monochrome(file, mode, preset));
  }
  return pic(src.name, src.alt, src.width);
}

// ─── live data ───────────────────────────────────────────────────────────────

async function get(url, json = false) {
  const headers = { 'User-Agent': `${profile.user}-readme-theme` };
  if (url.includes('api.github.com')) {
    headers.Accept = 'application/vnd.github+json';
    if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return json ? res.json() : res.text();
}

const fetched = {}; // one fetch per key per run, shared by every section that needs it
async function live(key, fn) {
  if (OFFLINE) return cache[key];
  if (!(key in fetched)) fetched[key] = await fetchLive(key, fn);
  return fetched[key];
}

async function fetchLive(key, fn) {
  try {
    const value = await fn();
    if (value && (!Array.isArray(value) || value.length)) {
      cache[key] = value;
      return value;
    }
    warnings.push(`${key}: empty response, using cache`);
  } catch (e) {
    warnings.push(`${key}: ${e.message} — using cache`);
  }
  return cache[key];
}

// Current (or else last) Spotify track via the Web API. Needs SPOTIFY_CLIENT_ID / _SECRET / _REFRESH_TOKEN;
// get the refresh token once with `node theme/spotify-auth.js`.
async function fetchSpotify() {
  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret, SPOTIFY_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !secret || !refresh) throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REFRESH_TOKEN not set');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`token refresh ${res.status} ${await res.text()}`);
  const { access_token: token } = await res.json();
  const api = async (p) => {
    const r = await fetch(`https://api.spotify.com/v1/${p}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    if (r.status === 204) return null;
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${p}`);
    return r.json();
  };
  const track = (it) => {
    const ep = it.type === 'episode';
    const images = (ep ? it.images : it.album.images) || [];
    return {
      title: it.name,
      artist: ep ? it.show.name : it.artists.map((a) => a.name).join(', '),
      album: ep ? 'Podcast' : it.album.name,
      duration: it.duration_ms,
      cover: (images.find((im) => im.width && im.width <= 320) || images[0])?.url || null,
    };
  };
  const now = await api('me/player/currently-playing?additional_types=episode');
  if (now?.item) return { playing: now.is_playing, progress: now.progress_ms, ...track(now.item) };
  const last = (await api('me/player/recently-played?limit=1'))?.items?.[0];
  return last ? { playing: false, playedAt: last.played_at, ...track(last.track) } : null;
}

async function coverData(url) {
  if (OFFLINE || !url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return `data:${res.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  } catch (e) {
    warnings.push(`spotify cover: ${e.message} — drawing vinyl instead`);
    return null;
  }
}

async function fetchCalendar(user) {
  const html = await get(`https://github.com/users/${user}/contributions`);
  const tips = {};
  for (const m of html.matchAll(/<tool-tip\b[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) tips[m[1]] = m[2];
  const days = [];
  for (const m of html.matchAll(/<td\b[^>]*\bdata-date="[^"]*"[^>]*>/g)) {
    const tag = m[0];
    const date = /data-date="([\d-]+)"/.exec(tag)[1];
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    const n = /^([\d,]+) contributions?/.exec(tips[id] || '');
    days.push({ date, count: n ? +n[1].replace(/,/g, '') : 0 });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchTopRepos(user, exclude, limit) {
  const q = encodeURIComponent([`author:${user}`, ...exclude.map((r) => `-repo:${r}`)].join(' '));
  const counts = {};
  for (let page = 1; page <= 10; page++) {
    let j;
    try {
      j = await get(`https://api.github.com/search/commits?q=${q}&per_page=100&page=${page}`, true);
    } catch (e) {
      if (page === 1) throw e;
      break; // rate limited part-way: rank what we have
    }
    for (const it of j.items || []) counts[it.repository.full_name] = (counts[it.repository.full_name] || 0) + 1;
    if (!j.items || j.items.length < 100) break;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, commits]) => ({ name, commits }));
}

// Account-wide numbers for AT A GLANCE.
async function fetchGlance(user) {
  const u = await get(`https://api.github.com/users/${user}`, true);
  const repos = await get(`https://api.github.com/users/${user}/repos?per_page=100&type=owner`, true);
  const own = repos.filter((r) => !r.fork);
  return {
    created: u.created_at, followers: u.followers, repos: u.public_repos,
    stars: own.reduce((a, r) => a + r.stargazers_count, 0), forks: own.reduce((a, r) => a + r.forks_count, 0),
  };
}

// Live repo facts for the featured projects; text (name, note, tags) comes from profile.json when given.
async function fetchProjects(user, items) {
  return Promise.all(items.map(async (it) => {
    const full = it.repo.includes('/') ? it.repo : `${user}/${it.repo}`;
    const r = await get(`https://api.github.com/repos/${full}`, true);
    return {
      repo: full, stars: r.stargazers_count, forks: r.forks_count, pushed: r.pushed_at, language: r.language,
      description: r.description || '', homepage: r.homepage || '',
    };
  }));
}

// Version + last-30-day downloads from PyPI (pypistats.org) or npm.
async function fetchPackages(items) {
  return Promise.all(items.map(async (it) => {
    if (it.registry === 'pypi') {
      const [info, stats] = await Promise.all([get(`https://pypi.org/pypi/${it.name}/json`, true), get(`https://pypistats.org/api/packages/${it.name.toLowerCase()}/recent`, true)]);
      return { name: it.name, version: info.info.version, summary: info.info.summary || '', downloads: stats.data.last_month };
    }
    if (it.registry === 'npm') {
      const [info, stats] = await Promise.all([get(`https://registry.npmjs.org/${it.name}/latest`, true), get(`https://api.npmjs.org/downloads/point/last-month/${it.name}`, true)]);
      return { name: it.name, version: info.version, summary: info.description || '', downloads: stats.downloads };
    }
    throw new Error(`unknown registry "${it.registry}" for ${it.name}`);
  }));
}

const PACKAGE_URL = { pypi: (n) => `https://pypi.org/project/${n}/`, npm: (n) => `https://www.npmjs.com/package/${n}` };

const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

async function fetchPosts(feed, max) {
  const xml = await get(feed);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, max).map(([, item]) => {
    const tag = (t) => decode((new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(item) || [])[1] || '');
    return { title: tag('title'), url: tag('link'), date: new Date(tag('pubDate')).toISOString().slice(0, 10) };
  });
}

function eventEntry(e) {
  const repo = e.repo.name;
  const p = e.payload || {};
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const gh = `https://github.com/${repo}`;
  switch (e.type) {
    case 'PullRequestEvent': {
      const pr = p.pull_request || {};
      const action = p.action === 'closed' && pr.merged ? 'merged' : p.action;
      return { kind: 'PULL REQUEST', text: `${cap(action)} PR #${p.number ?? pr.number} in ${repo}`, url: pr.html_url || `${gh}/pull/${p.number}` };
    }
    case 'IssuesEvent':
      return { kind: 'ISSUE', text: `${cap(p.action)} issue #${p.issue.number} in ${repo}`, url: p.issue.html_url };
    case 'IssueCommentEvent':
      return { kind: 'COMMENT', text: `Commented on #${p.issue.number} in ${repo}`, url: p.comment?.html_url || p.issue.html_url };
    case 'PullRequestReviewEvent':
      return { kind: 'REVIEW', text: `Reviewed PR #${p.pull_request.number} in ${repo}`, url: p.review?.html_url || p.pull_request.html_url };
    case 'CreateEvent':
      return { kind: 'CREATE', text: p.ref_type === 'repository' ? `Created repository ${repo}` : `Created ${p.ref_type} ${p.ref} in ${repo}`, url: gh };
    case 'ReleaseEvent':
      return { kind: 'RELEASE', text: `Released ${p.release?.tag_name || ''} in ${repo}`.replace('  ', ' '), url: p.release?.html_url || `${gh}/releases` };
    case 'ForkEvent':
      return { kind: 'FORK', text: `Forked ${repo}`, url: p.forkee?.html_url || gh };
    case 'PushEvent': {
      const n = p.size ?? p.commits?.length;
      return { kind: 'PUSH', text: n ? `Pushed ${n} commit${n === 1 ? '' : 's'} to ${repo}` : `Pushed to ${repo}`, url: `${gh}/commits` };
    }
    default:
      return null;
  }
}

async function fetchActivity(user, s) {
  const events = await get(`https://api.github.com/users/${user}/events/public?per_page=100`, true);
  const fresh = events
    .filter((e) => s.events.includes(e.type) && !(s.excludeRepos || []).includes(e.repo.name))
    .map((e) => {
      const entry = eventEntry(e);
      return entry && { id: e.id, repo: e.repo.name, ...entry };
    })
    .filter(Boolean);
  const old = cache.activity || [];
  const merged = [...fresh, ...old.filter((o) => !fresh.some((f) => f.id === o.id))];
  return merged.slice(0, s.max);
}

// ─── sections ────────────────────────────────────────────────────────────────

async function renderSection(s, num) {
  const out = [pic(emit(`s${pad2(num)}`, divider(num, s.title)), `${pad2(num)} — ${s.title}`)];
  let k = 0;
  const fig = () => `FIG. ${pad2(num)}.${++k}`;
  const name = slugify(s.title);
  const user = profile.user;

  switch (s.type) {
    case 'card':
      out.push(pic(emit(name, rowsCard(s)), s.alt));
      break;
    case 'writing': {
      const posts = (await live('posts', () => fetchPosts(s.feed, s.max))) || [];
      const fmt = (iso) => `${iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
      out.push(pic(emit(name, listCard(s.kicker, fig(), posts.map((p) => ({ title: p.title, meta: fmt(p.date) })), s.alt)), s.alt));
      s.links = [...posts.map((p, i) => ({ label: `${s.badgePrefix} Nº ${pad2(i + 1)} ↗`, url: p.url })), ...(s.links || [])];
      break;
    }
    case 'activity': {
      const items = (await live('activity', () => fetchActivity(user, s))) || [];
      out.push(pic(emit(name, listCard(s.kicker, fig(), items.map((a) => ({ title: a.text, meta: a.kind })), s.alt)), s.alt));
      const repos = [...new Set(items.map((a) => a.repo).filter(Boolean))];
      s.links = [
        ...items.map((a, i) => ({ label: `${s.badgePrefix} Nº ${pad2(i + 1)} ↗`, url: a.url })),
        ...repos.map((r) => ({ label: `${r.split('/')[1].toUpperCase()} ↗`, url: `https://github.com/${r}` })),
        ...(s.links || []),
      ];
      break;
    }
    case 'telemetry': {
      const days = (await live('calendar', () => fetchCalendar(user))) || [];
      out.push(pic(emit('telemetry', telemetryCard(days, fig())), 'Contribution telemetry'));
      const cards = s.cards.map(monoAsset).filter(Boolean);
      const rows = [];
      for (let i = 0; i < cards.length; i += 2) rows.push(center(cards.slice(i, i + 2).join(' ')));
      // a <details> fold is the one real click interaction GitHub allows in a README
      out.push(s.collapse ? `<details>\n<summary>${badge(s.collapse)}</summary>\n\n${rows.join('\n\n')}\n\n</details>` : rows.join('\n\n'));
      const repos = (await live('topRepos', () => fetchTopRepos(user, s.excludeRepos || [], s.topRepos))) || [];
      out.push(pic(emit('top-repos', topReposCard(repos, fig(), user)), 'Top repositories by commits'));
      if (s.graph3d) {
        const g = monoAsset(s.graph3d);
        if (g) out.push(g);
      }
      break;
    }
    case 'glance': {
      const g = (await live('glance', () => fetchGlance(user))) || {};
      const days = (await live('calendar', () => fetchCalendar(user))) || [];
      const pkgSection = profile.sections.find((x) => x.type === 'packages');
      const pkgs = (pkgSection && (await live('packages', () => fetchPackages(pkgSection.items)))) || [];
      const since = g.created ? g.created.slice(0, 4) : '';
      const stat = {
        contributions: days.reduce((a, d) => a + d.count, 0),
        repos: g.repos, stars: g.stars, forks: g.forks, followers: g.followers,
        downloads: pkgs.reduce((a, p) => a + (p.downloads || 0), 0),
        years: since ? new Date().getUTCFullYear() - +since : undefined,
      };
      const items = s.items.map((it) => ({ label: it.label, caption: (it.caption || '').replace('{since}', since), value: it.value ?? stat[it.stat] ?? '—' }));
      out.push(pic(emit(name, glanceCard(s, fig(), items)), s.alt));
      break;
    }
    case 'stack':
      out.push(pic(emit(name, stackCard(s, fig())), s.alt));
      break;
    case 'terminal':
      out.push(pic(emit(name, terminalCard(s, fig())), s.alt));
      break;
    case 'contact':
      out.push(`<a href="mailto:${esc(s.email)}">${pic(emit(name, contactCard(s, fig())), s.alt)}</a>`);
      break;
    case 'currently':
      out.push(pic(emit(name, currentlyCard(s, fig())), s.alt));
      break;
    case 'projects': {
      const live_ = (await live('projects', () => fetchProjects(user, s.items))) || [];
      const projects = s.items.map((it) => {
        const r = live_.find((x) => x.repo.toLowerCase().endsWith(`/${it.repo.toLowerCase()}`)) || {};
        return {
          name: it.name || it.repo, note: it.note || r.description || '', tags: it.tags || (r.language ? [r.language] : []),
          stars: r.stars ?? 0, forks: r.forks ?? 0, pushed: r.pushed, demo: it.demo ?? r.homepage,
          url: `https://github.com/${r.repo || `${user}/${it.repo}`}`,
        };
      });
      out.push(pic(emit(name, projectsCard(s, fig(), projects)), s.alt));
      s.links = [
        ...projects.flatMap((p) => [
          { label: `${p.name.toUpperCase()} ↗`, url: p.url },
          ...(p.demo ? [{ label: `${p.name.toUpperCase()} · LIVE ↗`, url: p.demo }] : []),
        ]),
        ...(s.links || []),
      ];
      break;
    }
    case 'packages': {
      const live_ = (await live('packages', () => fetchPackages(s.items))) || [];
      const pkgs = s.items.map((it) => {
        const r = live_.find((x) => x.name.toLowerCase() === it.name.toLowerCase()) || {};
        return { registry: it.registry, name: it.name, note: it.note || r.summary || '', version: r.version, downloads: r.downloads };
      });
      out.push(pic(emit(name, packagesCard(s, fig(), pkgs)), s.alt));
      s.links = [...pkgs.map((p) => ({ label: `${p.name.toUpperCase()} ↗`, url: PACKAGE_URL[p.registry](p.name) })), ...(s.links || [])];
      break;
    }
    case 'route':
      out.push(pic(emit(name, routeCard(s, fig())), s.alt));
      s.links = [...s.items.filter((it) => it.link).map((it) => it.link), ...(s.links || [])];
      break;
    case 'spotify': {
      const t = await live('spotify', fetchSpotify);
      const cover = await coverData(t?.cover);
      out.push(`<a href="${esc(s.profile)}">${pic(emit(name, nowPlayingCard(s, fig(), t, cover)), s.alt)}</a>`);
      break;
    }
    case 'quote': {
      const day = Math.floor(Date.now() / 86400000);
      const i = day % s.quotes.length;
      const [q, a] = s.quotes[i];
      out.push(pic(emit(name, quoteCard(s, `Nº ${pad2(i + 1)} / ${pad2(s.quotes.length)} — DAILY`, q, a)), s.alt));
      break;
    }
    case 'snake':
      out.push(picture(s.light, s.dark, s.alt, '100%'));
      break;
    default:
      warnings.push(`unknown section type "${s.type}"`);
  }
  if (s.links?.length) out.push(badgeRow(s.links));
  return out.join('\n\n');
}

function typingSvg(mode) {
  const t = profile.typing;
  const q = new URLSearchParams({
    font: tokens.typingFont, weight: '700', size: '26', pause: '1000', color: tokens.modes[mode].ink.slice(1),
    center: 'true', vCenter: 'true', width: '600', lines: t.lines.join(';'),
  });
  return `https://readme-typing-svg.demolab.com?${q.toString()}`;
}

// ─── main ────────────────────────────────────────────────────────────────────

function saveCache() {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  // one record per line keeps the cache diff-friendly
  const json = JSON.stringify(cache, null, 2).replace(/\{\n\s+("date": "[^"]+"),\n\s+("count": \d+)\n\s+\}/g, '{ $1, $2 }');
  fs.writeFileSync(CACHE_FILE, json + '\n');
}

async function main() {
  if (ONLY) {
    for (const mode of MODES) fs.mkdirSync(path.join(ASSETS, mode), { recursive: true });
    for (const [i, s] of profile.sections.entries()) if (s.type === ONLY) await renderSection(s, i + 1);
    if (!emitted.size) throw new Error(`no section of type "${ONLY}"`);
    saveCache();
    console.log(`refreshed ${emitted.size} assets × ${MODES.length} modes (--only ${ONLY})`);
    for (const w of warnings) console.warn(`warn: ${w}`);
    return;
  }
  fs.rmSync(ASSETS, { recursive: true, force: true });
  for (const mode of MODES) fs.mkdirSync(path.join(ASSETS, mode), { recursive: true });

  const md = [
    '<!--',
    '  GENERATED FILE — do not edit by hand.',
    '  Content: theme/profile.json · Design tokens: theme/tokens.json',
    '  Rebuild: node theme/build.js   (add --offline to skip network fetches)',
    '-->',
    '',
    center([
      pic(emit('header', header(profile.header)), `${profile.header.name} — ${profile.header.tagline}`),
      profile.links.map((l) => badge(l.label, l.url)).join(' '),
      `<a href="${esc(profile.typing.link)}">${picture(typingSvg('light'), typingSvg('dark'), profile.typing.lines.join(' — '))}</a>`,
      ...(profile.ticker ? [pic(emit('ticker', tickerCard(profile.ticker)), profile.ticker.items.join(' · '))] : []),
    ].join('\n\n')),
  ];
  for (const [i, s] of profile.sections.entries()) md.push(await renderSection(s, i + 1));
  if (profile.signature) md.push(pic(emit('signature', signatureCard(profile.signature)), profile.signature.text));
  md.push(pic(emit('footer', footer(profile.footer)), profile.footer.status));

  fs.writeFileSync(OUTPUT, md.join('\n\n') + '\n');
  saveCache();

  console.log(`wrote ${path.relative(ROOT, OUTPUT)} + ${emitted.size} assets × ${MODES.length} modes${OFFLINE ? ' (offline)' : ''}`);
  for (const w of warnings) console.warn(`warn: ${w}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
