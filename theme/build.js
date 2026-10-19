#!/usr/bin/env node
// Black & white profile README builder.
//   theme/profile.json (content) + theme/tokens.json (design) -> theme/assets/{light,dark}/*.svg + the README file.
// Usage: node theme/build.js [--offline]
// Live data (contributions, top repos, Medium posts, GitHub activity) is fetched when online and cached in
// theme/data/cache.json, so an offline or failed fetch falls back to the last good copy.
'use strict';

const fs = require('fs');
const path = require('path');

const THEME = __dirname;
const ROOT = path.resolve(THEME, '..');
const OFFLINE = process.argv.includes('--offline');
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
  const { ink } = tokens.modes[mode];
  const css = [
    `.m{font-family:${tokens.font}}`,
    `text{fill:${ink}}`,
    `.ln{stroke:${ink};stroke-width:1;fill:none}`,
    `.ink{fill:${ink}}`,
    `.stroke{stroke:${ink};fill:none}`,
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
    '@media (prefers-reduced-motion:reduce){.draw,.rise,.fade,.pulse,.ring,.grow{animation:none}.draw{stroke-dashoffset:0}.rise,.fade{opacity:1}.grow{transform:none}.ring{opacity:0}}',
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
  const name = emit(`badge-${slugify(label.replace('↗', ' ext')) || 'link'}`, {
    w, h, label,
    body: `<rect class="stroke" x=".5" y=".5" width="${w - 1}" height="${h - 1}"/>${text(w / 2 + ls / 2, 18.5, label, { size, ls, anchor: 'middle' })}`,
  });
  return `<a href="${esc(url)}">${pic(name, label)}</a>`;
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
  parts.push(group('fade', 1.4, text(L, 300, h.status, { size: 12.5, ls: 1 })));
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
  return { w: W, h: 400, label: `${h.name} — ${h.tagline}`, body: parts.join('\n  ') };
}

function divider(num, title) {
  const n = pad2(num);
  const p = `~/${n}-${slugify(title)}`;
  const x1 = 128 + width(title, 14, 6) + 24;
  const x2 = R - width(p, 11, 2) - 24;
  if (x2 - x1 < 40) warnings.push(`divider ${n}: title "${title}" is too long`);
  return {
    w: W, h: 92, label: `Section ${n} — ${title}`,
    body: group('fade', 0.1, text(L, 68, n, { size: 52 }) + text(128, 58, title, { size: 14, ls: 6 }) + text(R, 58, p, { size: 11, ls: 2, anchor: 'end' }))
      + line(x1, 53, x2, 53, { draw: true, delay: 0.2 }),
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

// Stand-in for the Spotify widget while its login is broken, so the section keeps the theme instead of a broken image.
function nowPlayingCard(s, fig) {
  return {
    w: W, h: 130, label: s.alt,
    body: [
      kicker('NOW PLAYING — SPOTIFY', fig),
      '<circle class="stroke ring" cx="60" cy="79" r="5"/><circle class="ink pulse" cx="60" cy="79" r="4"/>',
      group('rise', 0.3, text(82, 84, 'Offline — nothing playing right now', { size: 16 })),
      group('fade', 0.6, text(82, 106, 'LIVE TRACK RETURNS WHEN THE PLAYER RECONNECTS', { size: 10, ls: 2, op: 0.6 })),
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

async function live(key, fn) {
  if (OFFLINE) return cache[key];
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

// The Spotify widget answers 200 with a plain-text error when its token is revoked, so check for an actual SVG.
// Offline or on a network error, assume it is up rather than hide it over a transient failure.
async function widgetUp(url) {
  if (OFFLINE) return true;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return res.ok && (res.headers.get('content-type') || '').includes('svg');
  } catch (e) {
    warnings.push(`widget check failed: ${e.message}`);
    return true;
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
      for (let i = 0; i < cards.length; i += 2) out.push(center(cards.slice(i, i + 2).join(' ')));
      const repos = (await live('topRepos', () => fetchTopRepos(user, s.excludeRepos || [], s.topRepos))) || [];
      out.push(pic(emit('top-repos', topReposCard(repos, fig(), user)), 'Top repositories by commits'));
      if (s.graph3d) {
        const g = monoAsset(s.graph3d);
        if (g) out.push(g);
      }
      break;
    }
    case 'route':
      out.push(pic(emit(name, routeCard(s, fig())), s.alt));
      s.links = [...s.items.filter((it) => it.link).map((it) => it.link), ...(s.links || [])];
      break;
    case 'spotify': {
      const base = `https://spotify-github-profile.kittinanx.com/api/view?uid=${s.uid}&${s.params}`;
      const url = (mode) => `${base}&background_color=${tokens.modes[mode].paper.slice(1)}&bar_color=${tokens.modes[mode].ink.slice(1)}&mode=${mode}`;
      if (!(await widgetUp(url('light')))) {
        warnings.push(`spotify: widget is not returning an image (re-login at https://spotify-github-profile.kittinanx.com/) — using offline card`);
        out.push(`<a href="https://open.spotify.com/user/${s.uid}">${pic(emit(name, nowPlayingCard(s, fig())), s.alt)}</a>`);
        break;
      }
      out.push(center(`<a href="https://spotify-github-profile.kittinanx.com/api/view?uid=${s.uid}&redirect=true">${picture(url('light'), url('dark'), s.alt)}</a>`));
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

async function main() {
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
    ].join('\n\n')),
  ];
  for (const [i, s] of profile.sections.entries()) md.push(await renderSection(s, i + 1));
  md.push(pic(emit('footer', footer(profile.footer)), profile.footer.status));

  fs.writeFileSync(OUTPUT, md.join('\n\n') + '\n');
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  // one record per line keeps the cache diff-friendly
  const json = JSON.stringify(cache, null, 2).replace(/\{\n\s+("date": "[^"]+"),\n\s+("count": \d+)\n\s+\}/g, '{ $1, $2 }');
  fs.writeFileSync(CACHE_FILE, json + '\n');

  console.log(`wrote ${path.relative(ROOT, OUTPUT)} + ${emitted.size} assets × ${MODES.length} modes${OFFLINE ? ' (offline)' : ''}`);
  for (const w of warnings) console.warn(`warn: ${w}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
