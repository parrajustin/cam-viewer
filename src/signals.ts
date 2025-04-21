import { signal } from "@lit-labs/signals";

export enum TimestampSignalSource {
    USER = 0,
    PLAYER_COMPONENT = 1,
    DVR_UI_TIMELINE_COMPONENT = 2,
}

interface TimestampSignalI {
    // The timestamp the current player is at within a day in seconds.
    value: number;
    source: TimestampSignalSource;
}
// The timestamp the current player is at within a day.
export const TIMESTAMP_SIG = signal<TimestampSignalI>({value: 0, source: TimestampSignalSource.USER});
