'use client';

import { OTHER, barangayNames, cityNames, provinceNames } from '@/lib/philippineAddresses';

const selectClass =
  'w-full min-h-[48px] px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white';
const inputClass =
  'w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent';

/**
 * Province, city/municipality and barangay as dropdowns, plus the street line.
 *
 * Anything not on the lists is still deliverable: choosing "Other" swaps that
 * dropdown for a text box, and the lower levels follow.
 *
 * `value` is { province, city, barangay, street, landmark } and every change
 * is reported through `onChange` with the whole object.
 */
export default function AddressFields({ value, onChange, disabled = false }) {
  const { province = '', city = '', barangay = '', street = '', landmark = '' } = value || {};

  const provinces = provinceNames();
  const cities = cityNames(province);
  const barangays = barangayNames(province, city);

  // A value that is set but not on the list means it was typed by hand.
  const provinceIsCustom = Boolean(province) && !provinces.includes(province);
  const cityIsCustom = Boolean(city) && cities.length > 0 && !cities.includes(city);
  const barangayIsCustom = Boolean(barangay) && barangays.length > 0 && !barangays.includes(barangay);

  const update = (patch) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Province */}
        <div>
          <label htmlFor="addressProvince" className="block text-sm font-semibold text-gray-700 mb-2">
            Province *
          </label>
          {provinceIsCustom ? (
            <div className="flex gap-2">
              <input
                id="addressProvince"
                type="text"
                value={province}
                onChange={(event) => update({ province: event.target.value })}
                disabled={disabled}
                maxLength={60}
                className={inputClass}
                placeholder="Type your province"
              />
              <button
                type="button"
                onClick={() => update({ province: '', city: '', barangay: '' })}
                className="min-h-[48px] whitespace-nowrap rounded-xl border border-gray-300 px-3 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                List
              </button>
            </div>
          ) : (
            <select
              id="addressProvince"
              value={province}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value;
                update({
                  province: next === OTHER ? ' ' : next,
                  city: '',
                  barangay: '',
                });
              }}
              className={selectClass}
            >
              <option value="">Select province</option>
              {provinces.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* City or municipality */}
        <div>
          <label htmlFor="addressCity" className="block text-sm font-semibold text-gray-700 mb-2">
            City / Municipality *
          </label>
          {cities.length === 0 || cityIsCustom ? (
            <input
              id="addressCity"
              type="text"
              value={city}
              onChange={(event) => update({ city: event.target.value, barangay: '' })}
              disabled={disabled || !province}
              maxLength={60}
              className={inputClass}
              placeholder={province ? 'Type your city or municipality' : 'Choose a province first'}
            />
          ) : (
            <select
              id="addressCity"
              value={city}
              disabled={disabled || !province}
              onChange={(event) => {
                const next = event.target.value;
                update({ city: next === OTHER ? ' ' : next, barangay: '' });
              }}
              className={selectClass}
            >
              <option value="">Select city or municipality</option>
              {cities.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Barangay */}
      <div>
        <label htmlFor="addressBarangay" className="block text-sm font-semibold text-gray-700 mb-2">
          Barangay *
        </label>
        {barangays.length === 0 || barangayIsCustom ? (
          <input
            id="addressBarangay"
            type="text"
            value={barangay}
            onChange={(event) => update({ barangay: event.target.value })}
            disabled={disabled || !city}
            maxLength={80}
            className={inputClass}
            placeholder={city ? 'Type your barangay' : 'Choose a city first'}
          />
        ) : (
          <select
            id="addressBarangay"
            value={barangay}
            disabled={disabled || !city}
            onChange={(event) => {
              const next = event.target.value;
              update({ barangay: next === OTHER ? ' ' : next });
            }}
            className={selectClass}
          >
            <option value="">Select barangay</option>
            {barangays.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
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
