import { LitElement, html, css, PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { DateTime, DateTimeMaybeValid, Settings } from "luxon";
import { Signal, SignalWatcher } from "@lit-labs/signals";
import { CamData } from "./cam-data";
import { TIMESTAMP_SIG, TimestampSignalSource } from "./signals";
import { SERVER_BASE_URL } from "./constants";
import { createRef, ref } from "lit/directives/ref.js";
import { None, Optional, Some } from "./common/optional";

// Set the default timezone
Settings.defaultZone = "America/Denver";
function parseFromIso(dateTimeString: string): DateTimeMaybeValid {
    return DateTime.fromISO(dateTimeString);
}

@customElement("player-component")
export class PlayerComponent extends SignalWatcher(LitElement) {
    @property({ type: String })
    public selectedDate: string = DateTime.now().toFormat("yyyy-MM-dd");

    @property({ type: String })
    public selectedCameraId: string = "all"; // 'all' or a specific camera ID

    @property({ type: Object })
    data: CamData = {};

    // The html5 video tag ref.
    private playerRef = createRef<HTMLVideoElement>();

    private oldVideoRef = "";
    private currentVideoRef = "";
    // Video start in seconds.
    private videoStart = 0;

    private signalWatcher = new Signal.subtle.Watcher(async () => {
        // Notify callbacks are not allowed to access signals synchronously
        await 0;

        if (this.playerRef.value !== undefined && TIMESTAMP_SIG.get().source !== TimestampSignalSource.PLAYER_COMPONENT) {
            this.playerRef.value.pause();
            this.playerRef.value.currentTime = TIMESTAMP_SIG.get().value - this.videoStart;
        }
        // Watchers have to be re-enabled after they run:
        this.signalWatcher.watch();
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

    public disconnectedCallback(): void {
        this.signalWatcher.unwatch();
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
                    TIMESTAMP_SIG.set({value: currentTime, source: TimestampSignalSource.PLAYER_COMPONENT});
                }
            }, 150)
        );
    }

    public updated(changedProperties: PropertyValues): void {
        console.log("PlayerComponent updated", changedProperties);
        this.signalWatcher.watch(TIMESTAMP_SIG);

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
        const camera = this.data[this.selectedCameraId];
        if (camera === undefined) {
            return html`NO SELECTED CAMERA`;
        }

        const timeData = camera.dates[this.selectedDate];
        if (timeData === undefined) {
            return html`No data for selected date`;
        }

        // Convert the selected iso date sting to a luxor date object.
        const dateObj = DateTime.fromFormat(this.selectedDate, "yyyy-MM-dd");
        if (!dateObj.isValid) {
            return html`Failed to parse date format ${this.selectedDate}`;
        }
        // The current player time in date object.
        const playerDateOjb = dateObj.plus({ seconds: TIMESTAMP_SIG.get().value });
        // The current player time in seconds from unix epoch.
        const playerSeconds = playerDateOjb.toSeconds();

        for (const hourVideoData of timeData.videos) {
            const hourStart = parseFromIso(hourVideoData.hourOfDayStart);
            if (!hourStart.isValid) {
                throw new Error(
                    `Failed to parse hour timestamp of ${hourVideoData.hourOfDayStart}`
                );
            }
            const hourEnd = hourStart.plus({ hours: 1 });

            const hourStartSeconds = hourStart.toSeconds();
            const hourEndSeconds = hourEnd.toSeconds();

            // Check if the player seconds is within this cam data hour range.
            if (playerSeconds < hourStartSeconds || hourEndSeconds <= playerSeconds) {
                continue;
            }

            // Now check each video if the player seconds is within their time range.
            for (const video of hourVideoData.videos) {
                const videoStart = parseFromIso(video.timeOfVideoStart);
                if (!videoStart.isValid) {
                    throw new Error(
                        `Failed to parse video timestamp of ${hourVideoData.hourOfDayStart}`
                    );
                }
                const videoEnd = videoStart.plus({ minute: 1 });

                const videoStartSeconds = videoStart.toSeconds();
                const videoEndSeconds = videoEnd.toSeconds();

                if (videoStartSeconds <= playerSeconds && playerSeconds < videoEndSeconds) {
                    this.currentVideoRef = video.path;
                    this.videoStart = Math.abs(dateObj.diff(videoStart, "seconds").seconds);
                    console.log("setting path to ", video.path, video.timeOfVideoStart);
                    return html`
                        <video
                            ${ref(this.playerRef)}
                            width="auto"
                            height="100%"
                            controls
                            crossorigin="anonymous"
                            style="max-height: 100%; max-width: 100%;"
                        >
                            <source src="${SERVER_BASE_URL}${video.path}" type="video/mp4" />
                            Your browser does not support the video tag.
                        </video>
                    `;
                }
            }
        }

        return html` No Video file found! `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "player-component": PlayerComponent;
    }
}
