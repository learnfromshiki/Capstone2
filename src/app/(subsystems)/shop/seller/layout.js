// Private area: give it its own tab title and keep it out of search results.
export const metadata = {
  title: 'Seller Center | CONNECT-Daet.ph',
  robots: { index: false, follow: false },
};

export default function Layout({ children }) {
  return children;
}
