/**
 * Address choices for the delivery form.
 *
 * CONNECT-Daet delivers inside Daet, Camarines Norte, and nowhere else, so
 * neither the province nor the municipality is a choice: both are fixed and
 * shown read-only, and the only thing a customer picks is their barangay.
 * That also means every delivery fee and every "can you deliver here?" has a
 * single answer.
 *
 * To serve another municipality later, add it to PROVINCES with its barangays
 * and turn the city field back into a dropdown in AddressFields.
 */
export const DEFAULT_PROVINCE = 'Camarines Norte';
export const DEFAULT_CITY = 'Daet';
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
    name: DEFAULT_PROVINCE,
    cities: [{ name: DEFAULT_CITY, barangays: DAET_BARANGAYS }],
  },
];

/** The only province served. Kept as a list so the form code stays the same. */
export const provinceNames = () => PROVINCES.map((province) => province.name);

export const cityNames = (provinceName) => {
  const province = PROVINCES.find((entry) => entry.name === provinceName);
  if (!province) return [];
  return province.cities.map((city) => city.name);
};

export const barangayNames = (provinceName, cityName) => {
  const province = PROVINCES.find((entry) => entry.name === provinceName);
  const city = province?.cities.find((entry) => entry.name === cityName);
  if (!city || city.barangays.length === 0) return [];
  // Daet's barangays are listed in full, so there is nothing to type in.
  return [...city.barangays];
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
