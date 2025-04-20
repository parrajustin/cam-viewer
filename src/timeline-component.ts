import { LitElement, html, css, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ref, createRef } from "lit/directives/ref.js";
import { DateTime, DateTimeMaybeValid, Settings } from "luxon";

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
export class TimelineComponent extends LitElement {
    @property({ type: String })
    public currentTime: string = DateTime.now().toISO();

    @property({ type: Number })
    public playerTime: number = 0; // in seconds

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
    @property({ type: Number })
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
        this.playerTime = totalSecondsInDay * percentage;
        if (Number.isNaN(this.playerTime)) {
            this.playerTime = 0.0;
        }
        // console.log(this.dragStartX, this.leftOffset);
    }

    private handleZoom(newZoomLevel: number) {
        console.log(this.minZoomLevel, newZoomLevel, this.zoomLevel, this.maxZoomLevel);
        const originalTimelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;
        const playerTimeInPercentage = this.playerTime / (24 * 60 * 60);
        // pixels from the left of the screen the current time marker is at.
        const offsetFromLeftScreen =
            originalTimelineWidth * playerTimeInPercentage - this.offsetLeft;

        const originalZoomLevel = this.zoomLevel;
        const clampedNewZoomLevel = Math.max(
            this.minZoomLevel,
            Math.min(this.maxZoomLevel, newZoomLevel)
        );
        if (originalZoomLevel === clampedNewZoomLevel) {
            return;
        }
        console.log("new zoom", clampedNewZoomLevel);
        this.zoomLevel = clampedNewZoomLevel;

        this.timelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;
        const newTotalLeftOffset = this.timelineWidth * playerTimeInPercentage;
        this.leftOffset = Math.max(newTotalLeftOffset - offsetFromLeftScreen, 0.0);

        // Calculate the new scroll position to keep the current time at the zoom center
        // this.scrollPosition = currentTimePosition - containerRect.width * zoomCenter;
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
                    const previousZoomLevel = this.zoomLevel;
                    this.zoomLevel = Math.max(0.1, Math.min(10, this.zoomLevel * zoomFactor));
                    this.timelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;

                    const zoomCenter = 0.5;
                    const currentTimePosition = this.getTimelinePosition(
                        this.selectedDate + "T" + this.currentTime
                    );
                    this.leftOffset = currentTimePosition - containerRect.width * zoomCenter;
                    // this.updateScrollPositionToTime();
                }
                break;
            }
            case "s": // Zoom out
            case "ArrowDown": {
                const containerRect = this.timelineContainerRef.value?.getBoundingClientRect();
                if (containerRect) {
                    const zoomFactor = 0.9;
                    const previousZoomLevel = this.zoomLevel;
                    this.zoomLevel = Math.max(0.1, Math.min(10, this.zoomLevel * zoomFactor));
                    this.timelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;
                    const zoomCenter = 0.5;
                    const currentTimePosition = this.getTimelinePosition(
                        this.selectedDate + "T" + this.currentTime
                    );
                    this.leftOffset = currentTimePosition - containerRect.width * zoomCenter;
                    // this.updateScrollPositionToTime();
                }
                break;
            }
        }
        this.timelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;
        this.requestUpdate();
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
        const playerTimeInPercentage = this.playerTime / (24 * 60 * 60);
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
                >${this.playerTime}</span
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
                        background-color: red;
                    "
                    ></div>
                `;
            });
    }

    private createMinuteIndicators(hourIndex: number, hourWidth: number) {
        return [...Array(6)].map((_, j) => {
            if (j === 0) return null; // Skip 0th minute mark (already covered by hour)
            const minutePosition = hourIndex * hourWidth + (hourWidth / 6) * j;
            return html`
                <div
                    class="timeline-minute"
                    style="
            position: absolute;
            left: ${minutePosition}px;
            top: 0;
            height: 30%;
            width: 1px;
            background-color: #999;
        "
                ></div>
            `;
        });
    }

    private createHourMinuteIndicators() {
        const hourWidth = this.baseZoomLevel * this.zoomLevel;
        const showSeconds = this.zoomLevel > 4; // Adjust as needed
        return [...Array(24)].map(
            (_, i) =>
                html`<div
                        class="timeline-hour"
                        style="
            position: absolute;
            left: ${i * hourWidth}px;
            width: ${hourWidth}px;
            height: 100%;
            border-right: 1px solid #ccc;
            display: flex;
            align-items: flex-start;
            justify-content: center;
            font-size: 0.7em;
            color: #666;
            padding-top: 60px;
        "
                    >
                        ${i}:00
                    </div>
                    ${this.createMinuteIndicators(i, hourWidth)}
                    ${showSeconds ? this.createSecondsIndicator(i) : ""} `
        );
    }

    private createAvailableTimeRange() {
        const originalTimelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;
        const timelineDay = DateTime.fromFormat(this.selectedDate, "yyyy-MM-dd");
        console.log("timelineDay", this.selectedDate);

        const ranges: TemplateResult[] = [];
        for (const range of this.availableTimeRanges) {
            const timeInPercentage =
                range.start.diff(range.end, "seconds").seconds / SECONDS_IN_DAY;
            const widthOfRange =
                Math.max(1.0, originalTimelineWidth * Math.min(1.0, Math.max(0.0, timeInPercentage)));
            const leftTimeInPercentage =
                range.start.diff(timelineDay, "seconds").seconds / SECONDS_IN_DAY;
            const leftOffset =
                originalTimelineWidth * Math.min(1.0, Math.max(0.0, leftTimeInPercentage));
            ranges.push(html`
                <div
                    style="position: absolute; left: ${leftOffset}px; width: ${widthOfRange}px; height: 20px; background-color: green;"
                ></div>
            `);
        }
        return ranges;
    }

    // --- Render ---
    render() {
        console.log("this.availableTimeRanges", this.availableTimeRanges, );
        // const hourWidth = this.baseZoomLevel * this.zoomLevel;
        // const showSeconds = this.zoomLevel > 4; // Adjust as needed
        return html`
            <div
                class="timeline-container"
                ${ref(this.timelineContainerRef)}
                @mousedown=${this.handleMouseDown}
                @wheel=${this.handleWheel}
                style="overflow: hidden; cursor: grab;"
            >
                <div
                    class="timeline"
                    ${ref(this.timelineRef)}
                    style="
                        position: relative;
                        width: ${this.timelineWidth}px;
                        height: 100px;
                        transform: translateX(${-this.leftOffset}px);
                        transition: transform 0.1s ease-out;
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
            /* position and other styles are set dynamically */
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
