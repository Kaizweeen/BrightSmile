export function AuthCard({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <p className="text-sm font-semibold tracking-wide text-primary">DentaSync</p>
      <div className="grid gap-2">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {children}
    </main>
  );
}
