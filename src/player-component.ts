import { LitElement, html, css, PropertyValues, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { DateTime, Settings } from "luxon";
import { Signal, SignalWatcher } from "@lit-labs/signals";
import { PlayerState, PLAYERSTATE_SIG, TIMESTAMP_SIG, TimestampSignalSource } from "./signals";
import { SERVER_BASE_URL } from "./constants";
import { createRef, ref } from "lit/directives/ref.js";
import { cache } from "lit/directives/cache.js";
import { None, Optional, Some } from "./common/optional";
import { Task } from "@lit/task";
import { CAM_DB, VIDEOS_LOADED } from "./cam-videos";
import { WrapPromise } from "./common/wrap_promise";

// Set the default timezone
Settings.defaultZone = "America/Denver";

@customElement("player-component")
export class PlayerComponent extends SignalWatcher(LitElement) {
    @property({ type: String })
    public selectedDate: string = DateTime.now().toFormat("yyyy-MM-dd");

    @property({ type: String })
    public selectedCameraId: string = "all"; // 'all' or a specific camera ID

    // The html5 video tag ref.
    private playerRef = createRef<HTMLVideoElement>();

    private oldVideoRef = "";
    private currentVideoRef = "";
    // Video start in seconds.
    private videoStart = 0;
    private videoEnd = 0;

    private lastVideoTemplate: Optional<TemplateResult<1>> = None;

    private getVideosOfDay = new Task(this, {
        task: async ([selectedCameraId, selectedDate], {}) => {
            console.log("running fetch of new videos");
            await VIDEOS_LOADED;

            // Convert the selected iso date sting to a luxor date object.
            const dateObj = DateTime.fromFormat(selectedDate, "yyyy-MM-dd");
            if (!dateObj.isValid) {
                this.lastVideoTemplate = None;
                return [];
            }
            const startDay = dateObj.toSeconds();
            const endDay = dateObj.plus({ days: 1 }).toSeconds();
            const allDayVideosResult = await WrapPromise(
                CAM_DB.videoFiles
                    .where("camName")
                    .equals(selectedCameraId)
                    .and((v) => {
                        return (
                            startDay <= v.vidStartEpoch &&
                            v.vidEndEpoch <= endDay
                        );
                    }).sortBy("vidDayStart"),
                "Failed to get each unique key"
            );
            if (allDayVideosResult.err) {
                throw allDayVideosResult.val;
            }
            return allDayVideosResult.val;
        },
        initialValue: [],
        args: () => [this.selectedCameraId, this.selectedDate]
    });

    private buildVideoPlayer = new Task(this, {
        task: async ([selectedCameraId, selectedDate, dayVideos], {}) => {
            if (dayVideos === undefined) {
                return html`Failed to get day videos`;
            }
            await VIDEOS_LOADED;

            // Convert the selected iso date sting to a luxor date object.
            const dateObj = DateTime.fromFormat(selectedDate, "yyyy-MM-dd");
            if (!dateObj.isValid) {
                this.lastVideoTemplate = None;
                return html`Failed to parse date format ${selectedDate}`;
            }

            const playerTime = TIMESTAMP_SIG.get().value;
            const currentVideoEntry = dayVideos.find((v) => {
                        return (
                            v.vidDayStart <= playerTime &&
                            playerTime < v.vidDayEnd
                        );
                    });
            if (currentVideoEntry === undefined) {
                this.lastVideoTemplate = None;
                return html`Found no video for ${selectedCameraId},
                ${dateObj.plus({ seconds: playerTime }).toISO()}`;
            }

            // TODO: We can also preload the next video.
            // const nextVideo = await WrapPromise(
            //     CAM_DB.videoFiles.where("camName").equals(selectedCameraId).and((v) => {
            //         return x2 >= startDay && x1 <= endDay;
            //     }).sortBy("vidStartEpoch"),
            //     "Failed to get each unique key"
            // );

            this.currentVideoRef = currentVideoEntry.filePath;
            this.videoStart = currentVideoEntry.vidDayStart;
            this.videoEnd = currentVideoEntry.vidDayEnd;
            console.log("setting path to ", currentVideoEntry);

            this.lastVideoTemplate = Some(html`
                <video
                    width="auto"
                    height="100%"
                    crossorigin="anonymous"
                    style="max-height: 100%; max-width: 100%;"
                >
                    <source src="${SERVER_BASE_URL}${this.currentVideoRef}" type="video/mp4" />
                    Your browser does not support the video tag.
                </video>
            `);
            return html`
                <video
                    ${ref(this.playerRef)}
                    width="auto"
                    height="100%"
                    crossorigin="anonymous"
                    style="max-height: 100%; max-width: 100%;"
                    @canplay=${this.handleCanPlay}
                >
                    <source src="${SERVER_BASE_URL}${this.currentVideoRef}" type="video/mp4" />
                    Your browser does not support the video tag.
                </video>
            `;
        },
        args: () => [this.selectedCameraId, this.selectedDate, this.getVideosOfDay.value],
    });

    private playSignalWatcher = new Signal.subtle.Watcher(async () => {
        // Notify callbacks are not allowed to access signals synchronously
        await 0;
        
        if (this.playerRef.value !== undefined) {
            switch (PLAYERSTATE_SIG.get()) {
                case PlayerState.PLAYING:
                    this.playerRef.value?.play();
                    break;
                case PlayerState.PAUSED:
                    this.playerRef.value?.pause();
                    break;
            }
        } else {
            PLAYERSTATE_SIG.set(PlayerState.PAUSED);
        }
        this.playSignalWatcher.watch(PLAYERSTATE_SIG);
    });

    private signalWatcher = new Signal.subtle.Watcher(async () => {
        // Notify callbacks are not allowed to access signals synchronously
        await 0;

        const timestampWithinVideo = this.videoStart <= TIMESTAMP_SIG.get().value && TIMESTAMP_SIG.get().value < this.videoEnd;

        if (
            timestampWithinVideo &&
            this.playerRef.value !== undefined &&
            TIMESTAMP_SIG.get().source !== TimestampSignalSource.PLAYER_COMPONENT
        ) {
            this.playerRef.value.pause();
            this.playerRef.value.currentTime = TIMESTAMP_SIG.get().value - this.videoStart;
        }

        // Watchers have to be re-enabled after they run:
        this.signalWatcher.watch(TIMESTAMP_SIG);

        if (!timestampWithinVideo) {
            this.buildVideoPlayer.run([this.selectedCameraId, this.selectedDate, this.getVideosOfDay.value]);
        }
    });

    private requestUpdateRef: Optional<number> = None;

    // Styling
    static styles = css`
        :host {
            display: flex;
            width: 100%;
            flex: 1;
            overflow: hidden;
            flex-direction: column;
        }
    `;

    private handleCanPlay() {
        switch (PLAYERSTATE_SIG.get()) {
            case PlayerState.PLAYING:
                this.playerRef.value?.play();
                break;
        }
    }

    public disconnectedCallback(): void {
        this.signalWatcher.unwatch(TIMESTAMP_SIG);
        if (this.requestUpdateRef.some) {
            window.clearInterval(this.requestUpdateRef.safeValue());
            this.requestUpdateRef = None;
        }
        super.disconnectedCallback();
    }

    public requestAnimationFrame() {
        if (this.requestUpdateRef.some) {
            return;
        }

        this.requestUpdateRef = Some(
            window.setInterval(() => {
                if (this.playerRef.value === undefined) {
                    return;
                }

                const playerTime = this.playerRef.value.currentTime;
                const currentTime = this.videoStart + playerTime;

                if (currentTime !== TIMESTAMP_SIG.get().value) {
                    TIMESTAMP_SIG.set({
                        value: currentTime,
                        source: TimestampSignalSource.PLAYER_COMPONENT
                    });
                }
            }, 150)
        );
    }

    public updated(changedProperties: PropertyValues): void {
        console.log("PlayerComponent updated", changedProperties);
        this.signalWatcher.watch(TIMESTAMP_SIG);
        this.playSignalWatcher.watch(PLAYERSTATE_SIG);

        if (this.requestUpdateRef.none) {
            this.requestAnimationFrame();
        }

        if (this.oldVideoRef !== this.currentVideoRef && this.playerRef.value !== undefined) {
            this.oldVideoRef = this.currentVideoRef;
            this.playerRef.value.load();
            this.playerRef.value.currentTime = TIMESTAMP_SIG.get().value - this.videoStart;
        }
        super.updated(changedProperties);
    }

    public render() {
        return html`
            ${cache(
                this.buildVideoPlayer.render({
                    initial: () => {
                        return this.lastVideoTemplate.some
                            ? this.lastVideoTemplate.safeValue()
                            : html`<h1>Loading...</h1>`;
                    },
                    pending: () => () => {
                        return this.lastVideoTemplate.some
                            ? this.lastVideoTemplate.safeValue()
                            : html`<h1>Finding video file</h1>`;
                    },
                    complete: (value) => value,
                    error: (error) => {
                        console.error(error);
                        return html`<p>Oops, something went wrong: ${error}</p>`;
                    }
                })
            )}
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "player-component": PlayerComponent;
    }
}
