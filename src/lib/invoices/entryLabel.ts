import { formatDay, formatSeconds } from "@/lib/format";
import type { TimeEntry } from "@/lib/time-entries/types";

export const entryLabel = (e: TimeEntry) => [formatDay(e.date), e.projectName, e.note, formatSeconds(e.seconds)].filter(Boolean).join(" · ");
