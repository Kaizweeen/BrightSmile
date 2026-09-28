"use client";

type StaffRole = "manager" | "dentist";

const ROLES: readonly [StaffRole, string, string][] = [
  ["manager", "Front desk", "Books visits, checks patients in, and approves staff at their branches."],
  ["dentist", "Dentist or hygienist", "Sees their own visits and writes charts and notes."],
];

export function RoleChoice({ value, onChange }: { value: StaffRole; onChange: (role: StaffRole) => void }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Role</legend>
      {ROLES.map(([role, label, hint]) => (
        <label key={role} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary">
          <input type="radio" name="role" value={role} checked={value === role} onChange={() => onChange(role)} className="mt-1 size-4 accent-primary" />
          <span className="grid gap-0.5">
            <span className="font-medium">{label}</span>
            <span className="text-sm text-muted-foreground">{hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function BranchChoice({
  branches,
  value,
  onChange,
  error,
}: {
  branches: { id: string; name: string }[];
  value: string[];
  onChange: (branchIds: string[]) => void;
  error?: string;
}) {
  return (
    <fieldset className="grid gap-2" aria-describedby={error ? "branch-choice-error" : undefined}>
      <legend className="mb-1 text-sm font-medium">Branches</legend>
      {branches.map((branch) => (
        <label key={branch.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3">
          <input
            type="checkbox"
            checked={value.includes(branch.id)}
            onChange={(event) => onChange(event.target.checked ? [...value, branch.id] : value.filter((id) => id !== branch.id))}
            className="size-4 accent-primary"
          />
          {branch.name}
        </label>
      ))}
      {error && (
        <p id="branch-choice-error" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
