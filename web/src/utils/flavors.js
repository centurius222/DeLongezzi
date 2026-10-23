// Flavour groups for Shot Notes' flavour wheel (user 2026-10-09): our chart's list
// (mockups/gpt/CoffeeWheel4.jpg) plus the official SCA/WCR wheel's Sour/Fermented and
// off-note groups and its extra flavours. Our own drawing and grouping; words only.
export const GROUPS = [
  {
    name: 'Floral',
    color: '#e7a1c4',
    items: [
      'Hibiscus',
      'Rose',
      'Rose hips',
      'Jasmine',
      'Honeysuckle',
      'Chamomile',
      'Lavender',
      'Magnolia',
      'Orange blossom',
      'Lemongrass',
      'Bergamot',
    ],
  },
  {
    name: 'Fruit',
    color: '#f0c43c',
    subs: {
      Citrus: ['Lemon', 'Lime', 'Grapefruit', 'Clementine', 'Tangerine', 'Mandarin', 'Orange'],
      'Apple / pear': ['Green apple', 'Red apple', 'Pear'],
      Melon: ['Watermelon', 'Honeydew', 'Cantaloupe'],
      Grape: ['White grape', 'Green grape', 'Red grape', 'Concord grape', 'Wine'],
      Tropical: [
        'Lychee',
        'Star fruit',
        'Tamarind',
        'Passion fruit',
        'Pineapple',
        'Mango',
        'Papaya',
        'Kiwi',
        'Banana',
        'Coconut',
        'Pomegranate',
      ],
      'Stone fruit': ['Peach', 'Nectarine', 'Apricot', 'Plum', 'Cherry', 'Black cherry'],
      Berry: [
        'Cranberry',
        'Raspberry',
        'Strawberry',
        'Blueberry',
        'Blackberry',
        'Red currant',
        'Black currant',
      ],
      'Dried fruit': ['Golden raisin', 'Raisin', 'Dried fig', 'Dried dates', 'Prune'],
    },
  },
  {
    name: 'Sour / Fermented',
    short: 'Sour',
    color: '#c9d64a',
    items: ['Sour', 'Winey', 'Whiskey', 'Fermented', 'Overripe', 'Vinegar'],
  },
  {
    name: 'Chocolate',
    color: '#a0714f',
    items: [
      'Cacao nibs',
      'Dark chocolate',
      "Baker's chocolate",
      'Bittersweet chocolate',
      'Cocoa powder',
      'Milk chocolate',
    ],
  },
  {
    name: 'Sweet & Sugary',
    short: 'Sweet',
    color: '#f2b45a',
    items: [
      'Vanilla',
      'Nougat',
      'Honey',
      'Butter',
      'Cream',
      'Marshmallow',
      'Sugar cane',
      'Brown sugar',
      'Caramel',
      'Maple syrup',
      'Molasses',
      'Cola',
    ],
  },
  {
    name: 'Nut',
    color: '#e8954a',
    items: ['Almond', 'Hazelnut', 'Pecan', 'Cashew', 'Peanut', 'Walnut'],
  },
  {
    name: 'Grain & Cereal',
    short: 'Grain',
    color: '#d9b26b',
    items: [
      'Sweet bread pastry',
      'Granola',
      'Graham cracker',
      'Rye',
      'Wheat',
      'Barley',
      'Malt',
      'Fresh bread',
    ],
  },
  {
    name: 'Roast',
    color: '#b08a6a',
    items: ['Toast', 'Brown roast', 'Burnt sugar', 'Smoky', 'Ashy', 'Acrid', 'Carbon'],
  },
  {
    name: 'Spice',
    color: '#e0664f',
    items: [
      'Black pepper',
      'White pepper',
      'Pungent',
      'Cinnamon',
      'Coriander',
      'Ginger',
      'Nutmeg',
      'Curry',
      'Anise / licorice',
      'Clove',
    ],
  },
  {
    name: 'Savory',
    color: '#e8737a',
    items: ['Leathery', 'Meat-like', 'Soy sauce', 'Sundried tomato', 'Tomato'],
  },
  {
    name: 'Green / Earthy / Herb',
    short: 'Green',
    color: '#9fc06a',
    items: [
      'Soil',
      'Fresh wood',
      'Cedar',
      'Tobacco',
      'Hay / straw',
      'Leafy greens',
      'Olive',
      'Green pepper',
      'Squash',
      'Mushroom',
      'Sweet pea',
      'Snow pea',
      'Peapod',
      'Beany',
      'Grassy',
      'Dill',
      'Sage',
      'Mint',
      'Green tea',
      'Black tea',
      'Hops',
    ],
  },
  {
    name: 'Off-notes',
    short: 'Off',
    color: '#9aa6b2',
    items: [
      'Papery',
      'Cardboard',
      'Stale',
      'Musty',
      'Damp',
      'Medicinal',
      'Rubber',
      'Petroleum',
      'Skunky',
      'Bitter',
      'Salty',
      'Astringent',
    ],
  },
];

// flavour -> its group's colour, and the canonical name for a lower-case word
export const FLAVOR_COLOR = {};
export const FLAVOR_BY_LOWER = {};
for (const g of GROUPS) {
  for (const f of g.items || Object.values(g.subs).flat()) {
    FLAVOR_COLOR[f] = g.color;
    FLAVOR_BY_LOWER[f.toLowerCase()] = f;
  }
}

export const FLAVOR_LINE = 'Flavours: ';

// The flavours in a Notes text's "Flavours: ..." line.
export const flavorsFromNotes = text =>
  String(text || '')
    .split('\n')
    .filter(l => l.startsWith(FLAVOR_LINE))
    .flatMap(l => l.slice(FLAVOR_LINE.length).split(','))
    .map(s => FLAVOR_BY_LOWER[s.trim().toLowerCase()])
    .filter(Boolean);

// Notes text with its "Flavours: ..." line replaced by these flavours (first line), the rest kept.
export const notesWithFlavors = (text, picked) => {
  const rest = String(text || '')
    .split('\n')
    .filter(l => !l.startsWith(FLAVOR_LINE));
  if (picked.length) rest.unshift(`${FLAVOR_LINE}${picked.join(', ').toLowerCase()}`);
  return rest.join('\n').replace(/\n+$/, '');
};
