// Bean bags for Shot Notes (user 2026-10-09, from the bean picker mockup). The list is kept on the
// machine (/api/beans -> /beans.json), so the phone, tablet and PC share it. A bag:
// { id, roaster, name (product, optional), roast, species, origin, process ('' = not known),
//   decaf, date (roast date, YYYY-MM-DD or ''), savedAt (YYYY-MM-DD), uses }
export const ROASTS = ['Light', 'Medium-light', 'Medium', 'Medium-dark', 'Dark'];
export const SPECIES = ['Arabica', 'Robusta', 'Liberica', 'Excelsa', 'Arabica / Robusta blend'];
export const ORIGINS = [
  'Blend',
  'Bolivia',
  'Brazil',
  'Burundi',
  'China (Yunnan)',
  'Colombia',
  'Costa Rica',
  'Ecuador',
  'El Salvador',
  'Ethiopia',
  'Guatemala',
  'Honduras',
  'India',
  'Indonesia (Sumatra)',
  'Jamaica',
  'Kenya',
  'Mexico',
  'Nicaragua',
  'Panama',
  'Papua New Guinea',
  'Peru',
  'Rwanda',
  'Tanzania',
  'Uganda',
  'Vietnam',
  'Yemen',
];
export const PROCESSES = ['Washed', 'Natural', 'Honey', 'Anaerobic', 'Wet-hulled'];
// Big brands as one tap; anything else is "Other" and typed once.
export const ROASTERS = [
  'Lavazza',
  "Peet's",
  'Illy',
  'Starbucks',
  'Kimbo',
  'Segafredo',
  'Intelligentsia',
  'Stumptown',
  'Blue Bottle',
  'Counter Culture',
  'La Colombe',
  'Death Wish',
];
// A new bag starts on the most common espresso choices.
export const BAG_DEFAULTS = {
  roast: 'Medium',
  species: 'Arabica',
  origin: 'Blend',
  process: 'Washed',
};

// Local calendar days (toISOString would be UTC: yesterday late in the evening).
export const ymd = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDay = s => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
};

// "Clumb · Brazil · Light · Natural"; a bag without a roaster gets "from Oct 9" (the day saved).
export const bagLine = b => {
  if (!b) return '';
  const day = b.savedAt
    ? parseDay(b.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
  return (
    [
      [b.roaster, b.name].filter(Boolean).join(' '),
      b.origin,
      b.roast,
      b.process,
      b.decaf && 'Decaf',
    ]
      .filter(Boolean)
      .join(' · ') + (b.roaster || !day ? '' : ` · from ${day}`)
  );
};
// Days between the roast date and `when` (a Date; the shot's time in Shot Notes).
export const daysOffRoast = (b, when = new Date()) => {
  if (!b?.date) return null;
  const n = Math.floor((when - parseDay(b.date)) / 86400000);
  return n >= 0 ? n : null;
};
export const offRoastText = n => (n == null ? '' : `${n} day${n === 1 ? '' : 's'} off roast`);

export async function loadBeans() {
  try {
    const r = await fetch('/api/beans', { cache: 'no-store' });
    const list = r.ok ? await r.json() : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
export async function saveBeans(list) {
  const r = await fetch('/api/beans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(list),
  });
  if (!r.ok) throw new Error(r.status === 507 ? 'storage full' : `HTTP ${r.status}`);
}
export const newBagId = () =>
  `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
