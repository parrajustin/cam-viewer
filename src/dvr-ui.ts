import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { DateTime } from "luxon";

// Mock Data & Types (Replace with actual data fetching)
interface Camera {
    id: string;
    name: string;
}

interface Recording {
    id: string;
    cameraId: string;
    startTime: string; // ISO 8601
    endTime: string; // ISO 8601
    thumbnail: string; // URL
}

const mockCameras: Camera[] = [
    { id: "camera1", name: "Front Door Camera" },
    { id: "camera2", name: "Backyard Camera" },
    { id: "camera3", name: "Garage Camera" }
];

const generateMockRecordings = (cameras: Camera[], days: number): Recording[] => {
    const recordings: Recording[] = [];
    const now = DateTime.now();

    for (let i = 0; i < days; i++) {
        const date = now.minus({ days: i });
        cameras.forEach((camera) => {
            // Generate a few recordings per camera per day
            const numRecordings = Math.floor(Math.random() * 3) + 1; // 1-3 recordings
            for (let j = 0; j < numRecordings; j++) {
                const startHour = Math.floor(Math.random() * 24);
                const startMinute = Math.floor(Math.random() * 60);
                const duration = Math.floor(Math.random() * 120) + 30; // 30-150 minutes

                const startTime = date
                    .set({ hour: startHour, minute: startMinute, second: 0 })
                    .toISO();
                const endTime = date
                    .set({ hour: startHour, minute: startMinute, second: 0 })
                    .plus({ minutes: duration })
                    .toISO();

                recordings.push({
                    id: `${camera.id}-${date.toFormat("yyyyMMdd")}-${j}`,
                    cameraId: camera.id,
                    startTime,
                    endTime,
                    thumbnail: `https://via.placeholder.com/150?text=${camera.name}+${date.toFormat("HH:mm")}` // Placeholder
                });
            }
        });
    }
    return recordings;
};

@customElement("dvr-ui")
export class DvrUI extends LitElement {
    @property({ type: Array })
    cameras: Camera[] = mockCameras;

    @state()
    recordings: Recording[] = generateMockRecordings(mockCameras, 7); // Initial data, last 7 days

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

    // Styling
    static styles = css`
        :host {
            display: block;
            padding: 16px;
            font-family: sans-serif;
        }
        .controls {
            display: flex;
            flex-wrap: wrap;
            gap: 16px;
            margin-bottom: 16px;
            align-items: center; /* Vertically align items */
        }
        .recordings-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 16px;
        }
        .recording-card {
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            background-color: white;
        }
        .recording-thumbnail {
            width: 100%;
            height: 120px;
            object-fit: cover;
            border-radius: 4px;
        }
        .timeline-container {
            width: 100%;
            height: 100px;
            background-color: #f0f0f0;
            border-radius: 8px;
            margin-top: 16px;
            position: relative; /* Make sure the timeline container is a positioning context */
            overflow: hidden;
            border: 1px solid #ccc;
        }

        .timeline {
            position: absolute; /* Allows for absolute positioning of elements within */
            top: 0;
            left: 0;
            width: 2400px; /* 24 hours * 100px per hour */
            height: 100%;
            display: flex;
        }

        .timeline-hour {
            flex: 0 0 100px; /* Each hour is 100px wide */
            height: 100%;
            border-right: 1px solid #ccc;
            display: flex; /* For aligning the hour label */
            align-items: center;
            justify-content: center;
            font-size: 0.7em;
            color: #666;
        }

        .recording-bar {
            position: absolute;
            background-color: rgba(0, 123, 255, 0.7); /* Blue with opacity */
            height: 30px;
            top: 35px; /* Position in the middle of the timeline */
            border-radius: 4px;
            pointer-events: all; /* Important: Make sure the bar is clickable */
            cursor: pointer;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }

        .recording-bar:hover {
            background-color: rgba(0, 123, 255, 0.9);
        }

        .current-time-indicator {
            position: absolute;
            top: 0;
            height: 100%;
            border-left: 2px solid red;
            pointer-events: none; /* Important: Allows clicks to go through */
            z-index: 10;
        }

        .current-time-text {
            position: absolute;
            top: 0;
            left: 5px;
            color: red;
            font-size: 0.8em;
            white-space: nowrap;
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

    // Computed Properties
    get filteredRecordings(): Recording[] {
        let recordings = this.recordings;
        if (this.selectedCameraId !== "all") {
            recordings = recordings.filter((r) => r.cameraId === this.selectedCameraId);
        }
        recordings = recordings.filter(
            (r) => DateTime.fromISO(r.startTime).toFormat("yyyy-MM-dd") === this.selectedDate
        );
        return recordings;
    }

    get timelineWidth(): number {
        return 2400; // 24 hours * 100px
    }

    // Event Handlers
    handleDateChange(event: Event) {
        const input = event.target as HTMLInputElement;
        this.selectedDate = input.value;
    }

    handleCameraChange(event: Event) {
        const select = event.target as HTMLSelectElement;
        this.selectedCameraId = select.value;
    }

    handleTimeChange(event: Event) {
        const input = event.target as HTMLInputElement;
        this.currentTime = input.value;
    }

    formatTime(date: string) {
        return DateTime.fromISO(date).toFormat("HH:mm");
    }

    getTimelinePosition(isoTime: string): number {
        const recordingTime = DateTime.fromISO(isoTime);
        const selectedDateTime = DateTime.fromISO(this.selectedDate);
        const diffInMinutes = recordingTime.diff(selectedDateTime, "minutes").minutes;
        return diffInMinutes * (100 / 60); // 100px per hour, 100/60 px per minute
    }

    renderRecordingBars() {
        return this.filteredRecordings.map((recording) => {
            const startPosition = this.getTimelinePosition(recording.startTime);
            const endPosition = this.getTimelinePosition(recording.endTime);
            const width = endPosition - startPosition;

            return html`
                <div
                    class="recording-bar"
                    style="left: ${startPosition}px; width: ${width}px;"
                    title="${this.formatTime(recording.startTime)} - ${this.formatTime(
                        recording.endTime
                    )}"
                    @click=${() => this.handleRecordingClick(recording)}
                ></div>
            `;
        });
    }

    handleRecordingClick(recording: Recording) {
        //  implement seek functionality
        const recordingStartTime = DateTime.fromISO(recording.startTime);
        this.currentTime = recordingStartTime.toFormat("HH:mm");
        console.log("Clicked on recording:", recording);
    }

    handleTimelineMouseDown(event: MouseEvent) {
        // this.isTimelineDragging = true;
        // this.timelineDragStartTime = event.clientX;
        // this.timelineDragCurrentTime = this.getEventTime(event.clientX);
        // this.currentTime = this.timelineDragCurrentTime;

        // // Add mousemove and mouseup listeners to the document
        // document.addEventListener("mousemove", this.handleTimelineMouseMove);
        // document.addEventListener("mouseup", this.handleTimelineMouseUp);
        // event.preventDefault(); // Prevent text selection
    }

    handleTimelineMouseMove = (event: MouseEvent) => {
        // if (!this.isTimelineDragging) return;

        // const newTime = this.getEventTime(event.clientX);
        // this.currentTime = newTime;
        // this.timelineDragCurrentTime = newTime;
        // event.preventDefault();
    };

    getEventTime(clientX: number): string {
        const timelineRect = this.shadowRoot
            ?.querySelector(".timeline-container")
            ?.getBoundingClientRect();
        if (!timelineRect) {
            return this.currentTime; // Or some default, error handling
        }

        const xPos = clientX - timelineRect.left;
        const minutes = xPos / (100 / 60); // 100px per hour, 100/60 px per minute
        const selectedDateTime = DateTime.fromISO(this.selectedDate);
        let newTime = selectedDateTime.plus({ minutes: minutes });

        // Clamp the time to be within 00:00 and 23:59
        if (newTime.hour < 0) {
            newTime = newTime.set({ hour: 0, minute: 0 });
        }
        if (newTime.hour > 23) {
            newTime = newTime.set({ hour: 23, minute: 59 });
        }
        return newTime.toFormat("HH:mm");
    }

    handleTimelineMouseUp = () => {
        this.isTimelineDragging = false;
        document.removeEventListener("mousemove", this.handleTimelineMouseMove);
        document.removeEventListener("mouseup", this.handleTimelineMouseUp);
    };

    // Render
    render() {
        return html`
            <h1>DVR UI</h1>

            <div class="controls">
                <label for="date">Date:</label>
                <input
                    type="date"
                    id="date"
                    value="${this.selectedDate}"
                    @change="${this.handleDateChange}"
                />

                <label for="camera">Camera:</label>
                <select id="camera" @change="${this.handleCameraChange}">
                    <option value="all">All Cameras</option>
                    ${this.cameras.map(
                        (camera) => html` <option value="${camera.id}">${camera.name}</option> `
                    )}
                </select>
                <label for="time">Time:</label>
                <input
                    type="time"
                    id="time"
                    value="${this.currentTime}"
                    @change="${this.handleTimeChange}"
                />
            </div>

            <div
                class="timeline-container"
                @mousedown=${(e: MouseEvent) => this.handleTimelineMouseDown(e)}
            >
                <div class="timeline" style="width: ${this.timelineWidth}px;">
                    ${[...Array(24)].map(
                        (_, i) => html` <div class="timeline-hour">${i}:00</div> `
                    )}
                    ${this.renderRecordingBars()}
                </div>
                <div
                    class="current-time-indicator"
                    style="left: ${this.getTimelinePosition(
                        this.selectedDate + "T" + this.currentTime + ":00"
                    )}px;"
                >
                    <span class="current-time-text">${this.currentTime}</span>
                </div>
            </div>

            <div class="recordings-grid">
                ${this.filteredRecordings.length > 0
                    ? this.filteredRecordings.map(
                          (recording) => html`
                              <div class="recording-card">
                                  <img
                                      src="${recording.thumbnail}"
                                      alt="Thumbnail"
                                      class="recording-thumbnail"
                                  />
                                  <p>
                                      Camera:
                                      ${this.cameras.find((c) => c.id === recording.cameraId)
                                          ?.name || "Unknown"}
                                  </p>
                                  <p>Start: ${this.formatTime(recording.startTime)}</p>
                                  <p>End: ${this.formatTime(recording.endTime)}</p>
                              </div>
                          `
                      )
                    : html`<p class="no-recordings-message">
                          No recordings found for the selected date and camera.
                      </p>`}
            </div>
        `;
    }
}

declare global {
  interface HTMLElementTagNameMap {
    'dvr-ui': DvrUI
  }
}
