import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { DateTime, Settings } from "luxon";
import { Task } from "@lit/task";
import { TimeRanges } from "./timeline-component";
import { CamData } from "./cam-data";
import { TIMESTAMP_SIG, TimestampSignalSource } from "./signals";
import { IdentifyServerBaseUrl } from "./constants";
import { CAM_DB, PushCamDataToDatabase, Video } from "./cam-videos";
import { WrapPromise } from "./common/wrap_promise";

export * from "./player-component";
export * from "./timeline-component";
export * from "./player-buttons";

// Set the default timezone
Settings.defaultZone = "America/Denver";

@customElement("dvr-ui")
export class DvrUI extends LitElement {
    @state()
    selectedDate: string = DateTime.now().toFormat("yyyy-MM-dd");

    @state()
    selectedCameraId: string = ""; // 'all' or a specific camera ID

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
            const camData = (await response.json()) as unknown as {
                success: boolean;
                message: CamData;
            };

            if (!camData.success) {
                throw camData.message;
            }

            const result = await PushCamDataToDatabase(camData.message);
            if (result.err) {
                throw result.val;
            }

            const camNames: string[] = [];
            CAM_DB.videoFiles.orderBy("camName").eachUniqueKey((camName) => {
                camNames.push(camName.valueOf() as string);
            });
            if (this.selectedCameraId === "" && camNames.length > 0) {
                this.selectedCameraId = camNames[0];
            }

            return CAM_DB.videoFiles;
        },
        args: () => []
    });

    private buildControlsTask = new Task(this, {
        task: async ([selectedCameraId, videoDbPromise], {}) => {
            const videoDb = await videoDbPromise.taskComplete;
            console.log("starting to build controls");

            const allVideos = await WrapPromise(
                videoDb.where("camName").equals(selectedCameraId).sortBy("vidStartEpoch"),
                "Failed to get all videos"
            );
            if (allVideos.err) {
                throw allVideos.val;
            }

            let isDisabled = false;
            if (allVideos.safeUnwrap().length === 0) {
                isDisabled = true;
            }

            const minDate = DateTime.fromSeconds(
                allVideos.safeUnwrap().at(0)?.vidStartEpoch ?? 0
            ).toISODate();
            const maxDate = DateTime.fromSeconds(
                allVideos.safeUnwrap().at(allVideos.safeUnwrap().length - 1)?.vidEndEpoch ?? 0
            ).toISODate();
            return html`
                <input
                    type="date"
                    id="date"
                    value="${this.selectedDate}"
                    @change="${this.handleDateChange}"
                    min="${minDate}"
                    max="${maxDate}"
                    ?disabled=${isDisabled}
                />
            `;
        },
        args: () => [this.selectedCameraId, this._initialFetch]
    });

    private buildCamNameTask = new Task(this, {
        task: async ([videoDbPromise], {}) => {
            await videoDbPromise.taskComplete;

            const camNames: string[] = [];
            const getCamNames = await WrapPromise(
                CAM_DB.videoFiles.orderBy("camName").eachUniqueKey((camName) => {
                    camNames.push(camName.valueOf() as string);
                }),
                "Failed to get each unique key"
            );
            if (getCamNames.err) {
                throw getCamNames.err;
            }

            if (this.selectedCameraId === "" && camNames.length > 0) {
                this.selectedCameraId = camNames[0];
            }
            let isDisabled = false;
            if (camNames.length === 0) {
                isDisabled = true;
            }

            return html`
                <select id="camera" @change="${this.handleCameraChange}" ?disabled=${isDisabled}>
                    ${camNames.map(
                        (camera) =>
                            html`<option
                                value="${camera}"
                                ?selected=${camera === this.selectedCameraId}
                            >
                                ${camera}
                            </option>`
                    )}
                </select>
            `;
        },
        args: () => [this._initialFetch]
    });

    private buildTimelineTask = new Task(this, {
        task: async ([selectedCameraId, selectedDate, videoDbPromise], {}) => {
            console.log("running timeline task");
            const videoDb = await videoDbPromise.taskComplete;
            const parsedSelectedDate = DateTime.fromFormat(selectedDate, "yyyy-MM-dd");
            if (!parsedSelectedDate.isValid) {
                throw new Error(`Failed to parse date in timeline task ${selectedDate}`);
            }

            const allVideos = await WrapPromise(
                videoDb.where("camName").equals(selectedCameraId).sortBy("vidStartEpoch"),
                "Failed to get each unique key"
            );
            if (allVideos.err) {
                throw allVideos.val;
            }

            const timeRanges: TimeRanges[] = [];
            let currentTimeRange: TimeRanges | undefined;
            const createNewTimeRange = (date: Video): TimeRanges => {
                return {
                    start: DateTime.fromSeconds(date.vidStartEpoch),
                    end: DateTime.fromSeconds(date.vidEndEpoch)
                };
            };
            // Checks if the current TIMESTAMP_SIG is within the range of this video.
            const checkTimestampInRange = (range: TimeRanges) => {
                const rangeStartSeconds = range.start.toSeconds() - parsedSelectedDate.toSeconds();
                const rangeEndSeconds = range.end.toSeconds() - parsedSelectedDate.toSeconds();
                return (
                    rangeStartSeconds <= TIMESTAMP_SIG.get().value &&
                    TIMESTAMP_SIG.get().value <= rangeEndSeconds
                );
            };
            // If the current TIMESTAMP_SIG is within a valid range, if not reset to first range.
            let timestampIsValid = false;
            for (const video of allVideos.val) {
                const parsedCurrentRange = createNewTimeRange(video);
                if (currentTimeRange === undefined) {
                    currentTimeRange = parsedCurrentRange;
                } else if (currentTimeRange.end.equals(parsedCurrentRange.start)) {
                    currentTimeRange.end = parsedCurrentRange.end;
                } else {
                    timeRanges.push(currentTimeRange);
                    timestampIsValid = timestampIsValid || checkTimestampInRange(currentTimeRange);
                    currentTimeRange = parsedCurrentRange;
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
            TIMESTAMP_SIG.set({
                value: ts,
                source: TimestampSignalSource.DVR_UI_TIMELINE_COMPONENT
            });

            return html`
                <timeline-component
                    .selectedDate="${selectedDate}"
                    .availableTimeRanges="${timeRanges}"
                ></timeline-component>
            `;
        },
        args: () => [this.selectedCameraId, this.selectedDate, this._initialFetch]
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
    }

    // Handle camera change
    private handleCameraChange(event: InputEvent) {
        this.selectedCameraId = (event.target as HTMLInputElement | null)?.value ?? "";
        this.requestUpdate();
    }

    private renderCameraControls() {
        return html`
            <label for="date">Date:</label>

            ${this.buildControlsTask.render({
                initial: () =>
                    html`<input
                        type="date"
                        id="date"
                        @change="${this.handleDateChange}"
                        disabled
                    />`,
                pending: () =>
                    html`<input
                        type="date"
                        id="date"
                        @change="${this.handleDateChange}"
                        disabled
                    />`,
                complete: (value) => value,
                error: (error) => {
                    console.error(error);
                    return html`<p>Oops, something went wrong: ${error}</p>`;
                }
            })}

            <label for="camera">Camera:</label>
            ${this.buildCamNameTask.render({
                initial: () =>
                    html`<select id="camera" @change="${this.handleCameraChange}" disabled>
                        <select></select>
                    </select>`,
                pending: () =>
                    html`<select id="camera" @change="${this.handleCameraChange}" disabled>
                        <select></select>
                    </select>`,
                complete: (value) => value,
                error: (error) => {
                    console.error(error);
                    return html`<p>Oops, something went wrong: ${error}</p>`;
                }
            })}
        `;
    }

    private renderTimeline() {
        return html`
            ${this.buildTimelineTask.render({
                initial: () =>
                    html`<timeline-component
                        .selectedDate="${this.selectedDate}"
                        .availableTimeRanges="${[]}"
                    ></timeline-component>`,
                pending: () =>
                    html`<timeline-component
                        .selectedDate="${this.selectedDate}"
                        .availableTimeRanges="${[]}"
                    ></timeline-component>`,
                complete: (value) => value,
                error: (error) => {
                    console.error(error);
                    return html`<p>Oops, something went wrong: ${error}</p>`;
                }
            })}
        `;
    }

    // Render
    render() {
        return html`
            <div class="container">
                ${this._initialFetch.render({
                    initial: () => html`<p>Waiting to start task</p>`,
                    pending: () => html`<p>Running task...</p>`,
                    complete: () => {
                        return html`
                            <h1>DVR UI</h1>
                            <div class="controls">${this.renderCameraControls()}</div>
                            <player-component
                                .selectedDate="${live(this.selectedDate)}"
                                .selectedCameraId="${live(this.selectedCameraId)}"
                            ></player-component>
                            <player-buttons></player-buttons>
                            ${this.renderTimeline()}
                        `;
                    },
                    error: (error) => {
                        console.error(error);
                        return html`<p>Oops, something went wrong: ${error}</p>`;
                    }
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
