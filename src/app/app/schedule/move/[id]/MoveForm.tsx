"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { manilaDate } from "@/lib/time";
import { moveVisit } from "../../../actions";
import SlotPicker, { type Slot } from "../../../SlotPicker";

type Props = {
  id: string;
  dentists: { id: string; name: string }[];
  duration: number;
  dentistId: string;
  today: string;
};

/** Pick the new time, then move and text the patient (spec 9.2 moved). */
export default function MoveForm({ id, dentists, duration, dentistId, today }: Props) {
  const router = useRouter();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!slot) return;
    setError("");
    startTransition(async () => {
      const result = await moveVisit(id, slot);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/app/schedule?date=${manilaDate(new Date(slot.startsAt))}`);
    });
  }

  return (
    <div className="card card-pad">
      <SlotPicker
        dentists={dentists}
        duration={duration}
        today={today}
        initialDentistId={dentists.some((d) => d.id === dentistId) ? dentistId : undefined}
        ignoreId={id}
        onChange={setSlot}
      />
      {error && (
        <p className="field-err" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn btn-primary wide-btn mt-5" disabled={!slot || pending} onClick={submit}>
        {pending ? "Moving..." : "Move and text the patient"}
      </button>
    </div>
  );
}
