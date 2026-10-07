import { ArrowRight, ArrowUpRight, CalendarCheck, Check, Clock, MapPin, MessageSquareText, Phone, Stethoscope, Users } from "lucide-react";
import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import Image from "next/image";
import { Header } from "./header";
import { CLINIC, CLINICS, DOCTORS, PRACTICE, QR_ROWS, SERVICES } from "./data";

const figtree = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "Bright Smile Dental Clinic | Makati City",
  description:
    "Bright Smile Dental Clinic in Makati City. Open 9:00 AM to 5:00 PM. Cleaning, fillings, braces, root canal and more. Book a visit online.",
};

// One shape rule for the page: buttons and chips are pills, every container is rounded-3xl (big) or rounded-2xl (small).
const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-full bg-brand-700 px-6 py-3 font-semibold whitespace-nowrap text-white shadow-lg shadow-brand-900/20 transition hover:bg-brand-900 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700";
const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-full border border-brand-900/20 bg-white/70 px-6 py-3 font-semibold whitespace-nowrap text-brand-900 transition hover:border-brand-700 hover:bg-white active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700";

const TRUST = [
  { Icon: MapPin, title: "3 clinics in Makati", sub: "Find the one near you" },
  { Icon: Users, title: "Kids and adults", sub: "Care for the whole family" },
  { Icon: MessageSquareText, title: "Text reminders", sub: "We text you before your visit" },
  { Icon: Clock, title: `Open ${CLINIC.hours}`, sub: "Same hours at every clinic" },
];

const WHY = [
  "Book online in a minute, no calls needed",
  "A text message confirms your visit",
  "Same hours at all 3 clinics",
  "Gentle care for kids and adults",
];

const STEPS = [
  ["Scan or tap", "Use the QR code or the booking link."],
  ["Pick a time", `Choose a time between ${CLINIC.hours} and fill in your patient form.`],
  ["Get a text", "The clinic approves your visit and we send a reminder."],
];

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

export default function ClinicPage() {
  return (
    <div className={`${figtree.className} bg-white text-slate-700 antialiased`}>
      <Header />
      <main id="top">
        {/* Hero: headline and actions, trust strip underneath */}
        <section className="relative overflow-hidden bg-linear-to-b from-[#fdf5ef] via-[#fdf5ef] to-white pb-10 md:pb-14">
          <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-[28rem] rounded-full bg-[#f6e2d1]/60 blur-3xl" />
          <div className="relative mx-auto max-w-6xl px-5 pt-12 md:pt-20">
            <div className="rise max-w-3xl">
              <h1 className="text-5xl leading-[1.02] font-extrabold tracking-tight text-balance text-brand-900 md:text-7xl">
                A healthy, bright smile <span className="text-brand-600">starts here.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg text-slate-600 md:text-xl">
                Friendly, gentle dental care for the whole family, from a simple cleaning to braces and root canal.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#book" className={btnPrimary}>
                  Book a visit
                  <CalendarCheck className="size-5" aria-hidden />
                </a>
                <a href={CLINIC.phoneHref} className={btnGhost}>
                  <Phone className="size-5" aria-hidden />
                  {CLINIC.phone}
                </a>
              </div>
            </div>

            <ul className="rise relative z-10 mt-6 grid grid-cols-1 gap-x-6 gap-y-5 rounded-3xl border border-white/70 bg-white/80 p-6 shadow-xl shadow-brand-900/5 backdrop-blur-xl sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-brand-900/10" style={{ animationDelay: "240ms" }}>
              {TRUST.map(({ Icon, title, sub }) => (
                <li key={title} className="flex items-center gap-4 lg:px-5 lg:first:pl-0">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
                    <Icon className="size-6" aria-hidden />
                  </span>
                  <div>
                    <p className="font-bold text-brand-900">{title}</p>
                    <p className="text-sm text-slate-600">{sub}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Dentists */}
        <section id="doctors" className="scroll-mt-24 mx-auto max-w-6xl px-5 py-16 md:py-24">
          <div className="grid gap-10 lg:grid-cols-[5fr_6fr] lg:gap-16">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight text-balance text-brand-900 md:text-4xl">Caring hands for the whole family</h2>
              <p className="mt-4 max-w-md text-lg text-slate-600">Meet the dentists who look after your smile, from a first check-up to treatment.</p>
              <a href="#book" className={`${btnPrimary} mt-8`}>
                Book a visit
                <ArrowRight className="size-5" aria-hidden />
              </a>
            </div>
            <div>
              <ul className="grid gap-4">
                {DOCTORS.map((name) => (
                  <li key={name} className="flex items-center gap-5 rounded-3xl bg-brand-900 p-6 text-white md:p-7">
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/10">
                      <Stethoscope className="size-7 text-brand-200" aria-hidden />
                    </span>
                    <p className="text-lg leading-snug font-bold md:text-xl">{name}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap gap-2 text-sm">
                {PRACTICE.map((p) => (
                  <span key={p} className="rounded-full border border-brand-200 bg-white px-3 py-1 font-medium text-brand-700">{p}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Services + why choose us */}
        <section id="services" className="scroll-mt-24 bg-[#fdf5ef]">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:py-24 lg:grid-cols-[2fr_1fr] lg:gap-14">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight text-balance text-brand-900 md:text-4xl">Everything your smile needs</h2>
              <p className="mt-3 max-w-xl text-lg text-slate-600">Not sure what you need? Start with a dental consultation and we will guide you.</p>
              <ul className="mt-8 grid gap-x-10 sm:grid-cols-2">
                {SERVICES.map(([title, sub]) => (
                  <li key={title} className="flex items-start gap-3 border-b border-brand-900/10 py-4">
                    <Check className="mt-0.5 size-5 shrink-0 text-brand-600" strokeWidth={2.5} aria-hidden />
                    <div>
                      <p className="font-bold text-brand-900">{title}</p>
                      <p className="text-sm text-slate-600">{sub}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <aside className="h-fit rounded-3xl bg-white p-7 shadow-xl shadow-brand-900/5 lg:sticky lg:top-24">
              <h3 className="text-2xl font-extrabold tracking-tight text-brand-900">Why patients choose us</h3>
              <ul className="mt-5 grid gap-4">
                {WHY.map((w) => (
                  <li key={w} className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                      <Check className="size-4" strokeWidth={3} aria-hidden />
                    </span>
                    <span className="text-slate-700">{w}</span>
                  </li>
                ))}
              </ul>
              <a href="#book" className={`${btnPrimary} mt-7 w-full`}>
                Book a visit
                <ArrowRight className="size-5" aria-hidden />
              </a>
            </aside>
          </div>
        </section>

        {/* Locations */}
        <section id="locations" className="scroll-mt-24 mx-auto max-w-6xl px-5 py-16 md:py-24">
          <h2 className="text-3xl font-extrabold tracking-tight text-balance text-brand-900 md:text-4xl">Find a clinic near you</h2>
          <p className="mt-3 max-w-xl text-lg text-slate-600">Three clinics, all in Makati City. Tap one to open the exact spot in Google Maps.</p>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {CLINICS.map((c) => (
              <a key={c.name} href={`https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`} target="_blank" rel="noopener" className="group flex flex-col rounded-3xl border border-brand-100 bg-white p-6 transition hover:-translate-y-0.5 hover:border-brand-500 hover:shadow-xl hover:shadow-brand-900/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
                  <MapPin className="size-6" aria-hidden />
                </span>
                <h3 className="mt-4 text-xl font-bold text-brand-900">{c.name}</h3>
                <p className="mt-1 text-slate-600">{c.addr}</p>
                <p className="mt-3 text-sm font-semibold text-brand-700">Open {CLINIC.hours}</p>
                <span className="mt-auto inline-flex items-center gap-1 pt-5 font-semibold text-brand-700 group-hover:underline">
                  Open in Google Maps
                  <ArrowUpRight className="size-4" aria-hidden />
                </span>
              </a>
            ))}
          </div>
        </section>

        {/* Booking band */}
        <section id="book" className="scroll-mt-24 mx-auto max-w-6xl px-5 pb-16 md:pb-24">
          <div className="grid gap-10 rounded-3xl bg-brand-900 p-7 text-white md:p-12 lg:grid-cols-[3fr_2fr] lg:items-center">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight text-balance md:text-4xl">Ready for a brighter, healthier smile?</h2>
              <p className="mt-3 max-w-lg text-lg text-brand-100">Scan the code with your phone camera, pick a time, and the clinic will confirm it by text.</p>
              <ol className="mt-7 grid gap-4">
                {STEPS.map(([t, s], i) => (
                  <li key={t} className="flex items-start gap-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15 font-bold">{i + 1}</span>
                    <p><span className="font-bold">{t}.</span> <span className="text-brand-100">{s}</span></p>
                  </li>
                ))}
              </ol>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href={CLINIC.bookingUrl} target="_blank" rel="noopener" className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 font-semibold whitespace-nowrap text-brand-900 transition hover:bg-brand-100 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                  Open booking link
                  <ArrowUpRight className="size-5" aria-hidden />
                </a>
                <a href={CLINIC.phoneHref} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/40 px-6 py-3 font-semibold whitespace-nowrap text-white transition hover:bg-white/10 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                  <Phone className="size-5" aria-hidden />
                  {CLINIC.phone}
                </a>
              </div>
            </div>
            <div className="mx-auto w-64 rounded-3xl bg-white p-5 text-center text-brand-900">
              <div role="img" aria-label="QR code for Bright Smile patient booking and sign up"><Qr /></div>
              <p className="mt-3 font-bold">Scan to book or sign up</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-brand-900 text-slate-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-5 py-10 md:flex-row">
          <div className="flex items-center gap-3">
            <Image src="/clinic/emblem.png" alt="Bright Smile Dental Clinic logo" width={356} height={341} unoptimized className="h-12 w-auto object-contain" />
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
