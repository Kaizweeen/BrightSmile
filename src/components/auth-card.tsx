import { Smile } from "lucide-react";

/**
 * The page around the account forms. Staff pages (brand) sit on a green background with the form on a white card;
 * the public booking page stays plain.
 */
export function AuthCard({ title, description, brand = false, children }: { title: string; description?: string; brand?: boolean; children?: React.ReactNode }) {
  const form = (
    <main
      id="main"
      className={
        brand
          ? "flex w-full max-w-md flex-col gap-6 rounded-2xl bg-card p-6 text-card-foreground shadow-lg sm:p-8"
          : "mx-auto flex w-full max-w-md flex-col justify-center gap-6 px-4 py-10 sm:px-6"
      }
    >
      <p className="flex items-center gap-2 font-heading text-lg font-semibold text-primary">
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
  );
  if (!brand) return <div className="min-h-dvh">{form}</div>;
  return <div className="flex min-h-dvh items-center justify-center bg-primary px-4 py-10">{form}</div>;
}
