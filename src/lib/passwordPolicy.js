/**
 * One password policy for the whole site: sign up, seller registration,
 * password reset and the change-password forms all import this so the rules
 * can never drift apart.
 *
 * Rules: at least 8 characters, at least one CAPITAL letter and at least one
 * special character.
 */
export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_RULES = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (value) => (value || '').length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'uppercase',
    label: 'At least 1 capital letter (A-Z)',
    test: (value) => /[A-Z]/.test(value || ''),
  },
  {
    id: 'special',
    label: 'At least 1 special character (!@#$%^&*...)',
    test: (value) => /[^A-Za-z0-9]/.test(value || ''),
  },
];

/** @returns {{id: string, label: string, met: boolean}[]} */
export const checkPassword = (value) =>
  PASSWORD_RULES.map((rule) => ({ id: rule.id, label: rule.label, met: rule.test(value) }));

export const isPasswordValid = (value) => PASSWORD_RULES.every((rule) => rule.test(value));

/**
 * The first unmet rule, phrased for an error message. Returns '' when the
 * password is acceptable.
 */
export const describePasswordProblem = (value) => {
  const failed = PASSWORD_RULES.filter((rule) => !rule.test(value));
  if (failed.length === 0) return '';

  return `Your password needs: ${failed.map((rule) => rule.label.replace(/^At least /, '').toLowerCase()).join(', ')}.`;
};
