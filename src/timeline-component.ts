import { LitElement, html, css, PropertyValueMap } from "lit";
import { customElement, property, state, eventOptions } from "lit/decorators.js";
import { ref, createRef } from "lit/directives/ref.js";
import { DateTime } from "luxon";

interface Marker {
    time: string; // ISO 8601
    label?: string;
    color?: string;
}

@customElement("timeline-component")
export class TimelineComponent extends LitElement {
    // --- Properties ---
    @property({ type: Number })
    public zoomLevel = 1; // 1 = 100px/hour, 2 = 200px/hour, etc.

    @property({ type: String })
    public currentTime: string = DateTime.now().toISO();

    @property({ type: Array })
    public markers: Marker[] = [];

    @property({ type: String })
    public selectedDate: string = DateTime.now().toFormat("yyyy-MM-dd");

    // --- State ---
    @state()
    private scrollPosition = 0; // in pixels

    @state()
    private isDragging = false;

    @state()
    private dragStartX = 0;

    @state()
    private timelineWidth = 2400; // Default: 24 hours * 100px/hour

    // --- Refs ---
    private timelineRef = createRef<HTMLDivElement>();
    private timelineContainerRef = createRef<HTMLDivElement>();

    // --- Constants ---
    private readonly baseZoomLevel = 100; // Pixels per hour at zoom level 1

    // --- Lifecycle ---
    connectedCallback() {
        super.connectedCallback();
        this.addKeyboardListeners();
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        this.removeKeyboardListeners();
    }

    protected updated(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
        super.updated(changedProperties);

        if (changedProperties.has("zoomLevel")) {
            this.timelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;
            this.updateScrollPositionToTime();
        }
        if (changedProperties.has("selectedDate")) {
            this.updateScrollPositionToTime();
        }
    }

    // --- Event Listeners ---
    private handleMouseDown(event: MouseEvent) {
        this.isDragging = true;
        this.dragStartX = event.clientX;
        this.style.cursor = "grabbing"; // Change cursor
        if (this.timelineContainerRef.value) {
            this.timelineContainerRef.value.style.cursor = "grabbing";
        }
        document.addEventListener("mousemove", this.handleMouseMove);
        document.addEventListener("mouseup", this.handleMouseUp);
    }

    private handleMouseMove(event: MouseEvent) {
        if (!this.isDragging) return;
        const deltaX = event.clientX - this.dragStartX;
        this.scrollPosition -= deltaX;
        this.dragStartX = event.clientX;
        this.requestUpdate(); // Ensure the DOM updates
    }

    private handleMouseUp() {
        this.isDragging = false;
        this.style.cursor = "default"; // Restore cursor
        if (this.timelineContainerRef.value) {
            this.timelineContainerRef.value.style.cursor = "default";
        }
        document.removeEventListener("mousemove", this.handleMouseMove);
        document.removeEventListener("mouseup", this.handleMouseUp);
    }

    private handleWheel(event: WheelEvent) {
        event.preventDefault(); // Prevent page scroll
        const containerRect = this.timelineContainerRef.value?.getBoundingClientRect();

        // Horizontal scrolling with Shift key
        if (event.shiftKey) {
            this.scrollPosition += event.deltaY; // Use deltaY for horizontal scroll
            this.scrollPosition = Math.max(0, this.scrollPosition); // Basic bounds
        }
        // Vertical scrolling for zooming
        else if (containerRect) {
            const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
            const previousZoomLevel = this.zoomLevel;
            this.zoomLevel = Math.max(0.1, Math.min(10, this.zoomLevel * zoomFactor));
            this.timelineWidth = 24 * this.baseZoomLevel * this.zoomLevel;

            // Calculate zoom center relative to the viewport
            const zoomCenter = (event.clientX - containerRect.left) / containerRect.width;
            const currentTimePosition = this.getTimelinePosition(
                this.selectedDate + "T" + this.currentTime
            );

            // Calculate the new scroll position to keep the current time at the zoom center
            this.scrollPosition = currentTimePosition - containerRect.width * zoomCenter;

            this.updateScrollPositionToTime();
            this.requestUpdate();
        }
    }

    private handleKeyDown(event: KeyboardEvent) {
        switch (event.key) {
            case "a": // Scroll left
            case "ArrowLeft":
                this.scrollPosition -= 50;
                break;
            case "d": // Scroll right
            case "ArrowRight":
                this.scrollPosition += 50;
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
                    this.scrollPosition = currentTimePosition - containerRect.width * zoomCenter;
                    this.updateScrollPositionToTime();
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
                    this.scrollPosition = currentTimePosition - containerRect.width * zoomCenter;
                    this.updateScrollPositionToTime();
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
        const recordingTime = DateTime.fromISO(isoTime);
        const selectedDateTime = DateTime.fromISO(this.selectedDate);
        const diffInMinutes = recordingTime.diff(selectedDateTime, "minutes").minutes;
        return diffInMinutes * ((this.baseZoomLevel * this.zoomLevel) / 60);
    }

    private formatTime(date: string) {
        return DateTime.fromISO(date).toFormat("HH:mm");
    }

    private updateScrollPositionToTime() {
        const currentTimeInMinutes = DateTime.fromISO(
            this.selectedDate + "T" + this.currentTime
        ).diff(DateTime.fromISO(this.selectedDate), "minutes").minutes;
        this.scrollPosition =
            currentTimeInMinutes * ((this.baseZoomLevel * this.zoomLevel) / 60) -
            this.offsetWidth / 4;
        this.scrollPosition = Math.max(0, this.scrollPosition);
    }

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
                style="overflow: hidden; cursor: grab;"
            >
                <div
                    class="timeline"
                    ${ref(this.timelineRef)}
                    style="
                        position: relative;
                        width: ${this.timelineWidth}px;
                        height: 100px;
                        transform: translateX(${-this.scrollPosition}px);
                        transition: transform 0.1s ease-out;
                        background-color: #f0f0f0;
                    "
                >
                    ${this.createHourMinuteIndicators()} ${this.createCurrentTimeIndicator()}
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
