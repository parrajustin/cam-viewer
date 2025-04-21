import { signal } from "@lit-labs/signals";

// The timestamp the current player is at within a day.
export const TIMESTAMP_SIG = signal<number>(0);
