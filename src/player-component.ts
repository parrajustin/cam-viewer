import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { DateTime, DateTimeMaybeValid, Settings } from "luxon";
import { SignalWatcher } from "@lit-labs/signals";
import { CamData } from "./cam-data";
import { TIMESTAMP_SIG } from "./signals";
import { SERVER_BASE_URL } from "./constants";

// Set the default timezone
Settings.defaultZone = "America/Denver";
function parseFromIso(dateTimeString: string): DateTimeMaybeValid {
    return DateTime.fromISO(dateTimeString);
}

@customElement("player-component")
export class PlayerComponent extends SignalWatcher(LitElement) {
    @property({ type: String })
    selectedDate: string = DateTime.now().toFormat("yyyy-MM-dd");

    @property({ type: String })
    selectedCameraId: string = "all"; // 'all' or a specific camera ID

    @property({ type: Object })
    data: CamData = {};

    // Styling
    static styles = css`
        :host {
            display: flex;
            width: 100%;
            flex: 1;
            overflow: hidden;
        }
    `;

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
        const playerDateOjb = dateObj.plus({ seconds: TIMESTAMP_SIG.get() });
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
            if (
                playerSeconds < hourStartSeconds ||
                hourEndSeconds <= playerSeconds
            ) {
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

                if (
                    videoStartSeconds <= playerSeconds &&
                    playerSeconds < videoEndSeconds
                ) {
                    console.log('setting path to ', video.path, video.timeOfVideoStart)
                    return html`
                        <video
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
