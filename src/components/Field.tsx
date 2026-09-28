import type { ReactNode } from "react";

/** A labelled field: the label wraps the input, then a hint or an error below it. The mark says Required or Optional in words. */
export default function Field({
  label,
  children,
  error,
  optional,
  required,
  hint,
}: {
  label: string;
  children: ReactNode;
  error?: string;
  optional?: boolean;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="mt-4 block">
      <span className="f-label">
        {label}
        {required && <span className="f-optional">Required</span>}
        {optional && <span className="f-optional">Optional</span>}
      </span>
      {children}
      {hint && !error && <span className="f-hint block">{hint}</span>}
      {error && <span className="field-err block">{error}</span>}
    </label>
  );
}
