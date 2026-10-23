// Baskets for Shot Notes' basket pop-up (user 2026-10-09): manufacturer, size, rated dose
// and pressurized (double-wall). Stored as "Brand|mm|g|1" (1 = pressurized), in the notes and
// on the machine (Settings lastBasket) so the pop-up opens on the last one.
export const BASKET_BRANDS = [
  'Stock (came with the machine)',
  'VST',
  'IMS',
  'Pullman',
  'Decent',
  'Sworks Design',
  'Wafo',
  'Pesado',
  'Normcore',
  'IKAPE',
  'Crema Coffee Products',
  'Other',
];
export const BASKET_SIZES_MM = [49, 51, 53, 54, 58];
export const BASKET_GRAMS = [7, 8, 10, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35];

export const splitBasket = s => {
  const [brand = '', mm = '', g = '', p = ''] = String(s || '').split('|');
  return {
    brand: BASKET_BRANDS.includes(brand) ? brand : '',
    mm: BASKET_SIZES_MM.includes(Number(mm)) ? Number(mm) : '',
    g: BASKET_GRAMS.includes(Number(g)) ? Number(g) : '',
    pressurized: p === '1',
  };
};
export const joinBasket = ({ brand, mm, g, pressurized }) =>
  brand || mm || g ? `${brand || ''}|${mm || ''}|${g || ''}|${pressurized ? 1 : 0}` : '';

// "IKAPE 51 mm 18 g, pressurized"; '' when nothing is set.
export const basketName = s => {
  const { brand, mm, g, pressurized } = splitBasket(s);
  const parts = [
    brand === 'Stock (came with the machine)' ? 'Stock' : brand,
    mm && `${mm} mm`,
    g && `${g} g`,
  ].filter(Boolean);
  if (!parts.length) return '';
  return `${parts.join(' ')}${pressurized ? ', pressurized' : ''}`;
};
