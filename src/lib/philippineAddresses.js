/**
 * Address choices for the delivery form.
 *
 * The shop serves Camarines Norte, so that province is listed in full, with
 * the barangays of Daet itself. Anywhere else is still reachable: every list
 * ends with "Other", which turns the next box into a plain text field, so an
 * order can be delivered to an address that is not in this file.
 *
 * To cover another municipality, add its barangays to the list below - nothing
 * else needs to change.
 */
export const OTHER = 'Other';

const DAET_BARANGAYS = [
  'Alawihao',
  'Awitan',
  'Bagasbas',
  'Barangay I (Centro)',
  'Barangay II',
  'Barangay III',
  'Barangay IV',
  'Barangay V',
  'Barangay VI',
  'Barangay VII',
  'Barangay VIII',
  'Bibirao',
  'Borabod',
  'Calasgasan',
  'Camambugan',
  'Cobangbang',
  'Dogongan',
  'Gahonon',
  'Gubat',
  'Lag-on',
  'Magang',
  'Mambalite',
  'Mancruz',
  'Pamorangon',
  'San Isidro',
];

export const PROVINCES = [
  {
    name: 'Camarines Norte',
    cities: [
      { name: 'Daet', barangays: DAET_BARANGAYS },
      { name: 'Basud', barangays: [] },
      { name: 'Capalonga', barangays: [] },
      { name: 'Jose Panganiban', barangays: [] },
      { name: 'Labo', barangays: [] },
      { name: 'Mercedes', barangays: [] },
      { name: 'Paracale', barangays: [] },
      { name: 'San Lorenzo Ruiz', barangays: [] },
      { name: 'San Vicente', barangays: [] },
      { name: 'Santa Elena', barangays: [] },
      { name: 'Talisay', barangays: [] },
      { name: 'Vinzons', barangays: [] },
    ],
  },
];

export const provinceNames = () => [...PROVINCES.map((province) => province.name), OTHER];

export const cityNames = (provinceName) => {
  const province = PROVINCES.find((entry) => entry.name === provinceName);
  if (!province) return [];
  return [...province.cities.map((city) => city.name), OTHER];
};

export const barangayNames = (provinceName, cityName) => {
  const province = PROVINCES.find((entry) => entry.name === provinceName);
  const city = province?.cities.find((entry) => entry.name === cityName);
  if (!city || city.barangays.length === 0) return [];
  return [...city.barangays, OTHER];
};

/** Build the single address line that is stored on the order. */
export const formatAddress = ({ street, barangay, city, province, landmark }) => {
  const parts = [
    (street || '').trim(),
    (barangay || '').trim() ? `Brgy. ${(barangay || '').trim()}` : '',
    (city || '').trim(),
    (province || '').trim(),
  ].filter(Boolean);

  const line = parts.join(', ');
  const note = (landmark || '').trim();
  return note ? `${line} (${note})` : line;
};

/**
 * Read a stored address back into the form. Only the shapes this form writes
 * are recognised; anything else is left in the street box so it is never lost.
 */
export const parseAddress = (value) => {
  const empty = { street: '', barangay: '', city: '', province: '', landmark: '' };
  const text = (value || '').trim();
  if (!text) return empty;

  let rest = text;
  let landmark = '';
  const landmarkMatch = rest.match(/\(([^)]*)\)\s*$/);
  if (landmarkMatch) {
    landmark = landmarkMatch[1].trim();
    rest = rest.slice(0, landmarkMatch.index).trim();
  }

  const parts = rest.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 4) return { ...empty, street: text };

  const province = parts[parts.length - 1];
  const city = parts[parts.length - 2];
  const barangay = parts[parts.length - 3].replace(/^Brgy\.\s*/i, '');
  const street = parts.slice(0, parts.length - 3).join(', ');

  const known = PROVINCES.some((entry) => entry.name === province);
  if (!known) return { ...empty, street: text };

  return { street, barangay, city, province, landmark };
};
