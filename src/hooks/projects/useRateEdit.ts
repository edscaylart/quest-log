import { useState } from "react";
import { useFormAction } from "@/hooks/useFormAction";
import type { Repricing } from "@/lib/clients/types";
import { reprices } from "@/lib/projects/reprices";

/**
 * `useFormAction` for a form whose Rate edit reprices uninvoiced Time entries.
 * `submit(preview)` saves straight away when `preview` is null (Rate unchanged);
 * otherwise it previews the repricing and, if anything reprices, holds the save in
 * `repricing` until `confirm` (or `cancel`). A failure lands back on the form.
 */
export function useRateEdit(save: () => Promise<unknown>) {
  const { error, busy, run: attempt, fieldError } = useFormAction();
  const [repricing, setRepricing] = useState<Repricing | null>(null);
  const run = (action: () => Promise<unknown>) => attempt(action).then((ok) => ok || setRepricing(null));

  const submit = (preview: (() => Promise<Repricing>) | null) =>
    run(async () => {
      const previewed = preview && (await preview());
      if (previewed && reprices(previewed)) setRepricing(previewed);
      else await save();
    });

  return { error, busy, fieldError, submit, repricing, confirm: () => run(save), cancel: () => setRepricing(null) };
}
