import type { Metadata } from "next";
import AuthForm from "../AuthForm";
import { logIn } from "../actions";

export const metadata: Metadata = { title: "Log in" };

type Props = { searchParams: Promise<{ error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const notice = error === "link" ? "That link has expired or was already used. Log in, or ask for a new link." : undefined;
  return <AuthForm mode="login" action={logIn} notice={notice} />;
}
