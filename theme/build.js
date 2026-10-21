#!/usr/bin/env node
// Black & white profile README builder.
//   theme/profile.json (content) + theme/tokens.json (design) -> theme/assets/{light,dark}/*.svg + the README file.
// Usage: node theme/build.js [--offline] [--only <section type>]
// Live data (contributions, top repos, Medium posts, GitHub activity) is fetched when online and cached in
// theme/data/cache.json, so an offline or failed fetch falls back to the last good copy.
// Sections with "auto": true (projects, packages) and the repos section discover the account's repositories and
// published packages themselves, so a new repo or package shows up without editing anything (see "discover").
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
// Every card is drawn once per layout and pic() lets the browser pick by screen width — a 1000-wide card shrunk
// to a phone or tablet leaves its small text unreadable. `media` is the viewport a layout serves (the README
// column is roughly the viewport minus GitHub's sidebar and gutters); the first matching one wins, wide is the
// fallback. W / L / R (card width, left and right margins) and COL follow whichever layout is being drawn.
// NARROW is any stacked layout (medium or narrow); it also halves letter-spacing so labels fit.
const LAYOUTS = {
  wide: { W: 1000, L: 48, R: 952 },
  narrow: { W: 400, L: 16, R: 384, media: '(max-width: 560px)' }, // phones
  medium: { W: 640, L: 28, R: 612, media: '(max-width: 1279px)' }, // large phones in landscape, tablets, small laptops
};
let W, L, R, COL, NARROW;
function layout(name) {
  ({ W, L, R } = LAYOUTS[name]);
  NARROW = name !== 'wide';
  COL = NARROW ? R - L : (R - L - GAP) / 2;
}
const lsk = (ls) => (ls && NARROW ? ls / 2 : ls);
const warn = (m) => warnings.push(NARROW ? `${W}px ${m}` : m);
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ─── text ────────────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad2 = (n) => String(n).padStart(2, '0');
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const width = (s, size, ls = 0) => [...String(s)].length * (size * tokens.charWidth + lsk(ls));

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
  if (width(s, size, ls) > max) warn(`${where}: "${s}" may overflow (${Math.round(width(s, size, ls))}px > ${max}px)`);
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
    x, y, 'font-size': o.size || 14, 'letter-spacing': lsk(o.ls), 'text-anchor': o.anchor, 'font-weight': o.weight, opacity: o.op, style: delay(o.delay),
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
    `.pp{fill:${paper}}`,
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
const responsive = new Set(); // cards that also have the stacked layouts, written as <name>.<layout>.svg
// card = a card object (drawn once, e.g. badges, which are small enough as they are),
// or a function that draws the card for the current layout (drawn once per layout).
function emit(name, card) {
  const layouts = typeof card === 'function' ? Object.keys(LAYOUTS) : ['wide'];
  for (const l of layouts) {
    layout(l);
    const c = typeof card === 'function' ? card() : card;
    const file = l === 'wide' ? name : `${name}.${l}`;
    for (const mode of MODES) fs.writeFileSync(path.join(ASSETS, mode, `${file}.svg`), svgDoc(c, mode));
  }
  layout('wide');
  if (layouts.length > 1) responsive.add(name);
  emitted.add(name);
  return name;
}
function emitRaw(name, mode, svg) {
  fs.writeFileSync(path.join(ASSETS, mode, `${name}.svg`), svg);
  emitted.add(name);
}

const rel = (p) => path.relative(path.dirname(OUTPUT), p).split(path.sep).join('/');
const assetPath = (mode, name) => rel(path.join(ASSETS, mode, `${name}.svg`));
// sizes = [{ media, light, dark }] for smaller screens, narrowest first; the first <source> whose media matches wins.
const picture = (light, dark, alt, w, sizes = []) =>
  `<picture>${sizes.map((z) => `<source media="${z.media} and (prefers-color-scheme: dark)" srcset="${esc(z.dark)}"/><source media="${z.media}" srcset="${esc(z.light)}"/>`).join('')}`
  + `<source media="(prefers-color-scheme: dark)" srcset="${esc(dark)}"/><img src="${esc(light)}" alt="${esc(alt)}"${w ? ` width="${w}"` : ''}/></picture>`;
// A responsive card fills the README column whichever layout is showing (the wide one never exceeds it anyway).
const pic = (name, alt, w) => {
  if (!responsive.has(name)) return picture(assetPath('light', name), assetPath('dark', name), alt, w);
  const sizes = Object.entries(LAYOUTS).filter(([, l]) => l.media)
    .map(([k, l]) => ({ media: l.media, light: assetPath('light', `${name}.${k}`), dark: assetPath('dark', `${name}.${k}`) }));
  return picture(assetPath('light', name), assetPath('dark', name), alt, w || '100%', sizes);
};
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
  // the right-hand figure label is decoration: on the narrow card it gives way when the two would collide
  if (NARROW && width(`${left}${right}`, 11, 3.5) > R - L - 40) right = '';
  checkFit('kicker', `${left}${right}`, 11, 3.5, R - L - 40);
  return group('fade', 0.1, text(L, 28, left, { size: 11, ls: 3.5 }) + text(R, 28, right, { size: 11, ls: 3.5, anchor: 'end' }))
    + line(L, 40, R, 40, { draw: true, delay: 0.1 });
}

function header(h) {
  if (NARROW) return narrowHeader(h);
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

// Phone header: the same parts stacked and wrapped, without the globe.
function narrowHeader(h) {
  const parts = [];
  const place = h.location.split(' — ')[0];
  parts.push(group('fade', 0.2, text(L, 44, h.kicker, { size: 11, ls: 3.5 }) + text(R, 44, place, { size: 11, ls: 3.5, anchor: 'end' })));
  parts.push(line(L, 58, R, 58, { draw: true, delay: 0.2 }));
  let y = 116;
  wrap(h.name, 44, -1.5, R - L).forEach((ln, i) => {
    parts.push(group('rise', 0.5 + i * 0.1, text(L - 1, y, ln, { size: 44, ls: -1.5 })));
    y += 50;
  });
  y -= 10;
  for (const ln of wrap(h.tagline, 17, 0, R - L)) {
    parts.push(group('fade', 0.9, text(L, y, ln, { size: 17 })));
    y += 26;
  }
  y += 18;
  for (const ln of wrap(`focus  ▸  ${h.focus}`, 13, 1, R - L)) {
    parts.push(group('fade', 1.2, text(L, y, ln, { size: 13, ls: 1 })));
    y += 22;
  }
  y += 6;
  const status = wrap(h.status, 13, 1, R - L - 16);
  status.forEach((ln, i) => {
    const t = text(L, y, ln, { size: 13, ls: 1 });
    parts.push(group('fade', 1.4, i === status.length - 1 ? t.replace('</text>', ' <tspan class="caret">█</tspan></text>') : t));
    y += 22;
  });
  y += 12;
  parts.push(line(L, y, R, y, { draw: true, delay: 1.4 }));
  y += 30;
  for (const ln of [...wrap(h.strip.join('  ·  '), 11.5, 3, R - L), ...wrap(h.stripRight, 11.5, 3, R - L)]) {
    parts.push(group('fade', 1.7, text(L, y, ln, { size: 11.5, ls: 3 })));
    y += 22;
  }
  return { w: W, h: y, label: `${h.name} — ${h.tagline}`, body: parts.join('\n  ') };
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
  // the narrow divider drops the ~/path and sets the number smaller
  const p = NARROW ? '' : `~/${n}-${slugify(title)}`;
  const tx = NARROW ? L + 54 : 128;
  const x1 = tx + width(title, 14, 6) + 24;
  const x2 = NARROW ? R - 24 : R - 14 - width(p, 11, 2) - 24;
  if (x2 - x1 < 40) warn(`divider ${n}: title "${title}" is too long`);
  // a node rides the leading edge of the rule as it draws, and comes to rest at its end
  const run = (x2 - x1).toFixed(1);
  return {
    w: W, h: 92, label: `Section ${n} — ${title}`,
    css: [
      '.spark{animation:spark 1.4s cubic-bezier(.6,0,.2,1) .2s both}',
      `@keyframes spark{from{transform:translateX(-${run}px)}to{transform:translateX(0)}}`,
    ],
    body: group('fade', 0.1, text(L, 68, n, { size: NARROW ? 38 : 52 }) + text(tx, 58, title, { size: 14, ls: 6 }) + (p ? text(R - 14, 58, p, { size: 11, ls: 2, anchor: 'end' }) : '') + `<rect class="ink blink" x="${R - 7}" y="48" width="7" height="12"/>`)
      + line(x1, 53, x2, 53, { draw: true, delay: 0.2 })
      + `<circle class="stroke" cx="${x1}" cy="53" r="3"/><rect class="ink spark anim" x="${x2 - 3}" y="50" width="6" height="6"/>`,
  };
}

// WHOAMI: a greeting that types itself out, the bio and a credo on the left, and an ID card on the right
// (monogram, name, the label/value rows, a barcode) with a scan line sweeping over it. Stacked when NARROW.
// s = { kicker?, lede?, bio: [...], quote?, rows: [[label, value]], idTitle?, idCaption? } — no lede: bio[0] is typed.
function whoamiCard(s, fig) {
  const parts = [kicker(s.kicker || 'WHO AM I', fig)];
  const defs = [];
  const pw = NARROW ? R - L : 300; // ID card width
  const px = NARROW ? L : R - pw;
  const tw = NARROW ? R - L : px - 56 - L; // text column width

  // greeting, revealed a character at a time by a stepped clip, then a blinking cursor
  const lede = s.lede || s.bio?.[0] || '';
  const bio = s.lede ? s.bio || [] : (s.bio || []).slice(1);
  const size = NARROW ? 24 : 30;
  let y = NARROW ? 96 : 104;
  let t = 0.3;
  const ledeLines = wrap(lede, size, -0.5, tw);
  ledeLines.forEach((ln, i) => {
    const n = [...ln].length;
    const lw = width(ln, size, -0.5);
    const dur = Math.max(0.4, n * 0.045);
    defs.push(`<clipPath id="type${i}"><rect class="type" x="${L - 2}" y="${y - size}" width="${(lw + 4).toFixed(1)}" height="${size + 12}" style="animation-duration:${dur.toFixed(2)}s;animation-delay:${t.toFixed(2)}s;animation-timing-function:steps(${n})"/></clipPath>`);
    parts.push(`<g clip-path="url(#type${i})">${text(L, y, ln, { size, ls: -0.5 })}</g>`);
    t += dur;
    // the cursor trails an invisible copy of the line, so it lands at the real text width whatever the font
    if (i === ledeLines.length - 1) parts.push(group('fade', t, text(L, y, ln, { size, ls: -0.5 }).replace(/>([^<]*)<\/text>$/, '><tspan fill-opacity="0">$1</tspan><tspan class="caret"> █</tspan></text>')));
    y += size + 10;
  });
  parts.push(`<rect class="ink grow" style="animation-delay:${t.toFixed(2)}s" x="${L}" y="${y - 6}" width="56" height="3"/>`);
  y += 34;

  let d = Math.min(t, 1.2);
  for (const para of bio) {
    for (const ln of wrap(para, 15, 0, tw)) {
      parts.push(group('rise', d, text(L, y, ln, { size: 15 })));
      y += 24;
    }
    y += 10;
    d += 0.12;
  }
  if (s.quote) {
    const lines = wrap(s.quote, 16, 0, tw - 22);
    y += 8;
    const top = y - 18;
    let inner = text(L + 22, y, 'CREDO', { size: 10, ls: 2.5, op: 0.6 });
    lines.forEach((ln, j) => (inner += text(L + 22, y + 26 + j * 24, ln, { size: 16 })));
    y += 26 + (lines.length - 1) * 24 + 10;
    parts.push(`<rect class="ink growy" style="animation-delay:${d.toFixed(2)}s" x="${L}" y="${top}" width="3" height="${y - top}"/>`);
    parts.push(group('fade', d + 0.2, inner));
    y += 10;
  }
  const leftEnd = y;

  // ID card
  const py = NARROW ? leftEnd + 18 : 72;
  const name = s.name || profile.header.name;
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  const card = [];
  card.push(`<rect class="ink" x="${px}" y="${py}" width="${pw}" height="30"/>`
    + text(px + 16, py + 19.5, s.idTitle || 'ID CARD', { size: 10, ls: 3, cls: 'paper' })
    + text(px + pw - 16, py + 19.5, 'Nº 001', { size: 10, ls: 3, anchor: 'end', cls: 'paper' }));
  const cx = px + 54;
  const cy = py + 88;
  const nx = cx + 54;
  card.push(group('rise', 0.4,
    `<circle class="stroke spin" cx="${cx}" cy="${cy}" r="42" stroke-dasharray="3 7" opacity="${tokens.tones.softRule}"/>`
    + `<circle class="stroke" cx="${cx}" cy="${cy}" r="34"/>`
    + text(cx, cy + 8, initials, { size: 22, ls: 1, anchor: 'middle' })
    + text(nx, cy - 4, truncate(name, 16, 0, px + pw - 16 - nx), { size: 16 })
    + text(nx, cy + 18, `@${profile.user}`, { size: 11, ls: 1.5, op: 0.6 })));
  let y2 = cy + 62;
  card.push(line(px + 16, y2 - 14, px + pw - 16, y2 - 14, { op: tokens.tones.softRule * 0.6, draw: true, delay: 0.6 }));
  const rows = s.rows || [];
  rows.forEach(([k, v], i) => {
    const lines = wrap(v, 13.5, 0, pw - 40);
    let inner = text(px + 20, y2 + 8, k, { size: 10, ls: 2.5, op: 0.6 });
    // the STATUS row gets the live dot
    if (/STATUS/i.test(k)) inner += `<circle class="stroke ring" cx="${px + pw - 24}" cy="${y2 + 4}" r="4"/><circle class="ink pulse" cx="${px + pw - 24}" cy="${y2 + 4}" r="3"/>`;
    lines.forEach((ln, j) => (inner += text(px + 20, y2 + 28 + j * 20, ln, { size: 13.5 })));
    card.push(group('rise', 0.7 + i * 0.1, inner));
    y2 += 28 + lines.length * 20 + 6;
    if (i < rows.length - 1) card.push(line(px + 20, y2 - 4, px + pw - 20, y2 - 4, { op: tokens.tones.softRule * 0.35 }));
    y2 += 10;
  });
  // barcode: bar widths come from the username, so it stays the same between builds
  const seed = [...(profile.user + name)].map((c) => c.charCodeAt(0));
  const bars = [];
  for (let x = px + 20, i = 0; x < px + pw - 22; i++) {
    const bw = 1 + (seed[i % seed.length] % 3);
    if (i % 2 === 0) bars.push(`<rect class="ink" x="${x}" y="${y2}" width="${bw}" height="26"/>`);
    x += bw + 1 + (seed[(i * 7) % seed.length] % 2);
  }
  card.push(`<g class="grow" style="animation-delay:${(0.8 + rows.length * 0.1).toFixed(2)}s">${bars.join('')}</g>`);
  y2 += 46;
  card.push(group('fade', 1.2, text(px + 20, y2, truncate(s.idCaption || profile.header.location, 9, 2, pw - 40), { size: 9, ls: 2, op: 0.6 })));
  y2 += 20;
  const ph = y2 - py;
  card.push(`<rect class="ln draw" pathLength="1" x="${px + 0.5}" y="${py + 0.5}" width="${pw - 1}" height="${ph - 1}"/>`);
  card.push(`<rect class="ink scan" x="${px + 1}" y="${py + 31}" width="${pw - 2}" height="2" opacity="${tokens.tones.track}"/>`);
  parts.push(card.join(''));

  const h = Math.round(NARROW ? y2 + 12 : Math.max(leftEnd, y2) + 16);
  return {
    w: W, h, label: s.alt,
    css: [
      '.type{transform-box:fill-box;transform-origin:left;transform:scaleX(0);animation:type 1s linear forwards}',
      '@keyframes type{to{transform:scaleX(1)}}',
      '.growy{transform-box:fill-box;transform-origin:top;transform:scaleY(0);animation:growy 1s cubic-bezier(.2,.7,.2,1) forwards}',
      '@keyframes growy{to{transform:scaleY(1)}}',
      '.scan{animation:scan 4.5s ease-in-out 1.5s infinite alternate}',
      `@keyframes scan{from{transform:translateY(0)}to{transform:translateY(${ph - 34}px)}}`,
      '@media (prefers-reduced-motion:reduce){.type,.growy{animation:none;transform:none}.scan{animation:none;opacity:0}}',
    ],
    body: `<defs>${defs.join('')}</defs>\n  ${parts.join('\n  ')}`,
  };
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
  // narrow: number and meta share a line, the title runs full width under them
  const tx = NARROW ? L : 130;
  const dy = NARROW ? 22 : 0;
  const maxW = NARROW ? R - L : R - tx - (metaW ? metaW + 28 : 0);
  items.forEach((it, i) => {
    const lines = wrap(it.title, 15, 0, maxW);
    let inner = text(L, y, `Nº ${pad2(i + 1)}`, { size: 11, ls: 2.5 });
    lines.forEach((ln, j) => (inner += text(tx, y + dy + j * 22, ln, { size: 15 })));
    if (it.meta) inner += text(R, y, it.meta, { size: 11, ls: 2, anchor: 'end' });
    parts.push(group('rise', 0.2 + i * 0.08, inner));
    y += dy + lines.length * 22;
    if (i < items.length - 1) {
      parts.push(line(L, y - 6, R, y - 6, { op: tokens.tones.softRule * 0.5 }));
      y += 18;
    }
  });
  return { w: W, h: Math.round(y + 4), label: alt, body: parts.join('\n  ') };
}

const monthYear = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const GAP = 48; // gutter between the two columns of a grid card (one column when NARROW)
layout('wide');
const colX = (c) => L + c * (COL + GAP);

// Two-column grid of labelled notes (CURRENTLY). item = { label, text, note?, live? } — live adds the pulse dot.
function currentlyCard(s, fig) {
  const parts = [kicker(s.kicker, s.updated ? `${fig} · UPDATED ${s.updated}` : fig)];
  let y = 84;
  const per = NARROW ? 1 : 2;
  for (let r = 0; r < s.items.length; r += per) {
    const row = s.items.slice(r, r + per).map((it) => ({ ...it, lines: wrap(it.text, 15, 0, COL) }));
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

// Featured projects as a two-column grid. p = { name, note, tags, stars, forks, pushed, demo, fresh } — fresh marks it NEW.
function projectsCard(s, fig, projects) {
  const parts = [kicker(s.kicker, fig)];
  let y = 70;
  const per = NARROW ? 1 : 2;
  for (let r = 0; r < projects.length; r += per) {
    const row = projects.slice(r, r + per).map((p) => {
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
      if (p.fresh) {
        const nx = x + width(`Nº ${pad2(r + c + 1)}`, 11, 2.5) + 10;
        inner += `<rect class="ink pulse" x="${nx}" y="${y - 1}" width="40" height="17"/>` + text(nx + 21, y + 11.5, 'NEW', { size: 10, ls: 2, anchor: 'middle', cls: 'paper' });
      }
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
  // narrow: no row number, the registry tag starts the row
  const tagX = NARROW ? L : 118;
  const nx = tagX + tagW + (NARROW ? 14 : 22);
  const bw = NARROW ? 72 : 120;
  const bx = R - bw;
  let y = 82;
  pkgs.forEach((p, i) => {
    const tag = p.registry.toUpperCase();
    let inner = NARROW ? '' : text(L, y, `Nº ${pad2(i + 1)}`, { size: 11, ls: 2.5 });
    inner += `<rect class="stroke" x="${tagX + 0.5}" y="${y - 14.5}" width="${tagW}" height="20"/>` + text(tagX + tagW / 2 + 1, y, tag, { size: 10, ls: 2, anchor: 'middle' });
    inner += text(nx, y, p.name, { size: 16 });
    inner += text(nx + width(p.name, 16) + 14, y, p.version ? `v${p.version}` : '', { size: 10, ls: 2, op: 0.6 });
    inner += text(nx, y + 22, truncate(p.note, 12, 0, bx - nx - (NARROW ? 16 : 32)), { size: 12, op: 0.7 });
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
  // chips start at cx0; the label column sits left of it (narrow: the label sits on its own line above)
  const cx0 = NARROW ? L : 214;
  const H = 30;
  const gap = 10;
  let y = 96;
  let k = 0;
  s.rows.forEach((row, i) => {
    const chips = [...(row.core || []).map((t) => [t, true]), ...(row.more || []).map((t) => [t, false])];
    let x = cx0;
    let top = NARROW ? y + 34 : y;
    const count = `${chips.length} TOOL${chips.length === 1 ? '' : 'S'}`;
    const inner = [text(L, y + 20, pad2(i + 1), { size: 11, ls: 2.5, op: 0.6 }), text(L + 34, y + 20, row.label, { size: 11, ls: 3 }),
      NARROW ? text(R, y + 20, count, { size: 10, ls: 2, op: 0.5, anchor: 'end' }) : text(L + 34, y + 38, count, { size: 9, ls: 2, op: 0.5 })];
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
  // narrow: each value goes on the line under its key, without the dotted leader
  const LH = NARROW ? 54 : 34;
  const keyW = Math.max(...s.rows.map(([k]) => width(k, 11, 3)));
  const vx = NARROW ? L + 40 : Math.max(266, Math.round(L + 46 + keyW + 60));
  const lines = [];
  lines.push({ prompt: true, body: text(L + 40, 0, s.command, { size: 14 }) });
  s.rows.forEach(([k, v]) => {
    // narrow values wrap onto a second line rather than being cut short
    const vs = NARROW ? wrap(v, 15, 0, R - 24 - vx).slice(0, 2) : [truncate(v, 15, 0, R - 24 - vx)];
    if (NARROW && wrap(v, 15, 0, R - 24 - vx).length > 2) vs[1] = truncate(`${vs[1]}…`, 15, 0, R - 24 - vx);
    lines.push({
      chars: k.length + v.length,
      h: LH + (vs.length - 1) * 22,
      body: text(L + 40, 0, k, { size: 11, ls: 3, op: NARROW ? 0.7 : undefined })
        + (NARROW ? '' : `<line class="ln" x1="${L + 48 + keyW}" y1="-4" x2="${vx - 14}" y2="-4" stroke-dasharray="1 5" opacity="${tokens.tones.softRule}"/>`)
        + vs.map((ln, j) => text(vx, (NARROW ? 21 : 0) + j * 22, ln, { size: 15 })).join(''),
    });
  });
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
    parts.push(`<clipPath id="ty${i}"><rect class="type" x="${L + 4}" y="${y - 22}" width="${R - L - 8}" height="${ln.h || LH}" style="animation-duration:${dur}s;animation-timing-function:steps(${steps});animation-delay:${t.toFixed(2)}s"/></clipPath>`);
    const prompt = ln.prompt ? text(L + 20, y, '$', { size: 14, op: 0.6 }) : '';
    parts.push(`<g clip-path="url(#ty${i})"><g transform="translate(0 ${y})">${ln.body}</g>${prompt}</g>`);
    t += dur + (ln.prompt ? 0.3 : 0.12);
    y += i === 0 ? 44 : ln.h;
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
  const cols = NARROW ? (W >= 600 ? 3 : 2) : items.length; // stacked layouts: a grid, ROW apart
  const ROW = 116;
  const colW = (R - L) / cols;
  for (let d = 1; d <= 9; d++) css.push(`.odo${d}{animation-name:odo${d}}`, `@keyframes odo${d}{from{transform:translateY(${d * LH}px)}to{transform:translateY(0)}}`);
  items.forEach((it, i) => {
    const c = i % cols;
    const top = Math.floor(i / cols) * ROW;
    const b = base + top;
    const x = L + c * colW;
    const pad = c ? 20 : 0;
    let inner = text(x + pad, 78 + top, truncate(it.label, 11, 2.5, colW - pad - 12), { size: 11, ls: 2.5 });
    parts.push(`<clipPath id="odo-${i}"><rect x="${x + pad - 2}" y="${b - size}" width="${colW - pad}" height="${size + 14}"/></clipPath>`);
    let digits = '';
    [...String(it.value)].forEach((ch, k) => {
      const cx = x + pad + k * size * tokens.charWidth;
      if (!/\d/.test(ch)) return void (digits += text(cx, b, ch, { size }));
      const dd = +ch;
      const col = Array.from({ length: 10 }, (_, n) => text(cx, b + (n - dd) * LH, String(n), { size })).join('');
      digits += `<g class="anim odo odo${dd}" style="animation-delay:${(0.3 + i * 0.12 + k * 0.08).toFixed(2)}s">${col}</g>`;
    });
    inner += `<g clip-path="url(#odo-${i})">${digits}</g>`;
    if (it.caption) inner += text(x + pad, b + 30, truncate(it.caption, 10, 2, colW - pad - 12), { size: 10, ls: 2, op: 0.6 });
    parts.push(group('fade', 0.2 + i * 0.08, inner));
    if (c) parts.push(line(x, 62 + top, x, b + 36, { op: tokens.tones.softRule * 0.5, draw: true, delay: 0.3 + i * 0.1 }));
    else if (top) parts.push(line(L, top + 52, R, top + 52, { op: tokens.tones.softRule * 0.5 }));
  });
  return { w: W, h: base + 50 + (Math.ceil(items.length / cols) - 1) * ROW, label: `${s.alt}: ${items.map((it) => `${it.value} ${it.label.toLowerCase()}`).join(', ')}`, css, body: parts.join('\n  ') };
}

// Closing call to action: headline, a line of copy, availability and the e-mail with a nudging arrow.
function contactCard(s, fig) {
  const parts = [kicker(s.kicker, fig)];
  const hs = NARROW ? 32 : 44; // headline size
  let y = NARROW ? 96 : 104;
  wrap(s.headline, hs, -1.5, R - L).forEach((ln, i) => {
    parts.push(group('rise', 0.2 + i * 0.1, text(L - 2, y, ln, { size: hs, ls: -1.5 })));
    y += hs + 8;
  });
  for (const ln of wrap(s.text, 16, 0, R - L)) {
    parts.push(group('fade', 0.5, text(L, y, ln, { size: 16 })));
    y += 26;
  }
  y += 22;
  parts.push(line(L, y - 22, R, y - 22, { op: tokens.tones.softRule, draw: true, delay: 0.6 }));
  y += 14;
  parts.push(group('fade', 0.8, `<circle class="stroke ring" cx="${L + 5}" cy="${y - 4}" r="5"/><circle class="ink pulse" cx="${L + 5}" cy="${y - 4}" r="4"/>` + text(L + 24, y, s.status, { size: 11, ls: 3 })));
  if (NARROW) y += 36; // the e-mail drops under the status line
  parts.push(group('fade', 0.9, text(R - 34, y + 1, s.email, { size: 18, anchor: 'end' })
    + `<g class="nudge"><path class="ln" stroke-width="1.5" d="M${R - 24} ${y - 5} H${R - 2} M${R - 9} ${y - 12} L${R - 2} ${y - 5} L${R - 9} ${y + 2}"/></g>`));
  return { w: W, h: y + 26, label: `${s.headline} ${s.text} ${s.email}`, body: parts.join('\n  ') };
}

function routeCard(s, fig) {
  const parts = [kicker(s.kicker, fig)];
  // narrow: the text runs under its number instead of beside it
  const dx = NARROW ? L + 6 : 60; // the route line
  const nx = NARROW ? L + 26 : 84;
  const tx = NARROW ? nx : 150;
  const dy = NARROW ? 22 : 0;
  let y = 80;
  const dots = [];
  s.items.forEach((it, i) => {
    const marker = it.link ? 'LINK ↗' : '';
    const lines = wrap(it.text, 15, 0, R - tx - (marker && !NARROW ? width(marker, 10, 2) + 28 : 0));
    const last = i === s.items.length - 1;
    dots.push(y - 5);
    let inner = last
      ? `<circle class="stroke ring" cx="${dx}" cy="${y - 5}" r="5"/><circle class="ink pulse" cx="${dx}" cy="${y - 5}" r="4"/>`
      : `<circle class="ink" cx="${dx}" cy="${y - 5}" r="4"/>`;
    inner += text(nx, y, `Nº ${pad2(i + 1)}`, { size: 11, ls: 2.5 });
    lines.forEach((ln, j) => (inner += text(tx, y + dy + j * 22, ln, { size: 15 })));
    if (marker) inner += text(R, y, marker, { size: 10, ls: 2, anchor: 'end' });
    parts.push(group('rise', 0.2 + i * 0.1, inner));
    y += dy + lines.length * 22 + 20;
  });
  parts.splice(1, 0, line(dx, dots[0], dx, dots[dots.length - 1], { op: tokens.tones.softRule, draw: true, delay: 0.2 }));
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
  const cols = NARROW ? 2 : stats.length; // narrow: 2 × 2, the chart moves down by the extra row
  const colW = (R - L) / cols;
  const extra = (Math.ceil(stats.length / cols) - 1) * 66;
  stats.forEach(([k, v], j) => {
    const x = L + (j % cols) * colW;
    const dy = Math.floor(j / cols) * 66;
    parts.push(group('rise', 0.2 + j * 0.08, text(x, 76 + dy, k, { size: 11, ls: 2.5 }) + text(x, 108 + dy, v, { size: j === 3 ? 18 : 26 })));
  });

  const weeks = [];
  for (let k = 0; k < days.length; k += 7) weeks.push(days.slice(k, k + 7));
  const sums = weeks.map((w) => w.reduce((a, d) => a + d.count, 0));
  const max = Math.max(1, ...sums);
  const top = 150 + extra;
  const base = top + (NARROW ? 120 : 140);
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
  // narrow: the bar runs under the name instead of beside it
  const nx = NARROW ? L + 44 : 118;
  const bx = NARROW ? nx : 440;
  const bw = NARROW ? R - nx : 420;
  const step = NARROW ? 48 : 36;
  const by = NARROW ? 10 : -10; // bar top, from the text baseline
  repos.forEach((r, i) => {
    const y = 80 + i * step;
    const name = r.name.startsWith(`${user}/`) ? r.name.slice(user.length + 1) : r.name;
    const fw = Math.max(2, Math.round((r.commits / max) * bw));
    parts.push(group('rise', 0.2 + i * 0.08,
      text(L, y, `Nº ${pad2(i + 1)}`, { size: 11, ls: 2.5 })
      + text(nx, y, truncate(name, 14, 0, NARROW ? R - nx - 48 : bx - nx - 20), { size: 14 })
      + `<rect class="ink" opacity="${tokens.tones.track}" x="${bx}" y="${y + by}" width="${bw}" height="${NARROW ? 6 : 10}"/>`
      + `<rect class="ink grow" style="animation-delay:${0.4 + i * 0.1}s" x="${bx}" y="${y + by}" width="${fw}" height="${NARROW ? 6 : 10}"/>`
      + text(R, y, String(r.commits), { size: 14, anchor: 'end' })));
  });
  const h = 80 + Math.max(1, repos.length) * step - (NARROW ? 18 : 14);
  return { w: W, h, label: 'Top repositories by commits', body: parts.join('\n  ') };
}

// Hand-drawn doodles that draw themselves stroke by stroke, hold, erase and redraw. Each one lives in a 140 × 140
// box: `strokes` are drawn in order, `rings` are paper-filled circles drawn over them, and `extra` (rays, steam,
// blinking bits) fades in and out with them. The art is drawn three times through slightly different displacement
// filters and the copies flicker in turn, which gives the wobbly "line boil" of hand-drawn animation.
// Pick and caption them in profile.json.
const ring = (x, y, r) => `M${x + r} ${y} A${r} ${r} 0 1 1 ${x + r - 0.1} ${y - 1.2}`;
const DOODLES = {
  bulb: {
    strokes: [
      'M54 92 C40 82 30 66 34 48 C38 30 54 20 72 20 C92 21 106 36 105 55 C104 70 96 82 88 92',
      'M56 100 C66 99 76 101 86 100', 'M58 108 C66 107 76 109 84 108', 'M64 116 C68 117 74 115 78 116',
      'M62 92 L64 66 L70 74 L76 65 L79 92',
    ],
    extra: '<path class="stroke twinkle" d="M72 4 V11 M31 18 L36 24 M113 18 L108 24 M16 54 H23 M121 54 H128"/>',
  },
  laptop: {
    strokes: [
      'M30 34 C58 33 86 35 111 34 C112 54 110 76 111 96 C84 97 56 95 29 96 C30 76 28 54 30 34',
      'M14 104 C52 103 90 105 126 104 L118 115 C86 116 54 114 22 115 Z',
      'M56 54 L45 65 L56 77', 'M84 54 L95 65 L84 77', 'M76 50 L64 81',
    ],
    extra: '<rect class="ink blink" x="99" y="82" width="6" height="8"/>',
  },
  network: {
    strokes: (() => {
      const layers = [[32, [42, 70, 98]], [72, [30, 56, 84, 110]], [112, [56, 86]]];
      const out = [];
      for (let k = 0; k < 2; k++) {
        const [xa, as] = layers[k];
        const [xb, bs] = layers[k + 1];
        for (const a of as) for (const b of bs) out.push(`M${xa + 7} ${a} L${xb - 7} ${b}`);
      }
      for (const [x, ys] of layers) for (const y of ys) out.push(ring(x, y, 7));
      return out;
    })(),
    extra: '<circle class="ink pulse" cx="112" cy="56" r="3"/><circle class="ink pulse" cx="112" cy="86" r="3" style="animation-delay:-1.2s"/>',
  },
  rocket: {
    strokes: [
      'M70 12 C89 28 93 60 86 92 C76 93 64 91 54 92 C47 60 51 28 70 12',
      ring(70, 52, 9),
      'M54 76 L38 98 L55 95', 'M86 76 L102 98 L85 95',
      'M24 40 H36 M18 56 H30 M110 46 H122',
    ],
    extra: '<path class="stroke flame" d="M60 100 C62 112 66 122 70 130 C74 122 78 112 80 100"/>',
    cls: 'bob',
  },
  coffee: {
    strokes: [
      'M32 58 C33 82 37 104 46 116 C60 120 80 120 94 116 C103 104 107 82 108 58 C82 60 58 60 32 58',
      'M108 68 C126 66 128 96 104 98',
      'M18 124 C52 128 88 128 122 124',
      'M50 84 C60 88 80 88 90 84',
    ],
    extra: '<path class="stroke steam" d="M54 46 C46 36 62 30 54 18"/><path class="stroke steam" style="animation-delay:-.7s" d="M72 44 C64 34 80 28 72 14"/><path class="stroke steam" style="animation-delay:-1.4s" d="M90 46 C82 36 98 30 90 18"/>',
  },
  git: {
    strokes: [
      'M40 16 C41 52 39 88 40 124',
      'M40 38 C40 56 100 46 100 62 L100 86 C100 102 40 92 40 106',
      'M18 30 H28 M18 116 H28',
    ],
    rings: [[40, 24], [40, 70], [100, 62], [100, 86], [40, 106]],
    extra: '<circle class="ink pulse" cx="40" cy="106" r="3.5"/><path class="stroke twinkle" d="M118 30 V40 M113 35 H123"/>',
  },
  package: {
    strokes: [
      'M70 22 L114 42 L70 62 L26 42 Z',
      'M26 42 C25 58 27 76 26 92 L70 114 L70 62',
      'M114 42 C115 58 113 76 114 92 L70 114',
      'M48 32 L92 52 L92 66',
      'M36 74 L56 84 M36 84 L50 91',
    ],
    extra: '<path class="stroke float" d="M104 18 V4 M98 10 L104 4 L110 10"/>',
  },
  trophy: {
    strokes: [
      'M42 22 C60 21 80 23 98 22 C98 58 88 78 70 80 C52 78 42 58 42 22',
      'M42 32 C24 32 24 56 46 58', 'M98 32 C116 32 116 56 94 58',
      'M70 80 V98', 'M50 98 C64 97 76 99 90 98 L94 114 C78 115 62 113 46 114 Z',
      'M70 34 L74 44 L84 44 L76 50 L79 60 L70 54 L61 60 L64 50 L56 44 L66 44 Z',
    ],
    extra: '<path class="stroke twinkle" d="M20 14 L26 20 M120 14 L114 20 M14 72 H22 M118 72 H126"/>',
  },
  bridge: { // Howrah Bridge, Kolkata
    strokes: [
      'M4 98 C48 97 92 99 136 98',
      'M30 98 V30 M40 98 V30 M100 98 V30 M110 98 V30', 'M28 30 H42 M98 30 H112',
      'M4 90 L35 30 Q70 74 105 30 L136 90',
      'M40 90 L52 52 L62 74 L78 74 L88 52 L100 90',
      'M4 90 L18 62 L30 90 M136 90 L122 62 L110 90',
    ],
    extra: '<path class="stroke wave" d="M2 114 q8 -5 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0"/><path class="stroke wave" style="animation-delay:-1.3s" opacity=".5" d="M14 126 q8 -5 16 0 t16 0 t16 0 t16 0 t16 0 t16 0 t16 0"/>',
  },
  cap: {
    strokes: [
      'M70 28 L126 50 L70 72 L14 50 Z',
      'M38 62 C37 70 39 78 38 86 C52 98 88 98 102 86 C101 78 103 70 102 62',
      'M64 50 C66 48 74 48 76 50',
    ],
    extra: '<g class="swing"><path class="stroke" d="M70 50 C88 50 104 52 114 56 L114 84"/><path class="stroke" d="M109 84 L114 98 L119 84 Z"/></g>',
  },
  robot: {
    strokes: [
      'M36 40 C58 39 82 41 104 40 C105 58 103 78 104 96 C82 97 58 95 36 96 C35 78 37 58 36 40',
      'M70 40 V26', ring(70, 20, 5),
      ring(54, 62, 8), ring(86, 62, 8),
      'M54 82 C62 86 78 86 86 82',
      'M36 60 H28 V78 H36 M104 60 H112 V78 H104',
      'M50 96 V112 M90 96 V112 M42 112 H58 M82 112 H98',
    ],
    extra: '<g class="look"><circle class="ink" cx="54" cy="62" r="3"/><circle class="ink" cx="86" cy="62" r="3"/></g><circle class="ink pulse" cx="70" cy="20" r="2.5"/>',
  },
  envelope: {
    strokes: [
      'M20 44 C54 43 86 45 120 44 C121 66 119 88 120 110 C86 111 54 109 20 110 C19 88 21 66 20 44',
      'M20 44 L70 82 L120 44',
      'M20 110 L58 74 M120 110 L82 74',
    ],
    extra: '<path class="stroke float" d="M70 30 C66 22 56 24 58 32 C60 37 70 42 70 42 C70 42 80 37 82 32 C84 24 74 22 70 30 Z"/>',
  },
};

// A hand-drawn arrow from (x1, y1) to (x2, y2): a slightly bowed stroke with an open head.
function doodleArrow(x1, y1, x2, y2, bow = 12) {
  const [dx, dy] = [x2 - x1, y2 - y1];
  const len = Math.hypot(dx, dy);
  const [nx, ny] = [-dy / len, dx / len];
  const c1 = [x1 + dx / 3 + nx * bow, y1 + dy / 3 + ny * bow];
  const c2 = [x1 + (2 * dx) / 3 - nx * bow, y1 + (2 * dy) / 3 - ny * bow];
  const a = Math.atan2(y2 - c2[1], x2 - c2[0]);
  const head = [a + 2.6, a - 2.6].map((t) => `M${x2} ${y2} L${(x2 + 10 * Math.cos(t)).toFixed(1)} ${(y2 + 10 * Math.sin(t)).toFixed(1)}`).join(' ');
  const f = (p) => p.map((v) => v.toFixed(1)).join(' ');
  return [`M${x1} ${y1} C${f(c1)} ${f(c2)} ${x2} ${y2}`, head];
}

// s.rows = [{ flow?, items: [{ art, label }] }]. A row lays its items out `cols` to a line (4 wide, 2 stacked);
// a flow row joins them with arrows and snakes back on each new line (1 2 / 4 3) so every arrow stays short.
function doodleCard(s, fig) {
  const parts = [kicker(s.kicker, fig)];
  const z = W < 500 ? 0.78 : 1; // phones draw the doodles smaller so the arrows between them have room
  const B = 140 * z; // doodle box
  const cols = NARROW ? 2 : 4;
  const pad = NARROW ? (R - L - 2 * B) / 4 : 18; // stacked: centre the pair, leaving room for the arrows
  const step = (R - L - 2 * pad - B) / (cols - 1);
  const LINE = B + 66; // box + caption + gap
  const CYCLE = 14;
  const draw = (d, delay) => `<path class="stroke dd" pathLength="1" d="${d}" style="animation-delay:${delay.toFixed(2)}s"/>`;
  const art = [];
  let top = 64;
  let n = 0;
  s.rows.forEach((row, r) => {
    if (r) art.push(`<line class="ln" x1="${L}" y1="${top - 20}" x2="${R}" y2="${top - 20}" stroke-dasharray="2 7" opacity="${tokens.tones.softRule}"/>`);
    const cells = row.items.map((_, k) => {
      const line = Math.floor(k / cols);
      const c = row.flow && line % 2 ? cols - 1 - (k % cols) : k % cols;
      return [L + pad + c * step, top + line * LINE, c];
    });
    row.items.forEach((it, k) => {
      const dd = DOODLES[it.art];
      if (!dd) return void warn(`unknown doodle "${it.art}"`);
      const [x, y, c] = cells[k];
      const t0 = k * 1.4 + r * 0.5;
      const per = dd.strokes.length > 8 ? 0.06 : 0.25;
      let inner = dd.strokes.map((d, j) => draw(d, t0 + j * per)).join('');
      (dd.rings || []).forEach(([cx, cy], j) => {
        inner += `<circle class="stroke pp dd" pathLength="1" cx="${cx}" cy="${cy}" r="7" style="animation-delay:${(t0 + 0.5 + j * 0.15).toFixed(2)}s"/>`;
      });
      if (dd.extra) inner += `<g class="dx" style="animation-delay:${(t0 + 0.8).toFixed(2)}s">${dd.extra}</g>`;
      art.push(`<g transform="translate(${x.toFixed(1)} ${y})${z === 1 ? '' : ` scale(${z})`}"><g class="${dd.cls || ''}">${inner}</g></g>`);
      parts.push(group('fade', 0.4 + t0, text(x + B / 2, y + B + 32, `${pad2(++n)} · ${it.label || ''}`, { size: 11, ls: 3, anchor: 'middle' })));

      const next = cells[k + 1];
      if (row.flow && next) {
        const [a, b] = [[x + B / 2, y + B / 2], [next[0] + B / 2, next[1] + B / 2]];
        let arrow;
        if (a[1] === b[1]) {
          const sx = Math.sign(b[0] - a[0]);
          arrow = doodleArrow(a[0] + sx * (B / 2 + 8), a[1], b[0] - sx * (B / 2 + 8), b[1], 8);
        } else {
          // the turn runs down just outside the doodles, clear of the captions
          const ex = c === 0 ? x - 12 : x + B + 12;
          arrow = doodleArrow(ex, a[1] + 24, ex, b[1] - 24, 6);
        }
        art.push(draw(arrow[0], t0 + 1.2) + draw(arrow[1], t0 + 1.5));
      } else if (!row.flow && c < cols - 1) {
        // sparkles in the gaps between doodles, alternating high and low
        const gx = (x + B + (step - B) / 2).toFixed(1);
        const gy = y + (k % 2 ? B - 20 : 24);
        art.push(`<path class="stroke twinkle" d="M${gx} ${gy - 6} V${gy + 6} M${gx - 6} ${gy} H${+gx + 6}" style="animation-delay:-${((n % 4) * 0.6).toFixed(1)}s"/>`);
      }
    });
    top += Math.ceil(row.items.length / cols) * LINE + 34;
  });

  const boil = [1, 2, 3].map((seed) => `<filter id="boil${seed}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${seed}"/><feDisplacementMap in="SourceGraphic" scale="2.6"/></filter>`).join('');
  const body = art.join('');
  parts.push(`<defs>${boil}</defs>`);
  parts.push(`<g stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${[0, 1, 2].map((k) => `<g class="boil b${k}" filter="url(#boil${k + 1})">${body}</g>`).join('')}</g>`);
  const labels = s.rows.flatMap((row) => row.items.map((it) => it.label));
  return {
    w: W, h: top - 42, label: `${s.alt}: ${labels.join(', ')}`,
    css: [
      `.dd{stroke-dasharray:1;stroke-dashoffset:1;animation:doodle ${CYCLE}s cubic-bezier(.5,0,.3,1) infinite both}`,
      '@keyframes doodle{0%{stroke-dashoffset:1}8%{stroke-dashoffset:0}76%{stroke-dashoffset:0}84%,100%{stroke-dashoffset:1}}',
      // a doodle's extras come and go with its strokes
      `.dx{animation:dx ${CYCLE}s ease infinite both}`,
      '@keyframes dx{0%{opacity:0}6%,74%{opacity:1}80%,100%{opacity:0}}',
      '.boil{opacity:0;animation:boil .45s steps(1) infinite}.b1{animation-delay:-.15s}.b2{animation-delay:-.3s}',
      '@keyframes boil{0%{opacity:1}33.4%,100%{opacity:0}}',
      '.twinkle{transform-box:fill-box;transform-origin:center;animation:twinkle 2.2s ease-in-out infinite}',
      '@keyframes twinkle{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.25;transform:scale(.6)}}',
      '.bob{animation:bob 2.6s ease-in-out infinite}',
      '@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}',
      '.flame{transform-box:fill-box;transform-origin:top;animation:flame .18s steps(2) infinite alternate}',
      '@keyframes flame{from{transform:scaleY(1)}to{transform:scaleY(.7)}}',
      '.steam{animation:steam 2.1s ease-in infinite}',
      '@keyframes steam{0%{opacity:0;transform:translateY(8px)}30%{opacity:1}100%{opacity:0;transform:translateY(-8px)}}',
      '.float{animation:float 2.4s ease-in-out infinite}',
      '@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}',
      '.wave{animation:wave 2.6s ease-in-out infinite alternate}',
      '@keyframes wave{from{transform:translateX(-4px)}to{transform:translateX(4px)}}',
      '.swing{transform-origin:70px 50px;animation:swing 2.8s ease-in-out infinite}',
      '@keyframes swing{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(5deg)}}',
      '.look{animation:look 4s steps(1) infinite}',
      '@keyframes look{0%,100%{transform:translateX(0)}30%{transform:translateX(-3px)}60%{transform:translateX(3px)}}',
      '@media (prefers-reduced-motion:reduce){.dd{animation:none;stroke-dashoffset:0}.boil{animation:none}.b0{opacity:1}.twinkle,.bob,.flame,.dx,.steam,.float,.wave,.swing,.look{animation:none}}',
    ],
    body: parts.join('\n  '),
  };
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
    const [dx, tx] = NARROW ? [L + 6, L + 26] : [60, 82];
    parts.push(`<circle class="stroke ring" cx="${dx}" cy="79" r="5"/><circle class="ink pulse" cx="${dx}" cy="79" r="4"/>`);
    parts.push(group('rise', 0.3, text(tx, 84, 'Offline — nothing played yet', { size: 16 })));
    parts.push(group('fade', 0.6, text(tx, 106, truncate('THE NEXT TRACK SHOWS UP HERE AUTOMATICALLY', 10, 2, R - tx), { size: 10, ls: 2, op: 0.6 })));
    return { w: W, h: 130, label: s.alt, body: parts.join('\n  ') };
  }
  const A = NARROW ? 100 : 136; // cover size
  const top = 64;
  const x0 = L + A + (NARROW ? 20 : 32);
  const max = R - x0;
  if (cover) {
    parts.push(`<filter id="mono"><feColorMatrix type="saturate" values="0"/></filter>`);
    parts.push(group('fade', 0.2, `<image href="${cover}" x="${L}" y="${top}" width="${A}" height="${A}" preserveAspectRatio="xMidYMid slice" filter="url(#mono)"/>`
      + `<rect class="stroke" x="${L + 0.5}" y="${top + 0.5}" width="${A - 1}" height="${A - 1}"/>`));
  } else {
    const [cx, cy] = [L + A / 2, top + A / 2];
    const grooves = [60, 50, 40].map((r) => `<circle class="stroke" cx="${cx}" cy="${cy}" r="${r}" opacity="${r === 60 ? 1 : tokens.tones.softRule * 0.6}"/>`).join('');
    // the disc is drawn for the wide cover and scaled down to the narrow one
    const k = A / 136;
    const fit = k === 1 ? '' : ` transform="translate(${cx} ${cy}) scale(${k.toFixed(3)}) translate(${-cx} ${-cy})"`;
    parts.push(group('fade', 0.2, `<g${fit}><g class="${t.playing ? 'spin' : ''}">${grooves}<circle class="ink" cx="${cx}" cy="${cy}" r="20"/>`
      + `<path class="ln" d="M${cx + 26} ${cy - 30} A40 40 0 0 1 ${cx + 38} ${cy - 12}" stroke-width="2"/><circle class="stroke" cx="${cx}" cy="${cy}" r="3"/></g></g>`));
  }

  let status;
  if (t.playing) {
    const bars = [0, 0.3, 0.15, 0.45, 0.6].map((d, i) => `<rect class="ink eq" x="${x0 + i * 6}" y="68" width="3" height="14" style="animation-delay:-${d}s"/>`).join('');
    status = bars + text(x0 + 40, 82, 'PLAYING NOW', { size: 11, ls: 3 });
  } else if (t.playedAt) {
    const d = new Date(Date.parse(t.playedAt) + (s.utcOffset || 0) * 3600000);
    const hm = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    const when = NARROW ? `${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} · ${hm}` : `${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${hm}${s.tz ? ` ${s.tz}` : ''}`;
    status = text(x0, 82, `${NARROW ? 'PLAYED' : 'LAST PLAYED'} · ${when}`, { size: 11, ls: 3 });
  } else status = text(x0, 82, 'PAUSED', { size: 11, ls: 3 });
  parts.push(group('fade', 0.3, status));
  const ts = NARROW ? 22 : 28; // title size
  parts.push(group('rise', 0.4, text(x0, 122, truncate(t.title, ts, -0.5, max), { size: ts, ls: -0.5 })));
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
  const size = NARROW ? 64 : 112;
  const y = NARROW ? 88 : 128;
  const dash = Math.round(width(sg.text, size, -4) * 3); // longer than any glyph outline
  return {
    w: W, h: y + 68, label: `${sg.text} — ${sg.caption}`,
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
  if (NARROW) {
    // status, note and the right-hand text stacked
    const tx = L + 26;
    const parts = [line(L, 24, R, 24, { draw: true }),
      `<circle class="stroke ring" cx="${L + 6}" cy="64" r="5"/><circle class="ink pulse" cx="${L + 6}" cy="64" r="4"/>`,
      text(tx, 68, f.status, { size: 12, ls: 3 })];
    let y = 92;
    for (const ln of wrap(f.note, 11, 2, R - tx)) {
      parts.push(text(tx, y, ln, { size: 11, ls: 2 }));
      y += 18;
    }
    parts.push(text(tx, y + 12, right, { size: 13 }));
    return { w: W, h: y + 40, label: `${f.status}. ${right}`, body: parts.join('\n  ') };
  }
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
  if (!res.ok) throw Object.assign(new Error(`${res.status} ${res.statusText} — ${url}`), { status: res.status });
  return json ? res.json() : res.text();
}
// like get(), but a 404 is an answer (null) rather than a failure
const getOrNull = (url) => get(url, true).catch((e) => {
  if (e.status === 404) return null;
  throw e;
});

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

// ─── discovery: every repo and package on the account, so new ones reach the README on their own ─────────────

const lc = (s) => String(s || '').toLowerCase();
const fullName = (repo) => (repo.includes('/') ? repo : `${profile.user}/${repo}`);
const discover = profile.discover || {};

// All repositories the user owns, newest first.
async function fetchRepos(user) {
  const repos = [];
  for (let page = 1; page <= 10; page++) {
    const j = await get(`https://api.github.com/users/${user}/repos?per_page=100&type=owner&sort=created&page=${page}`, true);
    repos.push(...j);
    if (j.length < 100) break;
  }
  return repos.map((r) => ({
    full: r.full_name, name: r.name, description: r.description || '', homepage: r.homepage || '', language: r.language || '',
    topics: r.topics || [], stars: r.stargazers_count, forks: r.forks_count, created: r.created_at, pushed: r.pushed_at,
    fork: r.fork, archived: r.archived,
  }));
}

// Repos pinned on the GitHub profile (GraphQL only, so it needs a token; GITHUB_TOKEN in Actions is enough).
async function fetchPinned(user) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': `${user}-readme-theme`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'query($u:String!){user(login:$u){pinnedItems(first:6,types:REPOSITORY){nodes{... on Repository{nameWithOwner}}}}}',
      variables: { u: user },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — graphql`);
  const j = await res.json();
  if (j.errors) throw new Error(`graphql: ${j.errors[0].message}`);
  return j.data.user.pinnedItems.nodes.map((n) => n.nameWithOwner);
}

// Owned repos the README may show: forks, archived, excluded and hideTopic-tagged repos are left out.
async function ownRepos() {
  const all = (await live('repos', () => fetchRepos(profile.user))) || [];
  const exclude = new Set((discover.exclude || []).map((r) => lc(fullName(r))));
  const hide = discover.hideTopic || 'hide-from-readme';
  return all.filter((r) => (discover.includeForks || !r.fork) && (discover.includeArchived || !r.archived)
    && !exclude.has(lc(r.full)) && !r.topics.includes(hide));
}

const DAY = 86400000;
const isNew = (r) => Date.now() - Date.parse(r.created) < (discover.newDays ?? 30) * DAY;
const repoUrl = (full) => `https://github.com/${full}`;
// "owner/name" of a github.com URL (git+https://github.com/a/b.git, https://github.com/a/b#readme, …)
const githubRepoOf = (url) => /github\.com[/:]([^/\s]+\/[^/\s#?]+?)(?:\.git)?(?:[/#?]|$)/i.exec(url || '')?.[1] || null;
const REGISTRY_LINK = [['pypi', /pypi\.org\/project\/([^/?#]+)/i], ['npm', /npmjs\.com\/package\/((?:@[^/]+\/)?[^/?#]+)/i]];

// Packages published from the user's repos, found three ways: a repo homepage that links to PyPI / npm, npm's
// maintainer search, and a PyPI / npm package named after a repo whose metadata links back to that repo.
async function discoverPackages(repos) {
  const found = new Map();
  const add = (registry, name, repo) => {
    const k = `${registry}:${lc(name)}`;
    if (!found.has(k)) found.set(k, { registry, name, repo });
    else if (repo && !found.get(k).repo) found.get(k).repo = repo;
  };
  for (const r of repos) for (const [registry, re] of REGISTRY_LINK) {
    const m = re.exec(r.homepage);
    if (m) add(registry, decodeURIComponent(m[1]), r.full);
  }
  if (discover.npmUser) {
    const j = await get(`https://registry.npmjs.org/-/v1/search?text=maintainer:${encodeURIComponent(discover.npmUser)}&size=250`, true);
    for (const o of j.objects || []) add('npm', o.package.name, githubRepoOf(o.package.links?.repository));
  }
  const claimed = new Set([...found.values()].map((p) => lc(p.repo)));
  const linksBack = (urls, r) => urls.some((u) => lc(githubRepoOf(u)) === lc(r.full));
  await Promise.all(repos.filter((r) => !claimed.has(lc(r.full))).map(async (r) => {
    const name = lc(r.name);
    if (r.language === 'Python' || r.language === 'Jupyter Notebook') {
      const info = (await getOrNull(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`))?.info;
      if (info && linksBack([info.home_page, ...Object.values(info.project_urls || {})], r)) add('pypi', info.name, r.full);
    } else if (r.language === 'JavaScript' || r.language === 'TypeScript') {
      const pkg = await getOrNull(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`);
      if (pkg && linksBack([pkg.repository?.url ?? pkg.repository, pkg.homepage, pkg.bugs?.url], r)) add('npm', pkg.name, r.full);
    }
  }));
  return [...found.values()];
}

// The packages section's list: its items (hand-written notes, or packages discovery cannot see) plus,
// with auto on, every discovered package.
async function packageList(s) {
  const items = (s.items || []).map((it) => ({ ...it }));
  if (s.auto) {
    const found = (await live('packageList', async () => discoverPackages(await ownRepos()))) || [];
    for (const p of found) {
      const it = items.find((m) => m.registry === p.registry && lc(m.name) === lc(p.name));
      if (it) it.repo = it.repo || p.repo;
      else items.push(p);
    }
  }
  return items;
}

// Ranks a repo for SELECTED WORK when nothing else decides: stars and forks first, then a live site, a written
// description, topics and recent pushes.
function repoScore(r) {
  const age = (Date.now() - Date.parse(r.pushed)) / DAY;
  return r.stars * 5 + r.forks * 3 + (r.homepage ? 3 : 0) + (r.description ? 2 : 0) + Math.min(r.topics.length, 5) * 0.5
    + (age < 90 ? 4 : age < 365 ? 2 : 0);
}

// SELECTED WORK picks, in order: brand-new repos, the section's items, repos pinned on GitHub or tagged with
// featureTopic, then the best-scoring rest — package repos are left to PUBLISHED. Without auto: just the items.
async function projectList(s) {
  const user = profile.user;
  const items = s.items || [];
  const itemFor = (full) => items.find((it) => lc(fullName(it.repo)) === lc(full)) || {};
  let picks = items.map((it) => fullName(it.repo));
  let repos = [];
  if (s.auto) {
    repos = await ownRepos();
    const pkgSection = profile.sections.find((x) => x.type === 'packages');
    const pkgRepos = new Set((pkgSection ? await packageList(pkgSection) : []).map((p) => lc(p.repo)).filter(Boolean));
    const pinned = (TOKEN ? await live('pinned', () => fetchPinned(user)) : cache.pinned) || [];
    const pool = repos.filter((r) => !pkgRepos.has(lc(r.full)) && lc(r.full) !== lc(`${user}/${user}`));
    const inPool = (full) => pool.some((r) => lc(r.full) === lc(full));
    const feature = discover.featureTopic || 'featured';
    picks = [
      ...pool.filter(isNew).map((r) => r.full),
      ...picks,
      ...pinned.filter(inPool),
      ...pool.filter((r) => r.topics.includes(feature)).map((r) => r.full),
      ...[...pool].sort((a, b) => repoScore(b) - repoScore(a)).map((r) => r.full),
    ];
    picks = picks.filter((full, i) => picks.findIndex((x) => lc(x) === lc(full)) === i).slice(0, s.max || 6);
  }
  // items for repos outside the owned list (another owner's repo, or no repo data yet) are looked up one by one
  const missing = picks.filter((full) => !repos.some((r) => lc(r.full) === lc(full)));
  const looked = missing.length ? (await live('projects', () => fetchProjects(user, missing.map((repo) => ({ repo }))))) || [] : [];
  return picks.map((full) => {
    const it = itemFor(full);
    const r = repos.find((x) => lc(x.full) === lc(full));
    const l = looked.find((x) => lc(x.repo) === lc(full)) || {};
    const topics = r ? r.topics.filter((t) => lc(t) !== lc(r.language)).slice(0, 3) : [];
    const language = r ? r.language : l.language;
    return {
      name: it.name || (r ? r.name.replace(/[-_]+/g, ' ') : full.split('/')[1]),
      note: it.note || (r ? r.description : l.description) || '',
      tags: it.tags || [language, ...topics].filter(Boolean),
      stars: (r ? r.stars : l.stars) ?? 0, forks: (r ? r.forks : l.forks) ?? 0, pushed: r ? r.pushed : l.pushed,
      demo: it.demo ?? (r ? r.homepage : l.homepage), url: repoUrl(full), fresh: !!r && isNew(r),
    };
  });
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
  const out = [pic(emit(`s${pad2(num)}`, () => divider(num, s.title)), `${pad2(num)} — ${s.title}`)];
  let k = 0;
  const fig = () => `FIG. ${pad2(num)}.${++k}`;
  let f; // the figure label of the card being emitted (taken once, then drawn in both layouts)
  const name = slugify(s.title);
  const user = profile.user;

  switch (s.type) {
    case 'card':
      f = fig();
      out.push(pic(emit(name, () => whoamiCard(s, f)), s.alt));
      break;
    case 'writing': {
      const posts = (await live('posts', () => fetchPosts(s.feed, s.max))) || [];
      const fmt = (iso) => `${iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
      f = fig();
      out.push(pic(emit(name, () => listCard(s.kicker, f, posts.map((p) => ({ title: p.title, meta: fmt(p.date) })), s.alt)), s.alt));
      s.links = [...posts.map((p, i) => ({ label: `${s.badgePrefix} Nº ${pad2(i + 1)} ↗`, url: p.url })), ...(s.links || [])];
      break;
    }
    case 'activity': {
      const items = (await live('activity', () => fetchActivity(user, s))) || [];
      f = fig();
      out.push(pic(emit(name, () => listCard(s.kicker, f, items.map((a) => ({ title: a.text, meta: a.kind })), s.alt)), s.alt));
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
      f = fig();
      out.push(pic(emit('telemetry', () => telemetryCard(days, f)), 'Contribution telemetry'));
      const cards = s.cards.map(monoAsset).filter(Boolean);
      const rows = [];
      for (let i = 0; i < cards.length; i += 2) rows.push(center(cards.slice(i, i + 2).join(' ')));
      // a <details> fold is the one real click interaction GitHub allows in a README
      out.push(s.collapse ? `<details>\n<summary>${badge(s.collapse)}</summary>\n\n${rows.join('\n\n')}\n\n</details>` : rows.join('\n\n'));
      const repos = (await live('topRepos', () => fetchTopRepos(user, s.excludeRepos || [], s.topRepos))) || [];
      f = fig();
      out.push(pic(emit('top-repos', () => topReposCard(repos, f, user)), 'Top repositories by commits'));
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
      const pkgList = pkgSection ? await packageList(pkgSection) : [];
      const pkgs = (pkgList.length && (await live('packages', () => fetchPackages(pkgList)))) || [];
      const since = g.created ? g.created.slice(0, 4) : '';
      const stat = {
        contributions: days.reduce((a, d) => a + d.count, 0),
        repos: g.repos, stars: g.stars, forks: g.forks, followers: g.followers,
        downloads: pkgs.reduce((a, p) => a + (p.downloads || 0), 0),
        years: since ? new Date().getUTCFullYear() - +since : undefined,
      };
      const items = s.items.map((it) => ({ label: it.label, caption: (it.caption || '').replace('{since}', since), value: it.value ?? stat[it.stat] ?? '—' }));
      f = fig();
      out.push(pic(emit(name, () => glanceCard(s, f, items)), s.alt));
      break;
    }
    case 'stack':
      f = fig();
      out.push(pic(emit(name, () => stackCard(s, f)), s.alt));
      break;
    case 'terminal':
      f = fig();
      out.push(pic(emit(name, () => terminalCard(s, f)), s.alt));
      break;
    case 'contact':
      f = fig();
      out.push(`<a href="mailto:${esc(s.email)}">${pic(emit(name, () => contactCard(s, f)), s.alt)}</a>`);
      break;
    case 'currently':
      f = fig();
      out.push(pic(emit(name, () => currentlyCard(s, f)), s.alt));
      break;
    case 'projects': {
      const projects = await projectList(s);
      f = fig();
      out.push(pic(emit(name, () => projectsCard(s, f, projects)), s.alt));
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
      const list = await packageList(s);
      const live_ = (list.length && (await live('packages', () => fetchPackages(list)))) || [];
      const pkgs = list.map((it) => {
        const r = live_.find((x) => lc(x.name) === lc(it.name)) || {};
        return { registry: it.registry, name: it.name, note: it.note || r.summary || '', version: r.version, downloads: r.downloads };
      });
      if (s.auto) pkgs.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
      f = fig();
      out.push(pic(emit(name, () => packagesCard(s, f, pkgs)), s.alt));
      s.links = [...pkgs.map((p) => ({ label: `${p.name.toUpperCase()} ↗`, url: PACKAGE_URL[p.registry](p.name) })), ...(s.links || [])];
      break;
    }
    case 'repos': {
      // newest repos on the account, packages marked as such
      const pkgSection = profile.sections.find((x) => x.type === 'packages');
      const pkgRepos = new Set((pkgSection ? await packageList(pkgSection) : []).map((p) => lc(p.repo)).filter(Boolean));
      const repos = (await ownRepos()).filter((r) => lc(r.full) !== lc(`${user}/${user}`))
        .sort((a, b) => b.created.localeCompare(a.created)).slice(0, s.max || 6);
      const meta = (r) => [isNew(r) && 'NEW', pkgRepos.has(lc(r.full)) && 'PACKAGE', monthYear(r.created)].filter(Boolean).join(' · ');
      const title = (r) => (r.description ? `${r.name} — ${r.description.length > 90 ? `${r.description.slice(0, 89).trim()}…` : r.description}` : r.name);
      f = fig();
      out.push(pic(emit(name, () => listCard(s.kicker, f, repos.map((r) => ({ title: title(r), meta: meta(r) })), s.alt)), s.alt));
      s.links = [...repos.map((r) => ({ label: `${r.name.toUpperCase()} ↗`, url: repoUrl(r.full) })), ...(s.links || [])];
      break;
    }
    case 'markdown':
      // hand-written Markdown / HTML, inline (text: a string or a list of lines) or from a file next to the README
      out.push(s.file ? fs.readFileSync(path.join(ROOT, s.file), 'utf8').trim() : [].concat(s.text || []).join('\n'));
      break;
    case 'route':
      f = fig();
      out.push(pic(emit(name, () => routeCard(s, f)), s.alt));
      s.links = [...s.items.filter((it) => it.link).map((it) => it.link), ...(s.links || [])];
      break;
    case 'spotify': {
      const t = await live('spotify', fetchSpotify);
      const cover = await coverData(t?.cover);
      f = fig();
      out.push(`<a href="${esc(s.profile)}">${pic(emit(name, () => nowPlayingCard(s, f, t, cover)), s.alt)}</a>`);
      break;
    }
    case 'doodle':
      f = fig();
      out.push(pic(emit(name, () => doodleCard(s, f)), s.alt));
      break;
    case 'quote': {
      const day = Math.floor(Date.now() / 86400000);
      const i = day % s.quotes.length;
      const [q, a] = s.quotes[i];
      out.push(pic(emit(name, () => quoteCard(s, `Nº ${pad2(i + 1)} / ${pad2(s.quotes.length)} — DAILY`, q, a)), s.alt));
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

// "hidden": true keeps a section in profile.json without rendering it
const sections = profile.sections.filter((s) => !s.hidden);

async function main() {
  if (ONLY) {
    for (const mode of MODES) fs.mkdirSync(path.join(ASSETS, mode), { recursive: true });
    for (const [i, s] of sections.entries()) if (s.type === ONLY) await renderSection(s, i + 1);
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
      pic(emit('header', () => header(profile.header)), `${profile.header.name} — ${profile.header.tagline}`),
      profile.links.map((l) => badge(l.label, l.url)).join(' '),
      `<a href="${esc(profile.typing.link)}">${picture(typingSvg('light'), typingSvg('dark'), profile.typing.lines.join(' — '))}</a>`,
      ...(profile.ticker ? [pic(emit('ticker', () => tickerCard(profile.ticker)), profile.ticker.items.join(' · '))] : []),
    ].join('\n\n')),
  ];
  for (const [i, s] of sections.entries()) md.push(await renderSection(s, i + 1));
  if (profile.signature) md.push(pic(emit('signature', () => signatureCard(profile.signature)), profile.signature.text));
  md.push(pic(emit('footer', () => footer(profile.footer)), profile.footer.status));

  fs.writeFileSync(OUTPUT, md.join('\n\n') + '\n');
  saveCache();

  console.log(`wrote ${path.relative(ROOT, OUTPUT)} + ${emitted.size} assets × ${MODES.length} modes${OFFLINE ? ' (offline)' : ''}`);
  for (const w of warnings) console.warn(`warn: ${w}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
