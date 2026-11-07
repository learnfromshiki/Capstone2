import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { SellerAuthProvider } from '@/contexts/SellerAuthContext';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'CONNECT-Daet.ph',
  description: 'Smart Tourism Ecosystem for Daet',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <SellerAuthProvider>
            {children}
          </SellerAuthProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
