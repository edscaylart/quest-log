import { useState } from "react";
import { toCoreError, type CoreError } from "@/lib/errors";

/**
 * A form's busy flag and core error. `run` awaits `action`, clearing the error
 * if it succeeds and capturing what it throws if not; it resolves to whether it succeeded.
 * `fieldError` is the message for an invalid `field`, else null.
 */
export function useFormAction() {
  const [error, setError] = useState<CoreError | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (err: unknown) => setError(toCoreError(err));
  const fieldError = (field: string) => (error?.kind === "invalid" && error.field === field ? error.message : null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      setError(null);
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { error, setError, busy, run, fail, fieldError };
}
