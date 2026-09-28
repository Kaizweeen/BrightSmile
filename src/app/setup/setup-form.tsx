"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

export function SetupForm() {
  const router = useRouter();
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
      const { username } = await api<{ username: string }>("/setup", {
        method: "POST",
        body: {
          setupCode: value("setupCode"),
          practiceName: value("practiceName"),
          name: value("name"),
          username: value("username"),
          password: value("password"),
        },
      });
      const { error } = await authClient.signIn.username({ username, password: value("password") });
      if (error) throw new Error("DentaSync is set up, but signing in failed. Sign in on the next page.");
      router.replace("/");
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
      <TextField name="setupCode" label="Setup code" type="password" autoComplete="off" error={errors.setupCode} hint="The SETUP_TOKEN value from the server's settings." />
      <TextField name="practiceName" label="Practice name" maxLength={80} error={errors.practiceName} />
      <TextField name="name" label="Your full name" autoComplete="name" maxLength={80} error={errors.name} />
      <TextField name="username" label="Username" autoComplete="username" autoCapitalize="none" maxLength={30} error={errors.username} hint="3 to 30 letters, numbers, dots, or underscores." />
      <TextField name="password" label="Password" type="password" autoComplete="new-password" error={errors.password} hint="At least 10 characters." />
      <TextField name="confirm" label="Password again" type="password" autoComplete="new-password" error={errors.confirm} />
      <Button type="submit" disabled={pending}>
        {pending ? "Setting up..." : "Set up DentaSync"}
      </Button>
    </form>
  );
}
