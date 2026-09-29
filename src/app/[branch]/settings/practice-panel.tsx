"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { api, errorMessage, fieldErrors } from "@/lib/fetcher";

export function PracticePanel({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: () => api("/practice", { method: "PATCH", body: { name } }),
    onSuccess: () => {
      toast.success("Practice name saved.");
      setError(undefined);
      router.refresh();
    },
    onError: (e) => setError(fieldErrors(e).name ?? errorMessage(e)),
  });
  return (
    <form
      className="grid max-w-md gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <TextField label="Practice name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} error={error} />
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
