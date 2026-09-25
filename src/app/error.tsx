"use client";

/** Spec 13: catches what the segment error pages cannot, such as a failed database read in the /app layout. */
export default function RootError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">Something went wrong</h1>
        <p className="sub">BrightSmile is temporarily unavailable. Please try again in a few minutes.</p>
        <button type="button" className="btn btn-primary wide-btn" onClick={() => retry()}>
          Try again
        </button>
      </div>
    </div>
  );
}
