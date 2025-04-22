import { Signal, signal } from "@lit-labs/signals";

export enum TimestampSignalSource {
    USER = 0,
    PLAYER_COMPONENT = 1,
    DVR_UI_TIMELINE_COMPONENT = 2
}

interface TimestampSignalI {
    // The timestamp the current player is at within a day in seconds.
    value: number;
    source: TimestampSignalSource;
}
// The timestamp the current player is at within a day.
export const TIMESTAMP_SIG = signal<TimestampSignalI>({
    value: 0,
    source: TimestampSignalSource.USER
});

const signalWatcher = new Signal.subtle.Watcher(async () => {
    // Notify callbacks are not allowed to access signals synchronously
    await 0;

    switch (TIMESTAMP_SIG.get().source) {
        case TimestampSignalSource.PLAYER_COMPONENT:
            break;
        case TimestampSignalSource.USER:
        case TimestampSignalSource.DVR_UI_TIMELINE_COMPONENT:
            PLAYERSTATE_SIG.set(PlayerState.PAUSED);
            break;
    }
    signalWatcher.watch(TIMESTAMP_SIG);
});
signalWatcher.watch(TIMESTAMP_SIG);

export enum PlayerState {
    PLAYING = 0,
    PAUSED = 1
}
// The timestamp the current player is at within a day.
export const PLAYERSTATE_SIG = signal<PlayerState>(PlayerState.PAUSED);
