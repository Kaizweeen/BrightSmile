"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/fetcher";

const MAX_BYTES = 200 * 1024;

/** The clinic's payment QR image, shown to patients at checkout (billing spec 5). */
export function BillingPanel({ initialImage }: { initialImage: string | null }) {
  const [image, setImage] = useState(initialImage);
  const save = useMutation({
    mutationFn: (next: string | null) => api("/practice/qr", { method: "PUT", body: { image: next } }).then(() => next),
    onSuccess: (next) => {
      setImage(next);
      toast.success(next ? "Saved the QR code." : "Removed the QR code.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const choose = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) return void toast.error("Use a PNG or JPEG image.");
    if (file.size > MAX_BYTES) return void toast.error("Use an image under 200 KB.");
    const reader = new FileReader();
    reader.onload = () => save.mutate(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <div className="grid max-w-md gap-4">
      <p className="text-muted-foreground">Patients scan this at checkout when they pay by QR. Use a PNG or JPEG under 200 KB.</p>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="The clinic's payment QR code" className="size-64 rounded-lg border bg-white object-contain p-2" />
      ) : (
        <p className="rounded-lg border p-4 text-muted-foreground">No QR code yet.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer">
          <span className="sr-only">Choose a QR image</span>
          <input type="file" accept="image/png,image/jpeg" className="text-sm" disabled={save.isPending} onChange={(event) => choose(event.target.files?.[0])} />
        </label>
        {image && (
          <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate(null)}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
