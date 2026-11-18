/**
 * Logging out goes straight to the shop.
 *
 * Signing out clears the account the page is showing before the browser has
 * left it, so for a moment every dashboard rendered its own signed-out screen
 * (the admin panel's login form, the seller portal, "please sign in") on the
 * way to the shop. A full-window "Signing out..." cover goes up first and
 * stays until the shop loads, so nothing in between is ever seen.
 */

const COVER_ID = 'connect-daet-signing-out';

export const showSigningOut = () => {
  if (typeof document === 'undefined' || document.getElementById(COVER_ID)) return;

  const cover = document.createElement('div');
  cover.id = COVER_ID;
  cover.setAttribute('role', 'status');
  cover.setAttribute('aria-live', 'polite');
  // Inline styles: this must look right whatever page it covers.
  Object.assign(cover.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    background: 'rgb(249, 250, 251)',
    color: 'rgb(75, 85, 99)',
    fontFamily: 'inherit',
    fontSize: '15px',
    fontWeight: '500',
  });

  const spinner = document.createElement('div');
  Object.assign(spinner.style, {
    width: '40px',
    height: '40px',
    borderRadius: '9999px',
    border: '3px solid rgb(219, 228, 243)',
    borderTopColor: 'rgb(61, 97, 166)',
  });
  spinner.animate?.([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
    duration: 800,
    iterations: Infinity,
  });

  const label = document.createElement('p');
  label.textContent = 'Signing out...';

  cover.append(spinner, label);
  document.body.appendChild(cover);
};

/**
 * Open the shop in place of the current page. `replace` keeps the dashboard
 * out of the back history, so Back does not return to a login screen.
 */
export const goToShop = () => {
  if (typeof window !== 'undefined') window.location.replace('/shop');
};
