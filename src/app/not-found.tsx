import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <AuthCard title="Not found" description="This page does not exist, or you do not have access to it.">
      <Link href="/" className={buttonVariants({ className: "w-fit" })}>
        Go to DentaSync
      </Link>
    </AuthCard>
  );
}
