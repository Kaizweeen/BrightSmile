"use client";

import Image from "next/image";
import { useState } from "react";
import { CLINIC, NAV } from "./data";

/** The sticky top bar. It is a client component only for the phone menu button. */
export function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2 font-extrabold text-brand-900">
          <Image src="/clinic/emblem.png" alt="Bright Smile Dental Clinic logo" width={356} height={341} unoptimized className="h-10 w-auto object-contain" />
          <span className="flex flex-col leading-tight">
            <span>Bright Smile</span>
            <span className="text-[11px] font-semibold tracking-[0.18em] text-brand-500 uppercase">Dental Clinic</span>
          </span>
        </a>
        <nav className="hidden items-center gap-7 text-sm font-medium md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-brand-600">{n.label}</a>
          ))}
          <a href={CLINIC.facebook} target="_blank" rel="noopener" className="flex items-center gap-2 hover:text-brand-600">
            <Image src="/clinic/facebook.webp" alt="" width={24} height={24} unoptimized className="size-6 shrink-0 rounded-full object-cover" />
            Facebook
          </a>
          <a href="#book" className="rounded-full bg-brand-600 px-4 py-2 text-white transition hover:bg-brand-700">Book a visit</a>
        </nav>
        <button
          type="button"
          className="rounded-lg p-2 hover:bg-slate-100 md:hidden"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <svg className="size-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </div>
      {open && (
        <div className="border-t border-slate-100 bg-white md:hidden">
          <div className="flex flex-col gap-3 px-5 py-3 text-sm font-medium">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setOpen(false)}>{n.label}</a>
            ))}
            <a href={CLINIC.facebook} target="_blank" rel="noopener" className="flex items-center gap-2">
              <Image src="/clinic/facebook.webp" alt="" width={24} height={24} unoptimized className="size-6 shrink-0 rounded-full object-cover" />
              Facebook
            </a>
            <a href="#book" onClick={() => setOpen(false)} className="rounded-full bg-brand-600 px-4 py-2 text-center text-white">Book a visit</a>
          </div>
        </div>
      )}
    </header>
  );
}
