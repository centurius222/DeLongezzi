// Custom themes (docs/MULTI_SHAPE_PLAN.txt): one picture made on the 16:10 template (1587 x 991,
// the same layout as the Western pack) becomes a theme. The master layout (customTheme.css, made
// by tools/holiday-packs/gen16.py custom) already sits on the template's windows; a theme only
// adds its colours (themeCss) and its nudges (nudgeVars), set by components/Holiday.jsx.

export const PICTURE_W = 1587;
export const PICTURE_H = 991;

// The groups a theme can move, with the nudge keys for across / up-down (null: not free), in
// picture px. 'x' moves everything across.
export const NUDGE_KEYS = {
  tabs: ['tabsX', 'tabs'],
  top: ['topX', 'top'],
  flow: ['flowX', 'flowY'],
  weight: ['weightX', 'weightY'],
  brew: ['brewX', 'brewY'],
  tare: ['tareX', 'tareY'],
  mid: ['midX', 'mid'],
  temp: ['tempX', 'tempY'],
  pressure: ['pressureX', 'pressureY'],
  tank: ['tankX', 'tank'],
  controls: ['controlsX', 'controls'],
  chart: ['chartX', 'chart'],
  menu: ['menuX', 'menu'],
  clock: ['clockX', 'clockY'],
};

// A theme's nudges as the master's CSS variables (--n-<group>x / --n-<group>y, --n-x).
export function nudgeVars(nudge = {}) {
  const vars = { '--n-x': String(nudge.x || 0) };
  for (const [group, [kx, ky]] of Object.entries(NUDGE_KEYS)) {
    if (kx) vars[`--n-${group}x`] = String(nudge[kx] || 0);
    if (ky) vars[`--n-${group}y`] = String(nudge[ky] || 0);
  }
  return vars;
}

// The bars round the picture on screens of another shape: the picture's edge colours, darkened
// (left/right for wider screens, top/bottom for squarer ones). From an <img> or ImageBitmap.
export function barColours(picture) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 40;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(picture, 0, 0, 64, 40);
  const avg = (x, y, w, h) => {
    const d = g.getImageData(x, y, w, h).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k];
    const n = d.length / 4;
    return `#${sum
      .map(v =>
        Math.round((v / n) * 0.8)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  };
  return {
    lr: `linear-gradient(to right, ${avg(0, 0, 1, 40)}, ${avg(63, 0, 1, 40)})`,
    tb: `linear-gradient(to bottom, ${avg(0, 0, 64, 1)}, ${avg(0, 39, 64, 1)})`,
  };
}

// ---------------------------------------------------------------- a theme's colours

const GATE = ":root[data-custom-theme]:has([data-slot='manual'])";

// The colour and the glow: the mode buttons' words and icons, Tare, the tank bar, the slider.
export function themeCss({ neon, glow = 100 }) {
  const R = [];
  const { tabCore: core, edge, a } = glowColours(neon, glow);
  const halo = px => (a ? `0 0 ${px}px ${withAlpha(neon, a)}` : '');
  const tabShadow = a ? [halo(2), halo(7), halo(14), `0 0 24px ${withAlpha(neon, 0.6 * a)}`].join(', ') : 'none';
  const stroke = `${(a ? Math.max(1.5, 2.5 * a) : 0).toFixed(2)}px ${edge}`;
  R.push(
    `${GATE} [data-slot='mode-tab'], ${GATE} [data-slot='mode-tab'][data-active], ${GATE} [data-metric='weight'] > [data-part='sub'] button, ${GATE} [data-metric='weight'] > [data-part='sub'] button:disabled { --neon: ${neon}; color: ${core} !important; -webkit-text-stroke: ${stroke}; text-shadow: ${tabShadow} !important; }`,
  );
  R.push(
    `${GATE} [data-slot='mode-tab']::before { background: ${core} !important; filter: ${a ? `drop-shadow(0 0 2px ${withAlpha(neon, a)}) drop-shadow(0 0 6px ${withAlpha(neon, a)}) drop-shadow(0 0 12px ${withAlpha(neon, a)})` : 'none'} !important; }`,
  );
  R.push(
    `${GATE} [data-card='tank'] [data-slot='tank-bar'] { background: repeating-linear-gradient(135deg, #ffffff 0 9px, ${neon} 9px 18px) !important; }`,
  );
  R.push(`${GATE} [data-card='controls'] input[type='range'] { color: ${neon} !important; }`);
  return `@media (orientation: landscape) {\n${R.join('\n')}\n}\n`;
}

// "#rrggbb" with an alpha 0-1, as "#rrggbbaa".
export function withAlpha(hex, a) {
  const v = Math.round(Math.max(0, Math.min(1, a)) * 255);
  return hex + v.toString(16).padStart(2, '0');
}

// The glow (0-100 %): at 100 the text is a white-hot core in a coloured edge with a halo, like a
// neon tube; lower dims the edge and halo; at 0 there is no glow and the text is the colour itself.
// Full glow matches the Classic Cars pack's digits (core #ffc49a in a #f52a10 edge, a deeper
// glow): the readouts' core is the colour 65% of the way to white; the mode buttons' words
// (like Classic Cars' #fff6f4) 95%; the middle of the glow a darker shade of the colour.
export function glowColours(neon, glow = 100) {
  const a = Math.max(0, Math.min(100, glow)) / 100;
  const v = parseInt(neon.slice(1), 16);
  const rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const toWhite = w => `rgb(${rgb.map(c => Math.round(c + (255 - c) * w)).join(', ')})`;
  const deep = `#${rgb
    .map(c =>
      Math.round(c * 0.85)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
  // The core stays a neon tube's light inside at any glow (the slider only sets the edge and
  // halo around it); only 0 % makes the letters flat, the colour itself.
  const lit = a > 0 ? 1 : 0;
  return {
    a,
    core: toWhite(0.65 * lit),
    tabCore: toWhite(0.95 * lit),
    edge: a ? withAlpha(neon, Math.max(0.6, a)) : 'transparent', // the tube's edge stays visible at low glow
    glow: a
      ? `0 0 2px ${withAlpha(neon, a)}, 0 0 7px ${withAlpha(deep, a)}, 0 0 16px ${withAlpha(deep, 0.7 * a)}`
      : 'none',
  };
}

// Chart.js gets plain colours (it may not understand color-mix()).
export function neonShades(neon) {
  const v = parseInt(neon.slice(1), 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const mix = (t, c) => Math.round(c + (255 - c) * t);
  const text = `rgb(${mix(0.8, r)}, ${mix(0.8, g)}, ${mix(0.8, b)})`;
  return {
    text,
    grid: `rgba(${r}, ${g}, ${b}, 0.12)`,
    caption: `rgb(${mix(0.75, r)}, ${mix(0.75, g)}, ${mix(0.75, b)})`,
  };
}
