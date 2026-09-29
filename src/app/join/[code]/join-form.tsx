"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { RoleChoice } from "@/components/staff-fields";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

export function JoinForm({ code }: { code: string }) {
  const router = useRouter();
  const [role, setRole] = useState<"manager" | "dentist">("manager");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    if (value("password") !== value("confirm")) {
      setErrors({ confirm: "The passwords do not match" });
      return;
    }
    setPending(true);
    setErrors({});
    setAlert(null);
    try {
      const { username } = await api<{ username: string }>(`/join/${code}`, {
        method: "POST",
        body: { name: value("name"), username: value("username"), password: value("password"), role },
      });
      const { error } = await authClient.signIn.username({ username, password: value("password") });
      if (error) throw new Error("Your request is sent, but signing in failed. Sign in to see whether it is approved.");
      router.replace("/waiting");
      router.refresh();
    } catch (error) {
      const fields = fieldErrors(error);
      setErrors(fields);
      setAlert(Object.keys(fields).length > 0 ? null : errorMessage(error));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormAlert message={alert} />
      <TextField name="name" label="Your full name" autoComplete="name" maxLength={80} error={errors.name} />
      <TextField name="username" label="Username" autoComplete="username" autoCapitalize="none" maxLength={30} error={errors.username} hint="3 to 30 letters, numbers, dots, or underscores. You sign in with it." />
      <TextField name="password" label="Password" type="password" autoComplete="new-password" error={errors.password} hint="At least 10 characters." />
      <TextField name="confirm" label="Password again" type="password" autoComplete="new-password" error={errors.confirm} />
      <RoleChoice value={role} onChange={setRole} />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Ask for an account"}
      </Button>
    </form>
  );
}
