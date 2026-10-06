import { CalendarCheck, ShieldCheck, Smile, Stethoscope } from "lucide-react";

const POINTS = [
  { icon: CalendarCheck, text: "One calendar for every chair at every branch" },
  { icon: Stethoscope, text: "Charts, exams and notes beside each visit" },
  { icon: ShieldCheck, text: "Every look at a record is logged" },
];

/** The page around the account forms. Staff pages ask for the brand panel (wide screens only); the public booking page does not. */
export function AuthCard({ title, description, brand = false, children }: { title: string; description?: string; brand?: boolean; children?: React.ReactNode }) {
  return (
    <div className={brand ? "grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]" : "min-h-dvh"}>
      {brand && (
      <aside className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <p className="flex items-center gap-3 font-heading text-xl font-semibold text-white">
          <span aria-hidden className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Smile className="size-6" />
          </span>
          DentaSync
        </p>
        <div className="grid gap-8">
          <p className="max-w-md font-heading text-4xl leading-tight font-semibold text-white">Appointments, chairs, and charts for every branch.</p>
          <ul className="grid gap-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sidebar-muted">
                <Icon aria-hidden className="size-5 shrink-0 text-highlight" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-sidebar-muted">Made for a dental practice with several branches.</p>
      </aside>
      )}
      <main id="main" className="mx-auto flex w-full max-w-md flex-col justify-center gap-6 px-4 py-10 sm:px-6">
        <p className={`flex items-center gap-2 font-heading text-lg font-semibold text-primary${brand ? " lg:hidden" : ""}`}>
          <span aria-hidden className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Smile className="size-5" />
          </span>
          DentaSync
        </p>
        <div className="grid gap-2">
          <h1 className="text-3xl leading-tight font-semibold">{title}</h1>
          {description && <p className="text-muted-foreground">{description}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}
