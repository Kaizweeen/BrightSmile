"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, ExternalLinkIcon, FileImageIcon, FileTextIcon, FolderOpenIcon, Trash2Icon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-alert";
import { LoadingRows } from "@/components/loading";
import { TextField } from "@/components/text-field";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api, errorMessage, fieldErrors, upload } from "@/lib/fetcher";
import { FILE_ACCEPT, FILE_CATEGORIES, FILE_CATEGORY_LABELS, formatSize, MAX_FILE_BYTES, type FileCategory } from "@/lib/files";
import { can, type Subject } from "@/lib/permissions";
import { formatDateTime } from "@/lib/time";

type FileJson = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  category: FileCategory;
  description: string;
  createdAt: string;
  uploadedBy: string;
  uploaderName: string;
};

function UploadForm({ patientId }: { patientId: string }) {
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const categoryId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<FileCategory | "">("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (file) form.set("file", file);
      form.set("category", category);
      form.set("description", description);
      return upload(`/patients/${patientId}/files`, form);
    },
    onSuccess: async () => {
      toast.success("File added.");
      setFile(null);
      setCategory("");
      setDescription("");
      setErrors({});
      if (input.current) input.current.value = "";
      await client.invalidateQueries({ queryKey: ["files", patientId] });
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      if (Object.keys(fieldErrors(error)).length === 0) toast.error(errorMessage(error));
    },
  });
  // Said at once, before a slow upload the server would refuse anyway.
  const tooBig = file !== null && file.size > MAX_FILE_BYTES;
  const fileError = tooBig ? "The file is over 4 MB. Scan or save it smaller and try again." : errors.file;

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!tooBig) send.mutate();
      }}
    >
      <TextField
        ref={input}
        type="file"
        label="File"
        accept={FILE_ACCEPT}
        hint="PDF, JPEG, PNG, or WebP, up to 4 MB."
        error={fileError || undefined}
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setErrors((e) => ({ ...e, file: "" }));
        }}
      />
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
        <div className="grid gap-1.5">
          <Label htmlFor={categoryId}>What it is</Label>
          <NativeSelect
            id={categoryId}
            value={category}
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={errors.category ? `${categoryId}-error` : undefined}
            onChange={(event) => setCategory(event.target.value as FileCategory)}
            className="w-full"
          >
            <NativeSelectOption value="" disabled>
              Choose one
            </NativeSelectOption>
            {FILE_CATEGORIES.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {FILE_CATEGORY_LABELS[c]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {errors.category && (
            <p id={`${categoryId}-error`} className="text-sm text-destructive">
              {errors.category}
            </p>
          )}
        </div>
        <TextField
          label="Description (optional)"
          value={description}
          maxLength={200}
          placeholder="Upper right periapical, before root canal"
          error={errors.description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div>
        <Button type="submit" disabled={!file || !category || tooBig || send.isPending}>
          {send.isPending ? "Uploading..." : "Upload the file"}
        </Button>
      </div>
    </form>
  );
}

/** The patient's Files tab: X-rays, photos, and signed forms, newest first. Anyone may add; removal is for the uploader, owner, or a manager. */
export function FilesTab({ patientId, staff }: { patientId: string; staff: Subject }) {
  const client = useQueryClient();
  const [removing, setRemoving] = useState<FileJson | null>(null);
  const files = useQuery({ queryKey: ["files", patientId], queryFn: () => api<FileJson[]>(`/patients/${patientId}/files`) });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/files/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("File removed.");
      setRemoving(null);
      await client.invalidateQueries({ queryKey: ["files", patientId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="grid max-w-3xl gap-6">
      {can(staff, "files.add") && (
        <section aria-labelledby="new-file-title" className="grid gap-3 rounded-xl border bg-card p-3 shadow-xs">
          <h2 id="new-file-title" className="font-semibold">
            Add a file
          </h2>
          <UploadForm patientId={patientId} />
        </section>
      )}
      <section aria-labelledby="files-title" className="grid gap-3">
        <h2 id="files-title" className="text-lg font-semibold">
          Files
        </h2>
        {files.isError ? (
          <FormAlert message={errorMessage(files.error)} />
        ) : files.isPending ? (
          <LoadingRows rows={3} label="Loading files..." />
        ) : files.data.length === 0 ? (
          <EmptyState icon={FolderOpenIcon} title="No files yet">
            X-rays, photos, and signed forms you upload appear here.
          </EmptyState>
        ) : (
          <ul className="grid gap-3">
            {files.data.map((f) => {
              const Icon = f.contentType === "application/pdf" ? FileTextIcon : FileImageIcon;
              return (
                <li key={f.id} className="grid gap-2 rounded-xl border bg-card p-3 shadow-xs">
                  <div className="flex items-start gap-3">
                    <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                    <div className="grid min-w-0 flex-1 gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 font-medium break-all">{f.name}</span>
                        <Badge variant="secondary">{FILE_CATEGORY_LABELS[f.category] ?? f.category}</Badge>
                      </div>
                      {f.description && <p className="text-sm">{f.description}</p>}
                      <p className="text-sm text-muted-foreground">{[formatSize(f.size), formatDateTime(new Date(f.createdAt)), f.uploaderName].join(", ")}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <a href={`/api/v1/files/${f.id}`} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline" })}>
                      <ExternalLinkIcon aria-hidden />
                      Open
                    </a>
                    <a href={`/api/v1/files/${f.id}?download=1`} className={buttonVariants({ variant: "outline" })}>
                      <DownloadIcon aria-hidden />
                      Download
                    </a>
                    {can(staff, "files.remove", { userId: f.uploadedBy }) && (
                      <Button variant="ghost" className="text-destructive" onClick={() => setRemoving(f)}>
                        <Trash2Icon aria-hidden />
                        Remove
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this file?"
        description={`${removing?.name ?? "The file"} will be deleted from the record for good. The access log keeps that it was removed.`}
        confirmLabel="Remove the file"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </div>
  );
}
