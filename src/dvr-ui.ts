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
import { map } from "lit/directives/map.js";

export * from "./player-component";
export * from "./timeline-component";
export * from "./player-buttons";

// Set the default timezone
Settings.defaultZone = "America/Denver";

enum ViewLayout {
    SingleView = 0,
    DoubleView,
    QuadView
}

@customElement("dvr-ui")
export class DvrUI extends LitElement {
    @state()
    selectedDate: string = DateTime.now().toFormat("yyyy-MM-dd");

    @state()
    selectedCamIds: readonly string[] = []; // 'all' or a specific camera ID

    @state()
    viewLayout: ViewLayout = ViewLayout.SingleView;

    // The camera names a user can select.
    @state()
    availableCamNames: string[] = [];

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
            await CAM_DB.videoFiles.orderBy("camName").eachUniqueKey((camName) => {
                camNames.push(camName.valueOf() as string);
            });
            this.availableCamNames = camNames;
            switch (this.viewLayout) {
                case ViewLayout.SingleView:
                    this.selectedCamIds = [""];
                    break;
                case ViewLayout.DoubleView:
                    this.selectedCamIds = ["", ""];
                    break;
                case ViewLayout.QuadView:
                    this.selectedCamIds = ["", "", "", ""];
                    break;
            }

            return CAM_DB.videoFiles;
        },
        args: () => []
    });

    private buildControlsTask = new Task(this, {
        task: async ([selectedCamIds, videoDbPromise], {}) => {
            const videoDb = await videoDbPromise.taskComplete;
            console.log("starting to build controls");

            const allVideos = await WrapPromise(
                videoDb.where("camName").anyOf(selectedCamIds).sortBy("vidStartEpoch"),
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
        args: () => [this.selectedCamIds, this._initialFetch]
    });

    private buildTimelineTask = new Task(this, {
        task: async ([selectedCamIds, selectedDate, videoDbPromise], {}) => {
            console.log("running timeline task", selectedCamIds, selectedDate);
            const videoDb = await videoDbPromise.taskComplete;
            const parsedSelectedDate = DateTime.fromFormat(selectedDate, "yyyy-MM-dd");
            if (!parsedSelectedDate.isValid) {
                throw new Error(`Failed to parse date in timeline task ${selectedDate}`);
            }

            const allVideos = await WrapPromise(
                videoDb.where("camName").anyOf(selectedCamIds).sortBy("vidStartEpoch"),
                "Failed to get each unique key"
            );
            if (allVideos.err) {
                throw allVideos.val;
            }

            const rangeSet = new Set<string>();
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
            const rangesIntersect = (range1: TimeRanges, range2: TimeRanges) => {
                return (
                    range1.end.toSeconds() >= range2.start.toSeconds() &&
                    range1.start.toSeconds() <= range2.end.toSeconds()
                );
            };
            const getLatestEnd = (range1: TimeRanges, range2: TimeRanges) => {
                return range1.end.toSeconds() > range2.end.toSeconds() ? range1.end : range2.end;
            };
            // If the current TIMESTAMP_SIG is within a valid range, if not reset to first range.
            let timestampIsValid = false;
            for (const video of allVideos.val) {
                const rangeKey = `${video.vidStartEpoch}-${video.vidEndEpoch}`;
                if (rangeSet.has(rangeKey)) {
                    continue;
                }
                rangeSet.add(rangeKey);

                const parsedCurrentRange = createNewTimeRange(video);
                if (currentTimeRange === undefined) {
                    currentTimeRange = parsedCurrentRange;
                } else if (rangesIntersect(currentTimeRange, parsedCurrentRange)) {
                    currentTimeRange.end = getLatestEnd(currentTimeRange, parsedCurrentRange);
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
        args: () => [this.selectedCamIds, this.selectedDate, this._initialFetch]
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

        .double-view {
            display: flex;
            flex-direction: row;
            height: 100%;
            width: 100%;
        }

        .quad-view {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
        }

        .quad-row {
            display: flex;
            flex-direction: row;
            height: 100%;
        }
    `;

    // Handle date change
    private handleDateChange(event: InputEvent) {
        this.selectedDate = (event.target as HTMLInputElement | null)?.value ?? this.selectedDate;
        TIMESTAMP_SIG.set({ value: 0, source: TimestampSignalSource.USER });
    }

    // Handle camera change
    private handleCameraChange(event: InputEvent, index: number) {
        if (this.selectedCamIds.length <= index || index < 0) {
            return;
        }
        const copyOfCams = [...this.selectedCamIds];
        copyOfCams[index] = (event.target as HTMLInputElement | null)?.value ?? "";
        this.selectedCamIds = copyOfCams;
        this.requestUpdate();
    }

    private handleViewChange(event: InputEvent) {
        const viewValue = (event.target as HTMLInputElement | null)?.value ?? "";
        this.viewLayout = ViewLayout[viewValue as any] as unknown as ViewLayout;
        console.log(viewValue, this.viewLayout);

        switch (this.viewLayout) {
            case ViewLayout.SingleView:
                this.selectedCamIds = [""];
                break;
            case ViewLayout.DoubleView:
                this.selectedCamIds = ["", ""];
                break;
            case ViewLayout.QuadView:
                this.selectedCamIds = ["", "", "", ""];
                break;
        }
    }

    private renderCameraControls() {
        console.log("this.availableCamNames", JSON.stringify(this.availableCamNames));
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

            <label for="view-layout">View Type:</lable>
            <select
                id="view-layout"
                @change="${this.handleViewChange}"
            >
                <option value="${ViewLayout[ViewLayout.SingleView]}" ?selected=${this.viewLayout === ViewLayout.SingleView}>Single View</option>
                <option value="${ViewLayout[ViewLayout.DoubleView]}" ?selected=${this.viewLayout === ViewLayout.DoubleView}>Double View</option>
                <option value="${ViewLayout[ViewLayout.QuadView]}" ?selected=${this.viewLayout === ViewLayout.QuadView}>Quad View</option>
            </select>

            ${map(
                this.selectedCamIds,
                (cameraId, index) => html`
                    <label for="camera-${index}">Camera ${index + 1}:</label>
                    <select
                        id="camera-${index}"
                        @change="${(e: InputEvent) => this.handleCameraChange(e, index)}"
                    >
                        <option value="N/A" ?selected=${cameraId === ""}>No Camera Selected</option>
                        ${map(
                            this.availableCamNames,
                            (camName) =>
                                html`<option value="${camName}" ?selected=${camName === cameraId}>
                                    ${camName}
                                </option>`
                        )}
                    </select>
                `
            )}
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

    private renderPlayers() {
        switch (this.viewLayout) {
            case ViewLayout.SingleView:
                return html`
                    <player-component
                        .selectedDate="${live(this.selectedDate)}"
                        .selectedCameraId="${live(this.selectedCamIds[0])}"
                    ></player-component>
                `;
            case ViewLayout.DoubleView:
                return html`
                    <div class="double-view">
                        <player-component
                            .selectedDate="${live(this.selectedDate)}"
                            .selectedCameraId="${live(this.selectedCamIds[0])}"
                        ></player-component>
                        <player-component
                            .selectedDate="${live(this.selectedDate)}"
                            .selectedCameraId="${live(this.selectedCamIds[1])}"
                        ></player-component>
                    </div>
                `;
            case ViewLayout.QuadView:
                return html`
                    <div class="quad-view">
                        <div class="quad-row">
                            <player-component
                                .selectedDate="${live(this.selectedDate)}"
                                .selectedCameraId="${live(this.selectedCamIds[0])}"
                            ></player-component>
                            <player-component
                                .selectedDate="${live(this.selectedDate)}"
                                .selectedCameraId="${live(this.selectedCamIds[1])}"
                            ></player-component>
                        </div>
                        <div class="quad-row">
                            <player-component
                                .selectedDate="${live(this.selectedDate)}"
                                .selectedCameraId="${live(this.selectedCamIds[2])}"
                            ></player-component>
                            <player-component
                                .selectedDate="${live(this.selectedDate)}"
                                .selectedCameraId="${live(this.selectedCamIds[3])}"
                            ></player-component>
                        </div>
                    </div>
                `;
        }
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
                            ${this.renderPlayers()}
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
