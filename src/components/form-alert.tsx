import { Alert, AlertDescription } from "@/components/ui/alert";

/** A form-level error, announced to screen readers. */
export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
