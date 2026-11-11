import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { SellerAuthProvider } from '@/contexts/SellerAuthContext';
import { DialogProvider } from '@/components/ui/Dialog';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'CONNECT-Daet.ph',
  description: 'Smart Tourism Ecosystem for Daet, Camarines Norte: shop authentic local products from Daet artisans.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2563eb',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-PH">
      <body className={inter.className}>
        <DialogProvider>
          <AuthProvider>
            <SellerAuthProvider>
              {children}
            </SellerAuthProvider>
          </AuthProvider>
        </DialogProvider>
      </body>
    </html>
  );
}
