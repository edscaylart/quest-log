import type { Repricing } from "@/lib/clients/types";

/** Whether a rate edit needs the repricing confirm. */
export const reprices = (r: Repricing) => r.seconds > 0 && r.oldCents !== r.newCents;
