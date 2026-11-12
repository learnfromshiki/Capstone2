/**
 * The rules every form in CONNECT-Daet agrees on.
 *
 * Keeping them here means sign-up, checkout, a customer profile and a shop
 * profile all accept exactly the same thing, and a change made once applies
 * everywhere rather than drifting apart form by form.
 */

// Letters, spaces and the marks that belong in Filipino and Spanish names:
// "Dela Cruz", "O'Brien", "Ma. Teresa", "Nuñez-Santos".
const NAME_PATTERN = /^[A-Za-zÀ-ÿÑñ' .-]+$/;

/** Keep only the characters a name may contain, as the person types. */
export const sanitizeName = (value) => (value || '').replace(/[^A-Za-zÀ-ÿÑñ' .-]/g, '');

/**
 * @returns {string} what is wrong with this name, or '' when it is fine
 */
export const describeNameProblem = (value, label = 'name') => {
  const text = (value || '').trim();

  if (!text) return `Please enter your ${label}.`;
  if (text.length < 2) return `Please enter your full ${label}.`;
  if (text.length > 60) return `That ${label} is too long.`;
  if (!NAME_PATTERN.test(text)) return `A ${label} can only contain letters.`;

  return '';
};

export const isValidName = (value) => describeNameProblem(value) === '';

// ---------------------------------------------------------------------------
// Philippine mobile numbers
// ---------------------------------------------------------------------------
// Every mobile number here is 11 digits and starts 09 (09XX XXX XXXX).

export const PHONE_LENGTH = 11;
export const PHONE_HINT = '11 digits starting with 09, for example 09171234567';

/** Digits only, never longer than a mobile number, as the person types. */
export const sanitizePhone = (value) => (value || '').replace(/\D/g, '').slice(0, PHONE_LENGTH);

/** 0917 123 4567 - easier to check at a glance than 09171234567. */
export const formatPhone = (value) => {
  const digits = sanitizePhone(value);
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
};

/**
 * @returns {string} what is wrong with this number, or '' when it is fine
 */
export const describePhoneProblem = (value, { required = true } = {}) => {
  const digits = sanitizePhone(value);

  if (!digits) return required ? 'Please enter your mobile number.' : '';
  if (!digits.startsWith('09')) return 'A mobile number starts with 09, for example 09171234567.';
  if (digits.length !== PHONE_LENGTH) return `A mobile number is ${PHONE_LENGTH} digits. You entered ${digits.length}.`;

  return '';
};

export const isValidPhone = (value) => describePhoneProblem(value) === '';

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/** Digits and a single decimal point, at most two decimal places. */
export const sanitizePrice = (value) => {
  const text = (value || '').toString().replace(/[^\d.]/g, '');
  const [whole, ...rest] = text.split('.');

  if (rest.length === 0) return whole;
  return `${whole}.${rest.join('').slice(0, 2)}`;
};

/**
 * @returns {string} what is wrong with this price, or '' when it is fine
 */
export const describePriceProblem = (value) => {
  const text = (value ?? '').toString().trim();
  if (!text) return 'Please enter a price.';

  const amount = Number(text);
  if (!Number.isFinite(amount)) return 'Please enter a price as a number, for example 1.50.';
  if (amount <= 0) return 'A price has to be more than ₱0.';
  if (amount > 1000000) return 'That price is too high.';
  if (Math.round(amount * 100) !== amount * 100) return 'A price can have at most two decimal places.';

  return '';
};
