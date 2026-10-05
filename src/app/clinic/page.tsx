import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Image from "next/image";
import { Header } from "./header";
import { CLINIC, CLINICS, DOCTORS, PRACTICE, QR_ROWS, SERVICES } from "./data";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "Bright Smile Dental Clinic | Makati City",
  description:
    "Bright Smile Dental Clinic in Makati City. Open 9:00 AM to 5:00 PM. Cleaning, fillings, braces, root canal and more. Book a visit online.",
};

const clock = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
  </>
);

function Qr() {
  const n = QR_ROWS.length;
  const pad = 2;
  const size = n + pad * 2;
  let d = "";
  QR_ROWS.forEach((row, y) => {
    for (let x = 0; x < n; x++) if (row[x] === "#") d += `M${x + pad} ${y + pad}h1v1h-1z`;
  });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg" className="block h-auto w-full" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

const steps = [
  ["Scan or tap", "Use the QR code or the button above."],
  ["Pick a time", "Choose a time between 9:00 AM and 5:00 PM and fill in your patient form."],
  ["Get a text", "The clinic approves your visit and we send a reminder."],
];

export default function ClinicPage() {
  return (
    <div className={`${inter.className} bg-white text-slate-700 antialiased`}>
      <Header />
      <main id="top">
        {/* Hero */}
        <section className="relative overflow-hidden bg-linear-to-b from-brand-50 to-white">
          <div className="absolute -top-24 -right-24 size-96 rounded-full bg-brand-200/40 blur-3xl" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 md:grid-cols-2 md:py-24">
            <div>
              <span className="inline-block rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold tracking-wide text-brand-700 uppercase">Dental care in Makati City</span>
              <h1 className="mt-5 text-4xl leading-tight font-extrabold text-brand-900 md:text-5xl">A healthy, bright smile starts here.</h1>
              <p className="mt-5 max-w-xl text-lg text-slate-600">
                Friendly and gentle dental care for the whole family. From a simple cleaning to braces and root canal, we take care of your teeth in 3 clinics around Makati.
              </p>
              <div className="mt-6 inline-flex items-center gap-3 rounded-2xl border-2 border-brand-500 bg-white px-5 py-3 shadow-md">
                <svg className="size-7 text-brand-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">{clock}</svg>
                <div>
                  <p className="text-xs font-semibold tracking-wide text-brand-600 uppercase">Operating hours</p>
                  <p className="text-xl leading-tight font-extrabold text-brand-900">{CLINIC.hours}</p>
                </div>
              </div>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#book" className="rounded-full bg-brand-600 px-6 py-3 font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-700">Book a visit</a>
                <a href={CLINIC.phoneHref} className="rounded-full border border-slate-200 bg-white px-6 py-3 font-semibold text-brand-900 transition hover:border-brand-500">Call {CLINIC.phone}</a>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                {["3 clinic locations", "Kids and adults", "Text reminders"].map((t) => (
                  <li key={t} className="flex items-center gap-2"><span className="size-2 rounded-full bg-brand-500" />{t}</li>
                ))}
              </ul>
            </div>
            <div className="flex justify-center">
              <Image src="/clinic/logo.webp" alt="Bright Smile Dental Clinic" width={384} height={384} priority unoptimized className="size-72 rounded-full object-cover shadow-2xl shadow-brand-600/20 md:size-96" />
            </div>
          </div>
        </section>

        {/* Hours */}
        <section id="hours" className="mx-auto max-w-6xl px-5 pt-16">
          <div className="flex flex-col gap-6 rounded-3xl bg-brand-600 p-8 text-white md:flex-row md:items-center md:justify-between md:p-10">
            <div className="flex items-center gap-4">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-white/15">
                <svg className="size-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">{clock}</svg>
              </div>
              <div>
                <p className="text-sm font-semibold tracking-wide text-brand-100 uppercase">Operating hours</p>
                <p className="text-3xl font-extrabold md:text-4xl">{CLINIC.hours}</p>
              </div>
            </div>
            <p className="max-w-md text-brand-50">Same hours at all 3 clinics. Book online first so we can get your time ready.</p>
          </div>
        </section>

        {/* Doctors */}
        <section id="doctors" className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">Meet your dentists</p>
            <h2 className="mt-2 text-3xl font-extrabold text-brand-900 md:text-4xl">Caring hands for the whole family</h2>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {DOCTORS.map((name) => (
              <div key={name} className="flex items-center gap-5 rounded-3xl bg-brand-900 p-6 text-white md:p-8">
                <div className="flex size-16 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10">
                  <svg className="size-8 text-brand-200" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path strokeLinecap="round" d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
                </div>
                <div>
                  <p className="text-xs font-semibold tracking-wide text-brand-200 uppercase">Dentist</p>
                  <p className="text-xl leading-snug font-extrabold md:text-2xl">{name}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-brand-100 bg-brand-50 p-6">
            <p className="mb-3 text-sm font-semibold text-brand-700">Areas of practice</p>
            <div className="flex flex-wrap gap-2 text-sm">
              {PRACTICE.map((p) => (
                <span key={p} className="rounded-full border border-brand-200 bg-white px-3 py-1 text-brand-700">{p}</span>
              ))}
            </div>
          </div>
        </section>

        {/* Services */}
        <section id="services" className="border-y border-slate-100 bg-slate-50">
          <div className="mx-auto max-w-6xl px-5 py-16 md:py-20">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">Services offered</p>
              <h2 className="mt-2 text-3xl font-extrabold text-brand-900 md:text-4xl">Everything your smile needs</h2>
              <p className="mt-3 text-slate-600">Not sure what you need? Start with a dental consultation and we will guide you.</p>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SERVICES.map(([title, sub]) => (
                <div key={title} className="flex gap-3 rounded-2xl border border-slate-100 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-md">
                  <svg className="mt-0.5 size-5 shrink-0 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" className="opacity-20" fill="currentColor" stroke="none" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 12.5l3.2 3.2L17 9" />
                  </svg>
                  <div>
                    <p className="font-semibold text-brand-900">{title}</p>
                    <p className="text-sm text-slate-500">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Locations */}
        <section id="locations" className="mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">Locations</p>
            <h2 className="mt-2 text-3xl font-extrabold text-brand-900 md:text-4xl">Find a clinic near you</h2>
            <p className="mt-3 text-slate-600">Three clinics, all in Makati City. Tap a card to open the exact spot in Google Maps.</p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {CLINICS.map((c) => (
              <a key={c.name} href={`https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`} target="_blank" rel="noopener" className="group block rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-brand-500 hover:shadow-lg">
                <div className="flex size-11 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
                  <svg className="size-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
                </div>
                <h3 className="mt-4 text-lg font-bold text-brand-900">{c.name}</h3>
                <p className="mt-1 text-slate-600">{c.addr}</p>
                <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">
                  <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">{clock}</svg>
                  Open {CLINIC.hours}
                </p>
                <p className="mt-4 text-sm font-semibold text-brand-600 group-hover:underline">Open in Google Maps &rarr;</p>
              </a>
            ))}
          </div>
        </section>

        {/* Booking and QR */}
        <section id="book" className="border-t border-slate-100 bg-linear-to-b from-white to-brand-50">
          <div className="mx-auto max-w-4xl px-5 py-16 text-center md:py-20">
            <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">For patients</p>
            <h2 className="mt-2 text-3xl font-extrabold text-brand-900 md:text-4xl">Book a visit or fill in your patient form</h2>
            <p className="mx-auto mt-3 max-w-xl text-slate-600">Scan the code with your phone camera. Pick the time you want and the clinic will confirm it. You will get a text message.</p>
            <div className="mx-auto mt-10 w-72 rounded-3xl border border-slate-100 bg-white p-6 shadow-xl shadow-brand-600/10">
              <div role="img" aria-label="QR code for Bright Smile patient booking and sign up"><Qr /></div>
              <p className="mt-4 text-sm font-semibold text-brand-900">Scan to book or sign up</p>
            </div>
            <a href={CLINIC.bookingUrl} target="_blank" rel="noopener" className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand-600 px-7 py-3.5 font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:bg-brand-700">
              Open booking link
              <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M8 7h9v9" /></svg>
            </a>
            <p className="mt-3 text-xs break-all text-slate-500">{CLINIC.bookingUrl}</p>
            <ol className="mt-12 grid gap-4 text-left sm:grid-cols-3">
              {steps.map(([t, s], i) => (
                <li key={t} className="rounded-2xl border border-slate-100 bg-white p-5">
                  <span className="flex size-8 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700">{i + 1}</span>
                  <p className="mt-3 font-semibold text-brand-900">{t}</p>
                  <p className="mt-1 text-sm text-slate-600">{s}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Facebook */}
        <section className="mx-auto max-w-6xl px-5 py-14">
          <div className="flex flex-col gap-6 rounded-3xl bg-brand-900 p-8 text-white md:flex-row md:items-center md:justify-between md:p-10">
            <div className="flex items-center gap-4">
              <Image src="/clinic/facebook.webp" alt="Facebook logo" width={56} height={56} unoptimized className="size-14 shrink-0 rounded-full object-cover" />
              <div>
                <h2 className="text-2xl font-extrabold md:text-3xl">Follow us on Facebook</h2>
                <p className="mt-1 text-slate-200">See news, updates and send us a message.</p>
              </div>
            </div>
            <a href={CLINIC.facebook} target="_blank" rel="noopener" className="inline-flex items-center justify-center gap-3 rounded-full bg-white px-6 py-3 font-semibold text-brand-900 transition hover:bg-brand-100">
              <Image src="/clinic/facebook.webp" alt="" width={24} height={24} unoptimized className="size-6 shrink-0 rounded-full object-cover" />
              Visit our Facebook page
            </a>
          </div>
        </section>
      </main>

      <footer className="bg-brand-900 text-slate-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-5 py-10 md:flex-row">
          <div className="flex items-center gap-3">
            <Image src="/clinic/logo.webp" alt="Bright Smile Dental Clinic logo" width={48} height={48} unoptimized className="size-12 rounded-full object-cover" />
            <div>
              <p className="leading-tight font-bold text-white">{CLINIC.name}</p>
              <p className="text-sm">Makati City, Philippines | Open {CLINIC.hours}</p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <a href={CLINIC.phoneHref} className="text-lg font-semibold text-white hover:text-brand-200">{CLINIC.phone}</a>
            <a href={CLINIC.facebook} target="_blank" rel="noopener" className="flex items-center gap-2 text-sm hover:text-white">
              <Image src="/clinic/facebook.webp" alt="" width={24} height={24} unoptimized className="size-6 shrink-0 rounded-full object-cover" />
              <span className="underline">Facebook</span>
            </a>
          </div>
        </div>
        <div className="border-t border-white/10 py-4 text-center text-xs text-slate-400">
          &copy; {new Date().getFullYear()} {CLINIC.name}. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
