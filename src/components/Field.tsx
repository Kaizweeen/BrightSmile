import type { ReactNode } from "react";

/** A labelled field: the label wraps the input, then a hint or an error below it. */
export default function Field({
  label,
  children,
  error,
  optional,
  hint,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  optional?: boolean;
  hint?: string;
}) {
  return (
    <label className="mt-4 block">
      <span className="f-label">
        {label}
        {optional && <span className="f-optional">Optional</span>}
      </span>
      {children}
      {hint && !error && <span className="f-hint block">{hint}</span>}
      {error && <span className="field-err block">{error}</span>}
    </label>
  );
}
