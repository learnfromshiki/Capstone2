'use client';

import { useEffect } from 'react';
import { DEFAULT_CITY, DEFAULT_PROVINCE, barangayNames } from '@/lib/philippineAddresses';

const selectClass =
  'w-full min-h-[48px] px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white';
const inputClass =
  'w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent';

/**
 * The delivery address.
 *
 * CONNECT-Daet delivers inside Daet only, so the province and the municipality
 * are shown but not asked for: the barangay dropdown, the street line and an
 * optional landmark are all the customer fills in.
 *
 * `value` is { province, city, barangay, street, landmark } and every change
 * is reported through `onChange` with the whole object.
 */
export default function AddressFields({ value, onChange, disabled = false }) {
  const { province = '', city = '', barangay = '', street = '', landmark = '' } = value || {};

  const barangays = barangayNames(DEFAULT_PROVINCE, DEFAULT_CITY);

  // Province and municipality are set for the customer rather than asked for,
  // including on an address saved before this form was narrowed to Daet.
  useEffect(() => {
    if (province !== DEFAULT_PROVINCE || city !== DEFAULT_CITY) {
      onChange({ ...value, province: DEFAULT_PROVINCE, city: DEFAULT_CITY });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [province, city]);

  const update = (patch) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Province: fixed, this marketplace serves one province */}
        <div>
          <label htmlFor="addressProvince" className="block text-sm font-semibold text-gray-700 mb-2">
            Province
          </label>
          <input
            id="addressProvince"
            type="text"
            value={DEFAULT_PROVINCE}
            readOnly
            disabled
            className="w-full min-h-[48px] cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 font-medium text-gray-700"
          />
          <p className="mt-1 text-xs text-gray-500">CONNECT-Daet delivers within Camarines Norte.</p>
        </div>

        {/* City or municipality: fixed, deliveries are inside Daet */}
        <div>
          <label htmlFor="addressCity" className="block text-sm font-semibold text-gray-700 mb-2">
            City / Municipality
          </label>
          <input
            id="addressCity"
            type="text"
            value={DEFAULT_CITY}
            readOnly
            disabled
            className="w-full min-h-[48px] cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 font-medium text-gray-700"
          />
          <p className="mt-1 text-xs text-gray-500">We deliver within Daet only.</p>
        </div>
      </div>

      {/* Barangay */}
      <div>
        <label htmlFor="addressBarangay" className="block text-sm font-semibold text-gray-700 mb-2">
          Barangay *
        </label>
        <select
          id="addressBarangay"
          value={barangay}
          disabled={disabled}
          onChange={(event) => update({ barangay: event.target.value })}
          className={selectClass}
        >
          <option value="">Select your barangay</option>
          {barangays.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {/* Street */}
      <div>
        <label htmlFor="addressStreet" className="block text-sm font-semibold text-gray-700 mb-2">
          House No. / Street / Purok *
        </label>
        <input
          id="addressStreet"
          type="text"
          value={street}
          onChange={(event) => update({ street: event.target.value })}
          disabled={disabled}
          autoComplete="street-address"
          maxLength={200}
          className={inputClass}
          placeholder="e.g. 123 Rizal St., Purok 4"
        />
      </div>

      {/* Landmark */}
      <div>
        <label htmlFor="addressLandmark" className="block text-sm font-semibold text-gray-700 mb-2">
          Landmark (optional)
        </label>
        <input
          id="addressLandmark"
          type="text"
          value={landmark}
          onChange={(event) => update({ landmark: event.target.value })}
          disabled={disabled}
          maxLength={120}
          className={inputClass}
          placeholder="e.g. beside the barangay hall"
        />
      </div>
    </div>
  );
}
