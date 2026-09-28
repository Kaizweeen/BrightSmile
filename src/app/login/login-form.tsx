"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setAlert(null);
    const { error } = await authClient.signIn.username({
      username: String(form.get("username") ?? "").trim().toLowerCase(),
      password: String(form.get("password") ?? ""),
    });
    if (error) {
      setAlert(
        error.status === 429
          ? "Too many attempts. Wait 15 minutes, then try again."
          : "That username and password do not match.",
      );
      setPending(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormAlert message={alert} />
      <TextField name="username" label="Username" required autoComplete="username" autoCapitalize="none" />
      <TextField name="password" label="Password" type="password" required autoComplete="current-password" />
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
