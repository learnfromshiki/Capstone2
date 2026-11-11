// Server layout for every /shop page: gives the client pages proper titles and
// link previews (the pages themselves are client components and cannot export
// metadata).
export const metadata = {
  title: 'Daet Local Shop | CONNECT-Daet.ph',
  description:
    'Buy authentic Daet handicrafts, food, souvenirs, weavings and art directly from local artisans. Pay by GCash, bank transfer or cash on delivery.',
  openGraph: {
    title: 'Daet Local Shop | CONNECT-Daet.ph',
    description: 'Authentic products from the artisans of Daet, Camarines Norte.',
    type: 'website',
    locale: 'en_PH',
    siteName: 'CONNECT-Daet.ph',
  },
};

export default function ShopLayout({ children }) {
  return children;
}
