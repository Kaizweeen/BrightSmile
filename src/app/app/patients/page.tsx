import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { searchPatients } from "@/lib/patients";
import { localMobile } from "@/lib/phone";
import { requireStaff } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Patients" };

type Props = { searchParams: Promise<{ q?: string | string[] }> };

/** Spec 5.3: search by name or mobile. */
export default async function PatientsPage({ searchParams }: Props) {
  const staff = await requireStaff();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.slice(0, 60) : "";
  const hits = query ? await searchPatients(staff, query) : [];

  return (
    <>
      <div className="page-head">
        <h1 className="font-display">Patients</h1>
        <Link href="/app/new" className="btn btn-primary">
          New appointment
        </Link>
      </div>

      <Form action="/app/patients" className="card card-pad mb-3 flex gap-2" role="search">
        <input
          key={query}
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Name or mobile"
          aria-label="Search patients by name or mobile"
          className="f-input"
        />
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </Form>

      {!query && <p className="f-hint">Search by first or last name, or by mobile number.</p>}
      {query && hits.length === 0 && <div className="card empty-note">No patients match that search.</div>}
      {hits.length > 0 && (
        <div className="card card-pad">
          <div className="member-list">
            {hits.map((h) => (
              <Link key={h.id} href={`/app/patients/${h.id}`} className="member-row">
                <span className="nm">
                  {h.first} {h.last}
                </span>
                <span className="meta">{h.mobile ? localMobile(h.mobile) : "No mobile"}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
