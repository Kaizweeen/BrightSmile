import type { Metadata } from "next";
import type { ReactNode } from "react";
import JoinButton from "./JoinButton";
import { continueToJoin, logOutToJoin } from "../actions";
import { logError } from "@/lib/log";
import { signedInStaff } from "@/lib/supabase/server";
import { joinView } from "@/lib/team";
import { inviteClinicName } from "@/lib/team-data";

// Never prerendered or cached: what it shows depends on the link and on who is signed in (teams spec 6.2).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join a clinic", robots: { index: false, follow: false } };

type Props = { params: Promise<{ token: string }> };

function Card({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">{title}</h1>
        <p className="sub">{sub}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * Teams spec 6.2: where a join link lands. It names the clinic only for an open link and joins only on a button press,
 * so a link preview that opens the page changes nothing.
 */
export default async function JoinPage({ params }: Props) {
  const { token } = await params;
  let clinic: string | null;
  try {
    clinic = await inviteClinicName(token, new Date());
  } catch (e) {
    logError("join page", e);
    return <Card title="Something went wrong" sub="Try the link again." />;
  }
  const visitor = await signedInStaff();
  const view = joinView(clinic, visitor && { hasClinic: visitor.clinicId !== null });
  if (view === "gone" || clinic === null) return <Card title="This join link no longer works" sub="Ask the clinic for a new one." />;

  if (view === "signed_out") {
    return (
      <Card title={`${clinic} invited you to BrightSmile`} sub="Create an account to join the clinic's team, or log in if you already have one.">
        <form action={continueToJoin}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" name="to" value="signup" className="btn btn-primary wide-btn">
            Create an account
          </button>
          <button type="submit" name="to" value="login" className="btn btn-ghost wide-btn mt-3">
            I already have an account
          </button>
        </form>
      </Card>
    );
  }

  if (view === "member") {
    return (
      <Card title={`Join ${clinic}`} sub="This account already belongs to a clinic.">
        <p className="note-box warn mb-4">Log out and use another email to join {clinic}.</p>
        <form action={logOutToJoin}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="btn btn-primary wide-btn">
            Log out
          </button>
        </form>
      </Card>
    );
  }

  return (
    <Card title={`Join ${clinic}`} sub="You will see and handle its requests, schedule, and patients.">
      <JoinButton token={token} clinic={clinic} />
    </Card>
  );
}
