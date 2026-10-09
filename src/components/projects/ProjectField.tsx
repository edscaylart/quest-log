import { Field } from "@/components/ui/Field";
import { useLoad } from "@/hooks/useLoad";
import { listProjects } from "@/integrations/tauri/commands";
import { label } from "@/lib/labels";

/**
 * Optional project of `clientId`: its active ones, plus `keep` (an entry's
 * current project) even if complete. Changing the client resets it in the caller.
 */
export function ProjectField({
  id,
  clientId,
  projectId,
  setProjectId,
  keep = null,
  error,
}: {
  id: string;
  clientId: number;
  projectId: number | null;
  setProjectId: (id: number | null) => void;
  keep?: number | null;
  /** The invalid-project message, if any. */
  error: string | null;
}) {
  const projects = useLoad(() => (clientId ? listProjects(clientId) : null), [clientId]).data ?? [];

  return (
    <Field id={id} label={label.project} error={error}>
      <select
        id={id}
        value={projectId ?? ""}
        onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)}
        aria-invalid={!!error}
      >
        <option value="">{label.noProject}</option>
        {projects
          .filter((p) => !p.complete || p.id === keep)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
    </Field>
  );
}
