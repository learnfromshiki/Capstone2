import Link from 'next/link';
import Reveal from '@/components/landing/Reveal';
import LandingNav from '@/components/landing/LandingNav';

const FEATURES = [
  {
    title: '100% Authentic',
    text: 'Every seller is a verified local artisan or business from Daet and Camarines Norte.',
    color: 'from-blue-500 to-blue-700',
    glow: 'group-hover:shadow-blue-500/30',
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  },
  {
    title: 'Secure Payment',
    text: 'Pay online through PayMongo, by GCash or bank transfer, or cash on delivery.',
    color: 'from-emerald-500 to-teal-600',
    glow: 'group-hover:shadow-emerald-500/30',
    icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  },
  {
    title: 'Earn Rewards',
    text: 'Collect 10 points for every ₱100 you spend and use them on later orders.',
    color: 'from-amber-400 to-orange-500',
    glow: 'group-hover:shadow-amber-500/30',
    icon: 'M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7',
  },
  {
    title: 'Support Local',
    text: 'Your purchase goes straight to Daet artisans, their families and their craft.',
    color: 'from-rose-500 to-pink-600',
    glow: 'group-hover:shadow-rose-500/30',
    icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z',
  },
];

const CATEGORIES = [
  { value: 'handicrafts', label: 'Handicrafts', icon: '🧺', text: 'Baskets, fans and woven home pieces', tint: 'from-amber-100 to-orange-50' },
  { value: 'food', label: 'Food', icon: '🍽️', text: 'Pili nuts, sweets and Bicol delicacies', tint: 'from-rose-100 to-pink-50' },
  { value: 'souvenirs', label: 'Souvenirs', icon: '🎁', text: 'Keepsakes to remember Daet by', tint: 'from-sky-100 to-blue-50' },
  { value: 'weavings', label: 'Weavings', icon: '🧵', text: 'Handwoven textiles and abaca crafts', tint: 'from-emerald-100 to-teal-50' },
  { value: 'art', label: 'Art', icon: '🎨', text: 'Paintings and works by local artists', tint: 'from-slate-100 to-blue-50' },
];

const STEPS = [
  { title: 'Browse', text: 'Explore products by category, search by name, and read reviews from other buyers.', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
  { title: 'Order', text: 'Add to cart or buy now, choose delivery or pickup, and pay the way you prefer.', icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z' },
  { title: 'Enjoy', text: 'Track your order, chat with the seller, and collect reward points when it arrives.', icon: 'M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
];

const MARQUEE = ['Handwoven textiles', 'Pili delicacies', 'Abaca crafts', 'Local art', 'Bicol souvenirs', 'Native baskets', 'Seaweed fans', 'Home-made sweets'];

function Icon({ d, className = 'h-6 w-6' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-white">
      {/* Nav + hero share one backdrop so the transparent nav sits on it. */}
      <div className="relative isolate overflow-hidden bg-gradient-to-b from-blue-50/80 via-white to-white">
        {/* Animated background */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
          <div className="absolute -left-32 top-10 h-96 w-96 rounded-full bg-blue-300/40 blur-3xl animate-blob" />
          <div className="absolute right-0 top-0 h-[28rem] w-[28rem] rounded-full bg-blue-200/40 blur-3xl animate-blob [animation-delay:-5s]" />
          <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-sky-200/50 blur-3xl animate-blob [animation-delay:-9s]" />
        </div>

        <LandingNav />

        {/* Hero */}
        <section className="mx-auto max-w-7xl px-4 pb-20 pt-12 sm:px-6 lg:px-8 lg:pb-28 lg:pt-20">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/70 px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm backdrop-blur animate-fade-up">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-600" />
                </span>
                Authentic products from Daet, Camarines Norte
              </div>

              <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-gray-900 sm:text-6xl lg:text-[3.5rem] xl:text-7xl">
                <span className="block animate-fade-up [animation-delay:120ms]">Discover authentic</span>
                <span className="block pb-2 text-gradient-animated animate-fade-up [animation-delay:240ms]">
                  Daet craftsmanship
                </span>
              </h1>

              <p className="mt-6 max-w-xl text-lg leading-relaxed text-gray-600 sm:text-xl animate-fade-up [animation-delay:360ms]">
                Support local artisans and bring home genuine Bicol culture. From handwoven
                textiles to traditional delicacies, every purchase tells a story.
              </p>

              <div className="mt-10 flex flex-col gap-4 sm:flex-row animate-fade-up [animation-delay:480ms]">
                <Link
                  href="/shop"
                  className="group relative inline-flex items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-4 text-lg font-bold text-white shadow-xl shadow-blue-600/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-600/40"
                >
                  <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                  Explore Products
                  <Icon d="M13 7l5 5m0 0l-5 5m5-5H6" className="ml-2 h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
                <a
                  href="#features"
                  className="inline-flex items-center justify-center rounded-2xl border-2 border-gray-200 bg-white/80 px-8 py-4 text-lg font-bold text-gray-700 backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-blue-300 hover:text-blue-700 hover:shadow-lg"
                >
                  Learn More
                </a>
              </div>

              <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-gray-600 animate-fade-up [animation-delay:600ms]">
                {['100% Authentic', 'Secure Checkout', 'Earn Rewards'].map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                      <Icon d="M5 13l4 4L19 7" className="h-3.5 w-3.5" />
                    </span>
                    <span className="font-medium">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Hero illustration: a floating stack of cards */}
            <div className="relative mx-auto h-[520px] w-full max-w-md animate-fade-up [animation-delay:300ms] sm:h-[480px]">
              <div aria-hidden="true" className="absolute inset-8 rounded-[2.5rem] bg-gradient-to-br from-blue-500 via-blue-600 to-sky-400 opacity-90 shadow-2xl shadow-blue-600/30 animate-float-slow" />

              {/* Main card */}
              <div className="absolute inset-x-6 top-12 rounded-3xl border border-white/60 bg-white/90 p-6 shadow-2xl backdrop-blur-xl animate-float sm:inset-x-10">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-500">Featured today</p>
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-600">Local</span>
                </div>
                <div className="mt-4 space-y-3">
                  {[
                    { icon: '🧺', name: 'Handcrafted Items', sub: 'By local artisans', bg: 'bg-amber-50' },
                    { icon: '🥜', name: 'Pili Delicacies', sub: 'Bicol favourites', bg: 'bg-rose-50' },
                    { icon: '🧵', name: 'Handwoven Textiles', sub: 'Abaca and more', bg: 'bg-emerald-50' },
                  ].map((row, i) => (
                    <div
                      key={row.name}
                      className="flex items-center gap-4 rounded-2xl bg-gray-50/80 p-3 transition-all duration-300 hover:translate-x-1 hover:bg-blue-50 animate-fade-up"
                      style={{ animationDelay: `${600 + i * 150}ms` }}
                    >
                      <span className={`flex h-12 w-12 items-center justify-center rounded-xl text-2xl ${row.bg}`}>{row.icon}</span>
                      <div className="flex-1">
                        <p className="font-bold text-gray-900">{row.name}</p>
                        <p className="text-sm text-gray-500">{row.sub}</p>
                      </div>
                      <Icon d="M9 5l7 7-7 7" className="h-4 w-4 text-gray-400" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Floating badges */}
              <div className="absolute -left-1 bottom-16 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-xl animate-float [animation-delay:-2s] sm:-left-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                  <Icon d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-bold text-gray-900">+10 points</p>
                  <p className="text-xs text-gray-500">per ₱100 spent</p>
                </div>
              </div>

              <div className="absolute -right-1 bottom-0 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-xl animate-float [animation-delay:-4s] sm:-right-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white">
                  <Icon d="M5 13l4 4L19 7" className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-bold text-gray-900">Order confirmed</p>
                  <p className="text-xs text-gray-500">Delivered within Daet</p>
                </div>
              </div>

              <div className="absolute -top-2 right-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-2xl shadow-xl animate-float [animation-delay:-1s]">
                🎨
              </div>
            </div>
          </div>
        </section>

        {/* Marquee */}
        <div className="relative border-y border-blue-100 bg-white/60 py-5 backdrop-blur">
          <div className="flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
            <div className="flex shrink-0 animate-marquee items-center gap-10 pr-10 hover:[animation-play-state:paused]">
              {[...MARQUEE, ...MARQUEE].map((item, i) => (
                <span key={i} aria-hidden={i >= MARQUEE.length} className="flex items-center gap-10 whitespace-nowrap text-lg font-semibold text-gray-400">
                  {item}
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-300" />
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Features */}
      <section id="features" className="scroll-mt-20 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold uppercase tracking-widest text-blue-600">Why shop with us</p>
            <h2 className="mt-3 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
              Shopping that gives back
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Every purchase supports local communities and keeps traditional craftsmanship alive.
            </p>
          </Reveal>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature, i) => (
              <Reveal key={feature.title} delay={i * 110}>
                <div className={`group relative h-full overflow-hidden rounded-3xl border border-gray-100 bg-white p-7 shadow-sm transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl ${feature.glow}`}>
                  <div className={`absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${feature.color} opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-20`} />
                  <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${feature.color} text-white shadow-lg transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110`}>
                    <Icon d={feature.icon} className="h-7 w-7" />
                  </div>
                  <h3 className="mt-6 text-lg font-bold text-gray-900">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">{feature.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Categories */}
      <section id="categories" className="scroll-mt-20 bg-gray-50 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-bold uppercase tracking-widest text-blue-600">Categories</p>
              <h2 className="mt-3 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">Find something local</h2>
            </div>
            <Link href="/shop" className="group inline-flex items-center gap-2 font-semibold text-blue-600 hover:text-blue-700">
              View all products
              <Icon d="M13 7l5 5m0 0l-5 5m5-5H6" className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </Reveal>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {CATEGORIES.map((category, i) => (
              <Reveal key={category.value} variant="zoom" delay={i * 90}>
                <Link
                  href={`/shop?category=${category.value}`}
                  className={`group flex h-full flex-col rounded-3xl bg-gradient-to-br ${category.tint} p-6 ring-1 ring-black/5 transition-all duration-500 hover:-translate-y-2 hover:shadow-xl hover:ring-blue-200`}
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-4xl shadow-sm transition-transform duration-500 group-hover:-rotate-12 group-hover:scale-110">
                    {category.icon}
                  </span>
                  <h3 className="mt-6 text-lg font-bold text-gray-900">{category.label}</h3>
                  <p className="mt-1 flex-1 text-sm text-gray-600">{category.text}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-600 opacity-0 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-100">
                    Shop now <Icon d="M9 5l7 7-7 7" className="h-4 w-4" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold uppercase tracking-widest text-blue-600">How it works</p>
            <h2 className="mt-3 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">Three simple steps</h2>
          </Reveal>

          <div className="relative mt-16 grid gap-10 md:grid-cols-3">
            <div aria-hidden="true" className="absolute left-[16%] right-[16%] top-10 hidden h-0.5 bg-gradient-to-r from-blue-200 via-blue-300 to-blue-200 md:block" />
            {STEPS.map((step, i) => (
              <Reveal key={step.title} delay={i * 180} className="relative text-center">
                <div className="group mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-xl ring-8 ring-blue-50 transition-transform duration-500 hover:scale-110">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-blue-700 text-white">
                    <Icon d={step.icon} className="h-7 w-7" />
                  </span>
                </div>
                <p className="mt-6 text-xs font-bold uppercase tracking-widest text-blue-600">Step {i + 1}</p>
                <h3 className="mt-2 text-xl font-bold text-gray-900">{step.title}</h3>
                <p className="mx-auto mt-2 max-w-xs text-gray-600">{step.text}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-24 sm:px-6 lg:px-8">
        <Reveal variant="zoom" className="mx-auto max-w-6xl">
          <div className="relative isolate overflow-hidden rounded-[2.5rem] bg-gradient-to-r from-blue-600 via-blue-700 to-blue-700 bg-[length:200%_200%] px-6 py-20 text-center shadow-2xl shadow-blue-600/30 animate-gradient-x sm:px-16">
            <div aria-hidden="true" className="absolute -left-16 -top-16 -z-10 h-64 w-64 rounded-full bg-white/10 blur-2xl animate-blob" />
            <div aria-hidden="true" className="absolute -bottom-20 -right-10 -z-10 h-72 w-72 rounded-full bg-sky-300/20 blur-2xl animate-blob [animation-delay:-6s]" />
            <h2 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Ready to start shopping?</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-blue-100">
              Explore our collection of authentic Daet products and support local artisans today.
            </p>
            <Link
              href="/shop"
              className="group mt-10 inline-flex items-center justify-center rounded-2xl bg-white px-10 py-4 text-lg font-bold text-blue-700 shadow-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
            >
              Browse All Products
              <Icon d="M14 5l7 7m0 0l-7 7m7-7H3" className="ml-2 h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="bg-gray-950 py-14 text-gray-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 md:grid-cols-3">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700">
                  <Icon d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" className="h-5 w-5 text-white" />
                </span>
                <h3 className="text-lg font-bold text-white">CONNECT-Daet</h3>
              </div>
              <p className="mt-4 text-sm leading-relaxed">
                Supporting local artisans and preserving Bicol cultural heritage through authentic products.
              </p>
            </div>
            <div>
              <h3 className="mb-4 text-lg font-bold text-white">Quick Links</h3>
              <div className="space-y-1">
                <Link href="/shop" className="flex min-h-[44px] items-center transition-colors hover:text-white">Shop</Link>
                <Link href="/terms" className="flex min-h-[44px] items-center transition-colors hover:text-white">Terms</Link>
              </div>
            </div>
            <div>
              <h3 className="mb-4 text-lg font-bold text-white">About</h3>
              <p className="text-sm">Built for the CONNECT-Daet.ph Tourism Ecosystem.</p>
            </div>
          </div>
          <div className="mt-10 border-t border-gray-800 pt-8 text-center text-sm">
            <p>&copy; 2026 CONNECT-Daet.ph. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
