import { entryDescription, formatDay, formatSeconds } from "@/lib/format";
import type { TimeEntry } from "@/lib/time-entries/types";

export const entryLabel = (e: TimeEntry) => [formatDay(e.date), entryDescription(e), formatSeconds(e.seconds)].filter(Boolean).join(" · ");
