"use client";

/** Spec 13: database unavailable. */
export default function BookingError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">Booking is temporarily unavailable</h1>
        <p className="sub">Please try again in a few minutes.</p>
        <button type="button" className="btn btn-primary wide-btn" onClick={() => retry()}>
          Try again
        </button>
      </div>
    </div>
  );
}
