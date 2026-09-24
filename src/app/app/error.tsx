"use client";

/** Spec 13: something went wrong loading a dashboard page. */
export default function AppError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">Something went wrong loading this page</h1>
        <p className="sub">Try again.</p>
        <button type="button" className="btn btn-primary wide-btn" onClick={() => retry()}>
          Try again
        </button>
      </div>
    </div>
  );
}
