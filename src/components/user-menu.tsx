"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/form-alert";
import { TextField } from "@/components/text-field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

export function UserMenu({ name, role }: { name: string; role: string }) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);

  async function signOut() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonVariants({ variant: "ghost" })}>
          {name}
          <span className="sr-only">{`, ${role}. Open the account menu.`}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{role}</p>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setChanging(true)}>Change password</DropdownMenuItem>
          <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={changing} onOpenChange={setChanging} />
    </>
  );
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    if (value("newPassword").length < 10) {
      setErrors({ newPassword: "Use at least 10 characters" });
      return;
    }
    if (value("newPassword") !== value("confirm")) {
      setErrors({ confirm: "The passwords do not match" });
      return;
    }
    setPending(true);
    setErrors({});
    setAlert(null);
    const { error } = await authClient.changePassword({
      currentPassword: value("currentPassword"),
      newPassword: value("newPassword"),
      revokeOtherSessions: true,
    });
    setPending(false);
    if (error) {
      setAlert(error.status === 400 || error.status === 401 ? "Your current password is not right." : "The password could not be changed. Try again.");
      return;
    }
    toast.success("Password changed. Your other devices are signed out.");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Other devices signed in to your account are signed out.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <FormAlert message={alert} />
          <TextField name="currentPassword" label="Current password" type="password" autoComplete="current-password" error={errors.currentPassword} />
          <TextField name="newPassword" label="New password" type="password" autoComplete="new-password" error={errors.newPassword} hint="At least 10 characters." />
          <TextField name="confirm" label="New password again" type="password" autoComplete="new-password" error={errors.confirm} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
