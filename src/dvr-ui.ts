import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { DateTime, DateTimeMaybeValid, Settings } from "luxon";
import { Task, TaskStatus } from "@lit/task";
import { TimeRanges } from "./timeline-component";
import { CamData } from "./cam-data";
import { TIMESTAMP_SIG, TimestampSignalSource } from "./signals";
import { IdentifyServerBaseUrl, SERVER_BASE_URL } from "./constants";

export * from "./player-component";
export * from "./timeline-component";

// Set the default timezone
Settings.defaultZone = "America/Denver";
function parseFromIso(dateTimeString: string): DateTimeMaybeValid {
    return DateTime.fromISO(dateTimeString);
}

@customElement("dvr-ui")
export class DvrUI extends LitElement {
    @state()
    selectedDate: string = DateTime.now().toFormat("yyyy-MM-dd");

    @state()
    selectedCameraId: string = "all"; // 'all' or a specific camera ID

    @state()
    currentTime: string = DateTime.now().toFormat("HH:mm");

    @state()
    isTimelineDragging: boolean = false;

    @state()
    timelineDragStartTime: number = 0;

    @state()
    timelineDragCurrentTime: number = 0;

    private _initialFetch = new Task(this, {
        task: async ([], { signal }) => {
            const serverUrl = await IdentifyServerBaseUrl();
            if (serverUrl.err) {
                throw serverUrl.err;
            }

            const response = await fetch(`${serverUrl.val}/cams`, { signal });
            if (!response.ok) {
                throw new Error(`[${response.status}]: ${response.statusText}`);
            }
            return response.json() as unknown as { success: boolean; message: CamData };
        },
        args: () => []
    });

    // Styling
    static styles = css`
        :host {
            display: block;
            width: 100vw;
            height: 100vh;
            font-family: sans-serif;
        }
        .container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            width: 100vw;
        }
        .player {
            display: flex;
            width: 100%;
            flex: 1;
            overflow: hidden;
        }
        .controls {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            margin-bottom: 16px;
            align-items: center; /* Vertically align items */
        }

        .controls select,
        .controls input {
            padding: 8px;
            border-radius: 4px;
            border: 1px solid #ddd;
            font-size: 1em;
        }
        .controls button {
            padding: 8px 16px;
            border-radius: 4px;
            background-color: #007bff;
            color: white;
            border: none;
            cursor: pointer;
            font-size: 1em;
        }

        .no-recordings-message {
            text-align: center;
            color: #666;
            margin-top: 16px;
        }
    `;

    // Handle date change
    private handleDateChange(event: InputEvent) {
        this.selectedDate = (event.target as HTMLInputElement | null)?.value ?? this.selectedDate;
        TIMESTAMP_SIG.set({ value: 0, source: TimestampSignalSource.USER });
        // console.log("date change", event.target);
    }

    // Handle camera change
    private handleCameraChange(event: InputEvent) {
        this.selectedCameraId =
            (event.target as HTMLInputElement | null)?.value ?? this.selectedCameraId;
        // console.log("handleCameraChange", event);
    }

    private renderCameraData(data: CamData) {
        const camNames = Object.keys(data);
        console.log("camNames", camNames, data);

        // Get all day starts. We will need both start and ends for the case we are in different time zones.
        const timeStrings = new Set<string>();
        for (const cam of camNames) {
            const timeData = data[cam];
            console.log("timeData", timeData);
            if (timeData) {
                for (const video of Object.entries(timeData.dates)) {
                    timeStrings.add(video[0]);
                }
            }
        }

        // The corrected day times in our time zone.
        const dayTimes = new Set<string>();
        for (const timeStr of timeStrings) {
            const date = parseFromIso(timeStr);
            if (!date.isValid) {
                continue;
            }

            const dayStr = date.startOf("day").toISODate();
            dayTimes.add(dayStr);
        }

        const minDate =
            DateTime.min(
                ...[...dayTimes.values()]
                    .map((dateStr) => parseFromIso(dateStr))
                    .filter((date) => date.isValid)
            ) ?? DateTime.now().startOf("day");
        const maxDate =
            DateTime.max(
                ...[...dayTimes.values()]
                    .map((dateStr) => parseFromIso(dateStr))
                    .filter((date) => date.isValid)
            ) ?? DateTime.now().startOf("day");

        if (camNames.length > 0) {
            this.selectedCameraId = camNames[0];
        }
        return html`<label for="date">Date:</label>
            <input
                type="date"
                id="date"
                value="${this.selectedDate}"
                @change="${this.handleDateChange}"
                min="${minDate.toISODate()}"
                max="${maxDate.toISODate()}"
            />

            <label for="camera">Camera:</label>
            <select id="camera" @change="${this.handleCameraChange}">
                ${camNames.map(
                    (camera) =>
                        html`<option
                            value="${camera}"
                            selected="${camera === this.selectedCameraId}"
                        >
                            ${camera}
                        </option>`
                )}
            </select>`;
    }

    private renderTimeline(data: CamData) {
        const camera = data[this.selectedCameraId];
        if (camera === undefined) {
            return html`NO SELECTED CAMERA`;
        }

        const parsedSelectedDate = parseFromIso(this.selectedDate);
        if (!parsedSelectedDate.isValid) {
            return html`Invalid selected date.`;
        }

        const timeData = camera.dates[this.selectedDate];
        if (timeData === undefined) {
            return html`No data for selected date`;
        }

        const videoTimes: DateTime<true>[] = [];
        for (const time of timeData.videos) {
            for (const day of time.videos) {
                console.log("video", day.timeOfVideoStart);
                const parsedDate = parseFromIso(day.timeOfVideoStart);
                if (parsedDate.isValid) {
                    videoTimes.push(parsedDate);
                }
            }
        }

        videoTimes.sort((a, b) => a.toSeconds() - b.toSeconds());

        const timeRanges: TimeRanges[] = [];
        let currentTimeRange: TimeRanges | undefined;
        const createNewTimeRange = (date: DateTime<true>) => {
            currentTimeRange = {
                start: date,
                end: date.plus({ minute: 1 })
            };
        };
        // Checks if the current TIMESTAMP_SIG is within the range of this video.
        const checkTimestampInRange = (range: TimeRanges) => {
            const rangeStartSeconds = range.start.toSeconds() - parsedSelectedDate.toSeconds();
            const rangeEndSeconds = range.end.toSeconds() - parsedSelectedDate.toSeconds();
            return (
                rangeStartSeconds <= TIMESTAMP_SIG.get().value && TIMESTAMP_SIG.get().value <= rangeEndSeconds
            );
        };
        // If the current TIMESTAMP_SIG is within a valid range, if not reset to first range.
        let timestampIsValid = false;
        for (const time of videoTimes) {
            if (currentTimeRange === undefined) {
                createNewTimeRange(time);
            } else if (currentTimeRange.end.equals(time)) {
                currentTimeRange.end = time.plus({ minute: 1 });
            } else {
                timeRanges.push(currentTimeRange);
                timestampIsValid = !timestampIsValid
                    ? checkTimestampInRange(currentTimeRange)
                    : timestampIsValid;
                createNewTimeRange(time);
            }
        }
        if (currentTimeRange !== undefined) {
            timeRanges.push(currentTimeRange);
            timestampIsValid = !timestampIsValid
                ? checkTimestampInRange(currentTimeRange)
                : timestampIsValid;
        }

        // If timestampIsValid is not valid use the first range's start.
        const ts =
            timeRanges.length > 0
                ? timeRanges[0].start.toSeconds() - parsedSelectedDate.toSeconds()
                : 0;
        TIMESTAMP_SIG.set({ value: ts, source: TimestampSignalSource.DVR_UI_TIMELINE_COMPONENT });

        return html`<timeline-component
            .selectedDate="${this.selectedDate}"
            .availableTimeRanges="${timeRanges}"
        ></timeline-component>`;
    }

    // Render
    render() {
        return html`
            <div class="container">
                ${this._initialFetch.render({
                    initial: () => html`<p>Waiting to start task</p>`,
                    pending: () => html`<p>Running task...</p>`,
                    complete: (value) => html`
                        <h1>DVR UI</h1>
                        <div class="controls">${this.renderCameraData(value.message)}</div>
                        <player-component
                            .selectedDate="${this.selectedDate}"
                            .selectedCameraId="${this.selectedCameraId}"
                            .data="${value.message}"
                        ></player-component>
                        ${this.renderTimeline(value.message)}
                    `,
                    error: (error) => html`<p>Oops, something went wrong: ${error}</p>`
                })}
            </div>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "dvr-ui": DvrUI;
    }
}
