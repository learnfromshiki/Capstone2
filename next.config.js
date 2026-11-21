/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Product, shop and profile photos live in Supabase Storage.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/**',
      },
    ],
  },
};

module.exports = nextConfig;
