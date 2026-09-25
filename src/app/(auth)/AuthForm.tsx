"use client";

import Link from "next/link";
import { useActionState } from "react";
import Field from "@/components/Field";
import type { AuthState } from "./actions";

type Mode = "signup" | "login" | "forgot" | "reset";
type Props = {
  mode: Mode;
  action: (state: AuthState, form: FormData) => Promise<AuthState>;
  notice?: string;
};

const COPY: Record<Mode, { title: string; sub: string; button: string }> = {
  signup: {
    title: "Create your clinic account",
    sub: "Step 1 of 4. Next you set up your clinic, your dentist, and your procedures.",
    button: "Create account",
  },
  login: { title: "Log in", sub: "Welcome back to BrightSmile.", button: "Log in" },
  forgot: { title: "Reset your password", sub: "We will email you a link to set a new one.", button: "Send reset link" },
  reset: { title: "Set a new password", sub: "Use at least 8 characters.", button: "Save password" },
};

export default function AuthForm({ mode, action, notice }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const copy = COPY[mode];

  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">{copy.title}</h1>
        <p className="sub">{copy.sub}</p>
        {notice && <p className="note-box warn mb-4">{notice}</p>}

        {state.sent ? (
          <p className="note-box" role="status">
            {state.sent}
          </p>
        ) : (
          <form action={formAction}>
            {mode !== "reset" && (
              <Field label="Email">
                <input
                  className="f-input"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  defaultValue={state.email}
                />
              </Field>
            )}
            {mode !== "forgot" && (
              <Field label="Password" hint={mode === "login" ? undefined : "At least 8 characters."}>
                <input
                  className="f-input"
                  name="password"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={mode === "login" ? undefined : 8}
                  maxLength={72}
                  required
                />
              </Field>
            )}
            {state.error && (
              <p className="field-err mt-3" role="alert">
                {state.error}
                {state.expired && (
                  <>
                    {" "}
                    <Link href="/forgot" className="link">
                      Ask for a new one.
                    </Link>
                  </>
                )}
              </p>
            )}
            <button type="submit" className="btn btn-primary wide-btn mt-6" disabled={pending}>
              {pending ? "One moment..." : copy.button}
            </button>
          </form>
        )}

        <p className="f-hint mt-4">
          {mode === "signup" && (
            <>
              Already have an account?{" "}
              <Link href="/login" className="link">
                Log in
              </Link>
            </>
          )}
          {mode === "login" && (
            <>
              <Link href="/forgot" className="link">
                Forgot password?
              </Link>{" "}
              New here?{" "}
              <Link href="/signup" className="link">
                Create an account
              </Link>
            </>
          )}
          {(mode === "forgot" || mode === "reset") && (
            <Link href="/login" className="link">
              Back to log in
            </Link>
          )}
        </p>
      </div>
    </div>
  );
}
