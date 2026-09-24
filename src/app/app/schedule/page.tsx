import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import AppointmentActions from "../AppointmentActions";
import { loadDay } from "@/lib/dashboard";
import { localMobile } from "@/lib/phone";
import { parseDay, STATUS_LABEL } from "@/lib/schedule";
import { requireStaff } from "@/lib/supabase/server";
import { addDays, formatDate, formatTime, manilaDate, manilaInstant } from "@/lib/time";
import { isUuid } from "@/lib/validate";

export const metadata: Metadata = { title: "Schedule" };

type Props = { searchParams: Promise<{ date?: string | string[]; dentist?: string | string[] }> };

/** Spec 5.3: day view with a dentist filter (2 or more active dentists), previous and next day, and a date jump. */
export default async function SchedulePage({ searchParams }: Props) {
  const staff = await requireStaff();
  const now = new Date();
  const query = await searchParams;
  const today = manilaDate(now);
  const date = parseDay(query.date, today);
  const dentistId = isUuid(query.dentist) ? query.dentist : null;
  const { dentists, items } = await loadDay(staff, date, dentistId, now);
  const active = dentists.filter((d) => d.active);
  const nameOf = new Map(dentists.map((d) => [d.id, d.name]));
  const href = (day: string, dentist: string | null = dentistId) =>
    `/app/schedule?date=${day}${dentist ? `&dentist=${dentist}` : ""}`;

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Schedule</h1>
        <Link href="/app/new" className="btn btn-primary">
          New appointment
        </Link>
      </div>

      <div className="card card-pad mb-3">
        <div className="flex items-center gap-2">
          <Link href={href(addDays(date, -1))} className="btn btn-ghost" aria-label="Previous day">
            Prev
          </Link>
          <p className="flex-1 text-center font-display text-[16px] font-bold" aria-live="polite">
            {formatDate(manilaInstant(date, 0))}
            {date === today && " (today)"}
          </p>
          <Link href={href(addDays(date, 1))} className="btn btn-ghost" aria-label="Next day">
            Next
          </Link>
        </div>
        <Form action="/app/schedule" className="mt-3 flex gap-2">
          <input key={date} type="date" name="date" defaultValue={date} className="f-input" aria-label="Jump to a date" />
          {dentistId && <input type="hidden" name="dentist" value={dentistId} />}
          <button type="submit" className="btn btn-soft">
            Go
          </button>
        </Form>
        {active.length > 1 && (
          <div className="chip-row mt-3" role="group" aria-label="Dentist">
            <Link href={href(date, null)} className={`btn ${dentistId ? "btn-ghost" : "btn-primary"}`} aria-current={dentistId ? undefined : "true"}>
              All dentists
            </Link>
            {active.map((d) => (
              <Link
                key={d.id}
                href={href(date, d.id)}
                className={`btn ${dentistId === d.id ? "btn-primary" : "btn-ghost"}`}
                aria-current={dentistId === d.id ? "true" : undefined}
              >
                {d.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 && <div className="card empty-note">Nothing booked on this day.</div>}

      {items.map((item) => {
        const label = STATUS_LABEL[item.status];
        return (
          <article key={item.id} className="card appt">
            <p className="when">
              {formatTime(new Date(item.startsAt))} to {formatTime(new Date(item.endsAt))}
            </p>
            <p className="who">
              <Link href={`/app/patients/${item.patientId}`} className="hover:underline">
                {item.patientName}
              </Link>
            </p>
            <p className="what">
              {item.procedures.join(", ")}
              {active.length > 1 && ` with ${nameOf.get(item.dentistId) ?? "a former dentist"}`}
            </p>
            <div className="chip-row">
              <span className={`chip ${label.chip}`}>{label.word}</span>
              {item.outsideHours && <span className="chip chip-gold">Outside hours</span>}
              {item.textFailed && <span className="chip chip-red">Text not delivered</span>}
            </div>
            {item.textFailed && item.mobile && (
              <a href={`tel:${item.mobile}`} className="link inline-flex min-h-11 items-center">
                Call {localMobile(item.mobile)}
              </a>
            )}
            <AppointmentActions id={item.id} actions={item.actions} />
          </article>
        );
      })}
    </>
  );
}
