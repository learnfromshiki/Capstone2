import Link from 'next/link';

export const metadata = {
  title: 'Page not found | CONNECT-Daet.ph',
};

export default function NotFound() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
        <p className="text-5xl font-bold text-blue-600">404</p>
        <h1 className="mt-4 text-xl font-bold text-gray-900">Page not found</h1>
        <p className="mt-2 text-sm text-gray-600">
          The page you are looking for does not exist or has been moved.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/shop"
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-blue-600 px-6 font-semibold text-white hover:bg-blue-700"
          >
            Browse the shop
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-gray-100 px-6 font-semibold text-gray-700 hover:bg-gray-200"
          >
            Go to home
          </Link>
        </div>
      </div>
    </main>
  );
}
