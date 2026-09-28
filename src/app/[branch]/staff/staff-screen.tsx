"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { StateBadge } from "@/components/state-badge";
import { BranchChoice, RoleChoice } from "@/components/staff-fields";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";
import { roleLabel } from "@/lib/labels";
import type { Role } from "@/lib/permissions";
import { formatDateTime, formatTime } from "@/lib/time";
import type { JoinRequestView, StaffView } from "@/server/staff";

type BranchOption = { id: string; name: string };
type Me = { id: string; role: Role; branchIds: string[] };
type JoinRequest = Omit<JoinRequestView, "createdAt"> & { createdAt: string };
type ResetLink = { url: string; expiresAt: string; qrSvg: string };

export function StaffScreen({ me, branches }: { me: Me; branches: BranchOption[] }) {
  const client = useQueryClient();
  const requests = useQuery({ queryKey: ["join-requests"], queryFn: () => api<JoinRequest[]>("/join-requests") });
  const staff = useQuery({ queryKey: ["staff"], queryFn: () => api<StaffView[]>("/staff") });
  const [approving, setApproving] = useState<JoinRequest | null>(null);
  const [declining, setDeclining] = useState<JoinRequest | null>(null);
  const [editing, setEditing] = useState<StaffView | null>(null);
  const [resetting, setResetting] = useState<StaffView | null>(null);
  const [toggling, setToggling] = useState<StaffView | null>(null);

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["join-requests"] }),
      client.invalidateQueries({ queryKey: ["staff"] }),
      client.invalidateQueries({ queryKey: ["dentists"] }),
    ]);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "A closed branch";
  const grantable = me.role === "owner" ? branches : branches.filter((b) => me.branchIds.includes(b.id));

  const decline = useMutation({
    mutationFn: (r: JoinRequest) => api(`/join-requests/${r.id}/decline`, { method: "POST" }),
    onSuccess: async (_data, r) => {
      toast.success(`Declined ${r.name}.`);
      setDeclining(null);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggle = useMutation({
    mutationFn: (s: StaffView) => api(`/staff/${s.id}`, { method: "PATCH", body: { status: s.status === "active" ? "disabled" : "active" } }),
    onSuccess: async (_data, s) => {
      toast.success(s.status === "active" ? `${s.name} is disabled and signed out.` : `${s.name} can sign in again.`);
      setToggling(null);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="grid gap-8">
      <section aria-labelledby="requests-title" className="grid gap-3">
        <h1 id="requests-title" className="text-xl font-semibold">
          Join requests
        </h1>
        {requests.isPending ? (
          <p className="text-muted-foreground">Loading requests...</p>
        ) : requests.isError ? (
          <FormAlert message={errorMessage(requests.error)} />
        ) : requests.data.length === 0 ? (
          <p className="text-muted-foreground">No one is waiting. New staff scan the QR poster at their branch to ask for an account.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {requests.data.map((r) => (
              <li key={r.id}>
                <Card>
                  <CardHeader>
                    <CardTitle>{r.name}</CardTitle>
                    <CardDescription>
                      {`@${r.username} asks to join ${r.branchName} as ${r.role === "manager" ? "front desk" : "a dentist or hygienist"}. Sent ${formatDateTime(new Date(r.createdAt))}.`}
                    </CardDescription>
                  </CardHeader>
                  <CardFooter className="gap-2">
                    <Button onClick={() => setApproving(r)}>Approve</Button>
                    <Button variant="outline" onClick={() => setDeclining(r)}>
                      Decline
                    </Button>
                  </CardFooter>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="staff-title" className="grid gap-3">
        <h2 id="staff-title" className="text-xl font-semibold">
          Staff
        </h2>
        {staff.isPending ? (
          <p className="text-muted-foreground">Loading staff...</p>
        ) : staff.isError ? (
          <FormAlert message={errorMessage(staff.error)} />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Branches</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.name}
                      {s.id === me.id ? " (you)" : ""}
                    </TableCell>
                    <TableCell>{`@${s.username}`}</TableCell>
                    <TableCell>{roleLabel(s.role, s.title)}</TableCell>
                    <TableCell>{s.role === "owner" ? "All branches" : s.branchIds.map(branchName).join(", ") || "None"}</TableCell>
                    <TableCell>
                      <StateBadge on={s.status === "active"} yes="Active" no="Disabled" warn />
                    </TableCell>
                    <TableCell>
                      {s.canManage && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" onClick={() => setEditing(s)}>
                            Edit
                          </Button>
                          {s.id !== me.id && (
                            <Button variant="ghost" onClick={() => setResetting(s)}>
                              Reset password
                            </Button>
                          )}
                          {s.id !== me.id && (
                            <Button variant="ghost" onClick={() => setToggling(s)}>
                              {s.status === "active" ? "Disable" : "Enable"}
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {approving && <ApproveDialog request={approving} branches={grantable} onClose={() => setApproving(null)} onDone={refresh} />}
      <ConfirmDialog
        open={declining !== null}
        title={`Decline ${declining?.name ?? ""}?`}
        description="Their account is deleted. They can scan the QR poster again to ask anew."
        confirmLabel="Decline"
        pending={decline.isPending}
        onConfirm={() => declining && decline.mutate(declining)}
        onOpenChange={(open) => !open && setDeclining(null)}
      />
      {editing && <EditDialog person={editing} me={me} branches={grantable} onClose={() => setEditing(null)} onDone={refresh} />}
      {resetting && <ResetDialog person={resetting} onClose={() => setResetting(null)} />}
      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.status === "active" ? `Disable ${toggling?.name ?? ""}?` : `Enable ${toggling?.name ?? ""}?`}
        description={
          toggling?.status === "active"
            ? "They are signed out at once and cannot sign in. Their name stays on everything they did."
            : "They can sign in again with their password."
        }
        confirmLabel={toggling?.status === "active" ? "Disable" : "Enable"}
        destructive={toggling?.status === "active"}
        pending={toggle.isPending}
        onConfirm={() => toggling && toggle.mutate(toggling)}
        onOpenChange={(open) => !open && setToggling(null)}
      />
    </div>
  );
}

function ApproveDialog({
  request,
  branches,
  onClose,
  onDone,
}: {
  request: JoinRequest;
  branches: BranchOption[];
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const [role, setRole] = useState<"manager" | "dentist">(request.role === "dentist" ? "dentist" : "manager");
  const [branchIds, setBranchIds] = useState<string[]>(branches.some((b) => b.id === request.branchId) ? [request.branchId] : []);
  const [title, setTitle] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const approve = useMutation({
    mutationFn: () => api(`/join-requests/${request.id}/approve`, { method: "POST", body: { role, branchIds, title: role === "dentist" ? title.trim() || null : null } }),
    onSuccess: async () => {
      toast.success(`${request.name} can now use DentaSync.`);
      onClose();
      await onDone();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Approve ${request.name}`}</DialogTitle>
          <DialogDescription>Choose their role and the branches they work at.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            approve.mutate();
          }}
        >
          <RoleChoice value={role} onChange={setRole} />
          <BranchChoice branches={branches} value={branchIds} onChange={setBranchIds} error={errors.branchIds} />
          {role === "dentist" && (
            <TextField label="Title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Dentist, Orthodontist, Hygienist" maxLength={40} error={errors.title} />
          )}
          <DialogFooter>
            <Button type="submit" disabled={approve.isPending || branchIds.length === 0}>
              {approve.isPending ? "Approving..." : "Approve"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  person,
  me,
  branches,
  onClose,
  onDone,
}: {
  person: StaffView;
  me: Me;
  branches: BranchOption[];
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const isOwner = person.role === "owner";
  const firstRole = person.role === "dentist" ? "dentist" : "manager";
  const shown = person.branchIds.filter((id) => branches.some((b) => b.id === id));
  const [role, setRole] = useState<"manager" | "dentist">(firstRole);
  const [branchIds, setBranchIds] = useState(shown);
  const [title, setTitle] = useState(person.title ?? "");
  // Branches go only when changed, so saving a title never touches memberships the dialog does not list.
  const branchesChanged = branchIds.length !== shown.length || branchIds.some((id) => !shown.includes(id));
  const [seesPatients, setSeesPatients] = useState(person.seesPatients);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      api(`/staff/${person.id}`, {
        method: "PATCH",
        body: isOwner
          ? { title: title.trim() || null, seesPatients }
          : { role, ...(branchesChanged ? { branchIds } : {}), title: title.trim() || null },
      }),
    onSuccess: async () => {
      toast.success(`Saved ${person.name}.`);
      onClose();
      await onDone();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Edit ${person.name}`}</DialogTitle>
          <DialogDescription>Changes apply on their next click.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          {isOwner ? (
            <label className="flex min-h-11 items-start gap-3 rounded-md border p-3">
              <input type="checkbox" checked={seesPatients} onChange={(event) => setSeesPatients(event.target.checked)} className="mt-1 size-4 accent-primary" />
              <span className="grid gap-0.5">
                <span className="font-medium">I see patients</span>
                <span className="text-sm text-muted-foreground">Gives you a schedule, your own visits, and writing on charts and notes.</span>
              </span>
            </label>
          ) : (
            <>
              <RoleChoice
                value={role}
                onChange={(next) => {
                  setRole(next);
                  // A new role starts with no title (an Orthodontist moving to the front desk); back again restores it.
                  setTitle(next === firstRole ? (person.title ?? "") : "");
                }}
              />
              <BranchChoice branches={branches} value={branchIds} onChange={setBranchIds} error={errors.branchIds} />
              {me.role !== "owner" && <p className="text-sm text-muted-foreground">Branches you do not work at stay as they are.</p>}
            </>
          )}
          <TextField label="Title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Dentist, Orthodontist, Hygienist" maxLength={40} error={errors.title} />
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({ person, onClose }: { person: StaffView; onClose: () => void }) {
  const create = useMutation({
    mutationFn: () => api<ResetLink>(`/staff/${person.id}/reset-link`, { method: "POST" }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Reset the password of ${person.name}`}</DialogTitle>
          <DialogDescription>
            They scan the code with their phone and choose a new password. It works once, for 15 minutes, and signs them out everywhere.
          </DialogDescription>
        </DialogHeader>
        {create.data ? (
          <div className="grid justify-items-center gap-3">
            <div className="w-56 rounded-md bg-white p-2" role="img" aria-label="Password reset QR code" dangerouslySetInnerHTML={{ __html: create.data.qrSvg }} />
            <p className="text-sm text-muted-foreground">{`Works until ${formatTime(new Date(create.data.expiresAt))}.`}</p>
            <p className="max-w-full text-sm break-all">{create.data.url}</p>
          </div>
        ) : (
          <DialogFooter>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Creating..." : "Show the reset QR"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
