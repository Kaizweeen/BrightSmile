import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";
import { logError } from "@/lib/log";
import { formatRate, noShowRate, pickWeek, REPORT_WEEKS, reportWeeks, sumCounts, weekLabel, type WeekCounts, type WeekStatsRow } from "@/lib/reports";
import { requireStaff, type Staff } from "@/lib/supabase/server";
import { formatDate, manilaInstant } from "@/lib/time";

export const metadata: Metadata = { title: "Reports" };

type Props = { searchParams: Promise<{ week?: string | string[] }> };
type Dentist = { id: string; name: string };

/** The offered weeks' counts through the staff member's RLS client, or null after logging when they cannot be read (teams spec 9). */
async function loadStats(staff: Staff, from: string): Promise<WeekStatsRow[] | null> {
  const { data, error } = await staff.db.rpc("clinic_week_stats", { p_clinic_id: staff.clinicId, p_from: from, p_weeks: REPORT_WEEKS });
  if (error) {
    logError("reports", error);
    return null;
  }
  return (data ?? []) as WeekStatsRow[];
}

/** The clinic's dentists, for the per-dentist sections, or null after logging when they cannot be read (teams spec 9). */
async function loadDentists(staff: Staff): Promise<Dentist[] | null> {
  const { data, error } = await staff.db.from("dentists").select("id, name").eq("clinic_id", staff.clinicId).order("created_at");
  if (error) {
    logError("reports", error);
    return null;
  }
  return (data ?? []) as Dentist[];
}

/** One week's numbers, each next to its label (teams spec 6.3). */
function Counts({ counts, monday }: { counts: WeekCounts; monday: string }) {
  const rows: [string, ReactNode][] = [
    ["Visits", counts.completed],
    ["No-shows", counts.no_show],
    ["No-show rate", formatRate(noShowRate(counts.completed, counts.no_show))],
    ["Cancellations", counts.cancelled],
    ["Declined requests", counts.declined],
    ["Expired requests", counts.expired],
    [
      "Not marked yet",
      counts.unmarked > 0 ? (
        <>
          {counts.unmarked}{" "}
          <Link href={`/app/schedule?date=${monday}`} className="link inline-flex min-h-11 items-center">
            Mark them on the schedule
          </Link>
        </>
      ) : (
        0
      ),
    ],
    ["Booked online", counts.online],
    ["Added by staff", counts.manual],
  ];
  if (counts.upcoming > 0) rows.push(["Confirmed, still ahead", counts.upcoming]);
  return (
    <div className="mt-2">
      {rows.map(([label, value]) => (
        <div key={label} className="cf-row">
          <span className="k">{label}</span>
          <span className="v">{value}</span>
        </div>
      ))}
    </div>
  );
}

/** The chosen week, per dentist when 2 or more had appointments, and the 8 weeks side by side. */
function Report({ stats, dentists, weeks, week }: { stats: WeekStatsRow[]; dentists: Dentist[]; weeks: string[]; week: string }) {
  const chosen = stats.filter((r) => r.week_start === week);
  const total = sumCounts(chosen);
  const byDentist = dentists
    .map((d) => ({ ...d, counts: sumCounts(chosen.filter((r) => r.dentist_id === d.id)) }))
    .filter((d) => d.counts.online + d.counts.manual > 0);
  const table = weeks.map((w) => ({ week: w, counts: sumCounts(stats.filter((r) => r.week_start === w)) }));
  const most = Math.max(1, ...table.map((t) => t.counts.completed));

  return (
    <>
      <section className="card card-pad settings-section">
        <h2 className="font-display">{weekLabel(week)}</h2>
        {total.online + total.manual === 0 ? <p className="f-hint">No appointments this week.</p> : <Counts counts={total} monday={week} />}
      </section>
      {byDentist.length >= 2 &&
        byDentist.map((d) => (
          <section key={d.id} className="card card-pad settings-section">
            <h2 className="font-display">{d.name}</h2>
            <Counts counts={d.counts} monday={week} />
          </section>
        ))}
      <section className="card card-pad settings-section">
        <h2 className="font-display">The last 8 weeks</h2>
        <table className="mt-2 w-full border-collapse text-left text-[13.5px]">
          <thead>
            <tr className="text-text-2">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Week of
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Visits
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                No-shows
              </th>
              <th scope="col" className="py-2 font-semibold">
                No-show rate
              </th>
            </tr>
          </thead>
          <tbody>
            {table.map((t) => (
              <tr key={t.week} className="border-t border-line">
                <th scope="row" className="py-2 pr-3 font-semibold">
                  {formatDate(manilaInstant(t.week, 0))}
                </th>
                <td className="py-2 pr-3 tabular-nums">
                  {t.counts.completed}
                  <span aria-hidden="true" className="mt-1 block h-1.5 rounded-full bg-primary" style={{ width: `${(t.counts.completed / most) * 100}%` }} />
                </td>
                <td className="py-2 pr-3 tabular-nums">{t.counts.no_show}</td>
                <td className="py-2 tabular-nums">{formatRate(noShowRate(t.counts.completed, t.counts.no_show))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

/** Teams spec 6.3: a Manila week's visits, no-shows, and more, for owners and staff alike. Counts only, no patient names. */
export default async function ReportsPage({ searchParams }: Props) {
  const staff = await requireStaff();
  const weeks = reportWeeks(new Date());
  const week = pickWeek((await searchParams).week, weeks);
  const [stats, dentists] = await Promise.all([loadStats(staff, weeks[weeks.length - 1]), loadDentists(staff)]);

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Reports</h1>
      </div>
      <Form action="/app/reports" className="card card-pad mb-3 flex flex-wrap items-end gap-2">
        <label className="w-full min-w-0 sm:w-auto sm:flex-1">
          <span className="f-label">Week</span>
          <select key={week} name="week" defaultValue={week} className="f-input">
            {weeks.map((w, i) => (
              <option key={w} value={w}>
                {`${i === 0 ? "This week, " : i === 1 ? "Last week, " : ""}${weekLabel(w)}`}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-soft">
          Show
        </button>
      </Form>
      {stats === null || dentists === null ? (
        <div className="card empty-note" role="alert">
          Reports are not available right now.
        </div>
      ) : (
        <Report stats={stats} dentists={dentists} weeks={weeks} week={week} />
      )}
    </>
  );
}
