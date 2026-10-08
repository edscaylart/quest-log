import { localDate, localTime } from "@/lib/format";

/** Local "YYYY-MM-DDTHH:MM", what `<input type="datetime-local">` holds. */
export const localDateTime = (ms: number) => `${localDate(new Date(ms))}T${localTime(ms / 1000)}`;
