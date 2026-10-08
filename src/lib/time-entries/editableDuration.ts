import { formatClock, formatSeconds } from "@/lib/format";

/** Like formatSeconds, but keeps leftover seconds so an untouched edit saves the same duration. */
export const editableDuration = (s: number) => (s % 60 ? formatClock(s) : formatSeconds(s));
