import { LitElement, html, css, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ref, createRef } from "lit/directives/ref.js";
import { DateTime, DateTimeMaybeValid, Settings } from "luxon";
import { SignalWatcher } from "@lit-labs/signals";
import { TIMESTAMP_SIG, TimestampSignalSource } from "./signals";

interface Marker {
    time: string; // ISO 8601
    label?: string;
    color?: string;
}

export interface TimeRanges {
    start: DateTime<true>; // in seconds
    end: DateTime<true>; // in seconds
}

const SECONDS_IN_DAY = 24 * 60 * 60;

// Set the default timezone
Settings.defaultZone = "America/Denver";
function parseFromIso(dateTimeString: string): DateTimeMaybeValid {
    return DateTime.fromISO(dateTimeString);
}

@customElement("timeline-component")
export class TimelineComponent extends SignalWatcher(LitElement) {
    @property({ type: String })
    public currentTime: string = DateTime.now().toISO();

    @property({ type: Array })
    public markers: Marker[] = [];

    @property({ type: String })
    public selectedDate: string = DateTime.now().toFormat("yyyy-MM-dd");

    @property({ type: Array })
    public availableTimeRanges: TimeRanges[] = [];

    // --- State ---
    @state()
    private leftOffset = 0; // in pixels

    @state()
    private isDragging = false;

    @state()
    private timelineWidth = 2400; // Default: 24 hours * 100px/hour

    // --- Refs ---
    private timelineRef = createRef<HTMLDivElement>();
    private timelineContainerRef = createRef<HTMLDivElement>();

    // --- Constants ---
    private readonly baseZoomLevel = 100; // Pixels per hour at zoom level 1
    // Min zoom level is the entire width takes up the full width of the screen.
    private readonly minZoomLevel = document.documentElement.clientWidth / 24 / this.baseZoomLevel;
    private readonly maxZoomLevel = document.documentElement.clientWidth / (this.baseZoomLevel / 6);

    // --- Properties ---
    @state()
    public zoomLevel = this.minZoomLevel; // 1 = 100px/hour, 2 = 200px/hour, etc.

    // --- Lifecycle ---
    connectedCallback() {
        super.connectedCallback();
        this.addKeyboardListeners();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.removeKeyboardListeners();
    }

    // --- Event Listeners ---
    private handleMouseDown(event: MouseEvent) {
        const timelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;
        const actualOffset = event.clientX + this.leftOffset;
        const percentage = Math.min(1.0, Math.max(0.0, actualOffset / timelineWidth));
        const totalSecondsInDay = 24 * 60 * 60;
        const tempPlayerTime = totalSecondsInDay * percentage;
        if (Number.isNaN(tempPlayerTime)) {
            TIMESTAMP_SIG.set({ value: 0.0, source: TimestampSignalSource.USER });
        } else {
            TIMESTAMP_SIG.set({ value: tempPlayerTime, source: TimestampSignalSource.USER });
        }
        // console.log(this.dragStartX, this.leftOffset);
    }

    // private handleZoom(newZoomLevel: number) {
    //     console.log(this.minZoomLevel, newZoomLevel, this.zoomLevel, this.maxZoomLevel);
    //     const originalTimelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;
    //     const playerTimeInPercentage = this.playerTime / (24 * 60 * 60);
    //     // pixels from the left of the screen the current time marker is at.
    //     const offsetFromLeftScreen =
    //         originalTimelineWidth * playerTimeInPercentage - this.offsetLeft;

    //     const originalZoomLevel = this.zoomLevel;
    //     const clampedNewZoomLevel = Math.max(
    //         this.minZoomLevel,
    //         Math.min(this.maxZoomLevel, newZoomLevel)
    //     );
    //     if (originalZoomLevel === clampedNewZoomLevel) {
    //         return;
    //     }
    //     console.log("new zoom", clampedNewZoomLevel);
    //     this.zoomLevel = clampedNewZoomLevel;

    //     this.timelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;
    //     const newTotalLeftOffset = this.timelineWidth * playerTimeInPercentage;
    //     this.leftOffset = Math.max(newTotalLeftOffset - offsetFromLeftScreen, 0.0);
    // }

    private handleZoom(newZoomLevel: number) {
        // Get container width for clamping scroll offset later
        const containerWidth = this.timelineContainerRef.value?.clientWidth ?? 0;
        if (containerWidth === 0) {
            console.warn("Timeline container has no width.");
            return; // Cannot calculate zoom correctly without container width
        }

        // --- Store original values ---
        const originalZoomLevel = this.zoomLevel;
        const originalTimelineWidth = 24 * this.baseZoomLevel * originalZoomLevel;

        // --- Clamp the new zoom level ---
        const clampedNewZoomLevel = Math.max(
            this.minZoomLevel,
            Math.min(this.maxZoomLevel, newZoomLevel)
        );

        // --- Exit if zoom level didn't actually change ---
        if (originalZoomLevel === clampedNewZoomLevel) {
            return;
        }

        // --- Calculate positions based on playerTime ---
        const playerTimeInPercentage = TIMESTAMP_SIG.get().value / SECONDS_IN_DAY;

        // Position of the playerTime marker relative to the start of the timeline element (before zoom)
        const absolutePosBefore = originalTimelineWidth * playerTimeInPercentage;

        // Visual position of the playerTime marker relative to the left edge of the *container* (before zoom)
        const visualPosInContainer = absolutePosBefore - this.leftOffset;

        // --- Update state with new zoom level ---
        this.zoomLevel = clampedNewZoomLevel;
        this.timelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;

        // --- Calculate new absolute position and required offset ---
        // Position of the playerTime marker relative to the start of the timeline element (after zoom)
        const absolutePosAfter = this.timelineWidth * playerTimeInPercentage;

        // Calculate the new leftOffset needed to keep the visual position constant
        let newLeftOffset = absolutePosAfter - visualPosInContainer;

        // --- Clamp the new offset ---
        // Ensure the offset doesn't go below 0
        newLeftOffset = Math.max(0, newLeftOffset);
        // Ensure the offset doesn't go beyond the maximum possible scroll
        const maxOffset = Math.max(0, this.timelineWidth - containerWidth);
        newLeftOffset = Math.min(maxOffset, newLeftOffset);

        // console.log(
        //     `Player Time %: ${playerTimeInPercentage.toFixed(
        //         4
        //     )}, Visual Pos: ${visualPosInContainer.toFixed(
        //         2
        //     )}, Old Width: ${originalTimelineWidth.toFixed(
        //         2
        //     )}, New Width: ${this.timelineWidth.toFixed(
        //         2
        //     )}, Old Offset: ${this.leftOffset.toFixed(
        //         2
        //     )}, New Offset: ${newLeftOffset.toFixed(2)}, Max Offset: ${maxOffset.toFixed(2)}`
        // );

        this.leftOffset = newLeftOffset;

        // No need to call requestUpdate() explicitly if properties are decorated with @state or @property
    }

    private handleWheel(event: WheelEvent) {
        event.preventDefault(); // Prevent page scroll
        const containerRect = this.timelineContainerRef.value?.getBoundingClientRect();
        if (!containerRect) {
            return;
        }

        const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
        this.handleZoom(zoomFactor * this.zoomLevel);
    }

    private handleKeyDown(event: KeyboardEvent) {
        switch (event.key) {
            case "a": // Scroll left
            case "ArrowLeft":
                this.leftOffset -= 50;
                break;
            case "d": // Scroll right
            case "ArrowRight":
                this.leftOffset += 50;
                break;
            case "w": // Zoom in
            case "ArrowUp": {
                const containerRect = this.timelineContainerRef.value?.getBoundingClientRect();
                if (containerRect) {
                    const zoomFactor = 1.1;
                    this.handleZoom(zoomFactor * this.zoomLevel);
                }
                break;
            }
            case "s": // Zoom out
            case "ArrowDown": {
                const containerRect = this.timelineContainerRef.value?.getBoundingClientRect();
                if (containerRect) {
                    const zoomFactor = 0.9;
                    this.handleZoom(zoomFactor * this.zoomLevel);
                }
                break;
            }
        }
    }

    private addKeyboardListeners() {
        window.addEventListener("keydown", this.handleKeyDown.bind(this));
    }

    private removeKeyboardListeners() {
        window.removeEventListener("keydown", this.handleKeyDown.bind(this));
    }

    // --- Helper Functions ---
    private getTimelinePosition(isoTime: string): number {
        const recordingTime = parseFromIso(isoTime);
        const selectedDateTime = parseFromIso(this.selectedDate);
        const diffInMinutes = recordingTime.diff(selectedDateTime, "minutes").minutes;
        return diffInMinutes * ((this.baseZoomLevel * this.zoomLevel) / 60);
    }

    // private updateScrollPositionToTime() {
    //     const currentTimeInMinutes = DateTime.fromISO(
    //         this.selectedDate + "T" + this.currentTime
    //     ).diff(DateTime.fromISO(this.selectedDate), "minutes").minutes;
    //     this.scrollPosition =
    //         currentTimeInMinutes * ((this.baseZoomLevel * this.zoomLevel) / 60) -
    //         this.offsetWidth / 4;
    //     this.scrollPosition = Math.max(0, this.scrollPosition);
    // }

    private createCurrentTimeIndicator() {
        return html` <div
            class="current-time-indicator"
            style="
                            position: absolute;
                            left: ${this.getTimelinePosition(this.currentTime)}px;
                            top: 0;
                            height: 100%;
                            border-left: 2px solid black;
                            pointer-events: none; /* Important: Allows clicks to go through */
                            z-index: 10;
                            width: 4px;
                        "
        >
            <span
                class="current-time-text"
                style="position: absolute; top: 0; left: 5px; color: black; font-size: 0.8em; white-space: nowrap;"
                >${this.currentTime}</span
            >
        </div>`;
    }

    private createPlayerTimeIndicator() {
        const originalTimelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;
        const playerTimeInPercentage = TIMESTAMP_SIG.get().value / (24 * 60 * 60);
        const leftOffset = originalTimelineWidth * playerTimeInPercentage;
        return html` <div
            class="current-time-indicator"
            style="
                            position: absolute;
                            left: ${leftOffset}px;
                            top: 0;
                            height: 100%;
                            border-left: 2px solid black;
                            z-index: 10;
                            width: 4px;
                        "
        >
            <span
                class="current-time-text"
                style="position: absolute; top: 0; left: 5px; color: black; font-size: 0.8em; white-space: nowrap;"
                >${TIMESTAMP_SIG.get().value}</span
            >
        </div>`;
    }

    private createSecondsIndicator(hourIndex: number) {
        return [...Array(60).keys()]
            .filter((x) => x % 10 !== 0)
            .map((v) => {
                const secondPosition = this.getTimelinePosition(
                    this.selectedDate +
                        "T" +
                        `${String(hourIndex).padStart(2, "0")}:${String(v).padStart(2, "0")}`
                );
                return html`
                    <div
                        class="timeline-second"
                        style="
                        position: absolute;
                        left: ${secondPosition}px;
                        top: 0;
                        height: 15%;
                        width: 1px;
                        background-color: #999;
                    "
                    ></div>
                `;
            });
    }

    private createMinuteIndicators(hourIndex: number, hourWidth: number) {
        const showText = this.zoomLevel > 4; // Adjust as needed
        return [...Array(6)].map((_, j) => {
            if (j === 0) return null; // Skip 0th minute mark (already covered by hour)
            const minutePosition = hourIndex * hourWidth + (hourWidth / 6) * j;
            return html`
                <div class="timeline-minute" style="left: ${minutePosition}px;">
                    ${showText
                        ? html`<span class="timeline-minute-text"
                              >${new String(hourIndex).padStart(2, "0")}:${j*10}</span
                          >`
                        : html``}
                </div>
            `;
        });
    }

    private createHourMinuteIndicators() {
        const hourWidth = this.baseZoomLevel * this.zoomLevel;
        const showSeconds = this.zoomLevel > 4; // Adjust as needed
        const availableScreenWidth = document.documentElement.clientWidth;

        const visibleLeftOffsetpx = this.leftOffset;
        const visibleRightOffsetpx = availableScreenWidth + this.leftOffset;

        return [...Array(24)].map((_, i) => {
            const hourLeftOffset = i * hourWidth;
            const hourRightOffset = (i + 1) * hourWidth;
            const hourOverlapsVisibleRange =
                hourLeftOffset < visibleRightOffsetpx && visibleLeftOffsetpx < hourRightOffset;
            return html`<div
                    class="timeline-hour"
                    style="left: ${i * hourWidth}px; width: ${hourWidth}px;"
                >
                    ${i}:00
                </div>
                ${hourOverlapsVisibleRange ? this.createMinuteIndicators(i, hourWidth) : ""}
                ${showSeconds && hourOverlapsVisibleRange ? this.createSecondsIndicator(i) : ""} `;
        });
    }

    private createAvailableTimeRange() {
        const originalTimelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;
        const timelineDay = DateTime.fromFormat(this.selectedDate, "yyyy-MM-dd");

        const ranges: TemplateResult[] = [];
        for (const range of this.availableTimeRanges) {
            const numMinutes = range.end.diff(range.start, "minute").minutes;
            const pixelPerMinute = (this.baseZoomLevel * this.zoomLevel) / 60;
            const widthOfRange = Math.max(1.0, pixelPerMinute * numMinutes);
            const leftTimeInPercentage =
                range.start.diff(timelineDay, "seconds").seconds / SECONDS_IN_DAY;
            const leftOffset =
                originalTimelineWidth * Math.min(1.0, Math.max(0.0, leftTimeInPercentage));
            ranges.push(html`
                <div
                    style="position: absolute; left: ${leftOffset}px; width: ${widthOfRange}px; height: 8%; background-color: green;"
                ></div>
            `);
        }
        return ranges;
    }

    // --- Render ---
    render() {
        // const hourWidth = this.baseZoomLevel * this.zoomLevel;
        // const showSeconds = this.zoomLevel > 4; // Adjust as needed
        return html`
            <div
                class="timeline-container"
                ${ref(this.timelineContainerRef)}
                @mousedown=${this.handleMouseDown}
                @wheel=${this.handleWheel}
                style="overflow: hidden; cursor: pointer; select: none;"
            >
                <div
                    class="timeline"
                    ${ref(this.timelineRef)}
                    style="
                        position: relative;
                        width: ${this.timelineWidth}px;
                        height: 100px;
                        transform: translateX(${-this.leftOffset}px);
                        background-color: #f0f0f0;
                    "
                >
                    ${this.createAvailableTimeRange()} ${this.createHourMinuteIndicators()}
                    ${this.createCurrentTimeIndicator()} ${this.createPlayerTimeIndicator()}
                </div>
            </div>
        `;
    }

    static styles = css`
        :host {
            display: block;
            width: 100%;
            font-family: sans-serif;
        }

        .timeline-container {
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch; /* For smooth scrolling on iOS */
            scroll-behavior: smooth;
        }

        .timeline {
            /* width and height are set dynamically */
            position: relative;
            /* No overflow here, container handles it */
        }

        .timeline-hour {
            position: absolute;
            height: 100%;
            border-right: 1px solid #ccc;
            display: flex;
            align-items: flex-start;
            justify-content: center;
            font-size: 0.9em;
            color: black;
            padding-top: 80px;
        }

        .marker {
            /* position and other styles are set dynamically */
            width: 2px;
            background-color: red;
        }
        .current-time-indicator {
            position: absolute;
            top: 0;
            height: 100%;
            border-left: 2px solid black;
            pointer-events: none; /* Important: Allows clicks to go through */
            z-index: 10;
            width: 4px;
        }

        .current-time-text {
            position: absolute;
            top: 0;
            left: 5px;
            color: black;
            font-size: 0.8em;
            white-space: nowrap;
        }
        .timeline-minute {
            position: absolute;
            top: 0;
            height: 30%;
            width: 1px;
            background-color: #999;
        }
        .timeline-minute-text {
            color: black;
            position: relative;
            top: 30px;
            left: -3px;
        }
        .timeline-second {
            position: absolute;
            top: 0;
            height: 15%;
            width: 1px;
            background-color: #ddd;
        }
    `;
}

declare global {
    interface HTMLElementTagNameMap {
        "timeline-component": TimelineComponent;
    }
}
