import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { DateTime } from "luxon";
import { Task, TaskStatus } from "@lit/task";

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

type IsoTime = string;

interface VideoEntryData {
    timeOfVideoStart: IsoTime;
    path: string;
}

interface HourVideoImageData {
    hourOfDayStart: IsoTime;
    videos: VideoEntryData[];
}

type HourStr = string;
interface DayVideoImageData {
    dayStart: IsoTime;
    videos: HourVideoImageData[];
}

type DateStringIsoDate = string;
interface CamEntry {
    name: string;
    dates: { [dateStr: DateStringIsoDate]: DayVideoImageData};
}

type CamData = { [camName: string]: CamEntry };

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
            const response = await fetch(`http://localhost:8070/cams`, { signal });
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

    // Handle date change
    private handleDateChange(event: Event) {
        // this.selectedDate = event.target.value;
        console.log("date change", event);
    }

    // Handle camera change
    private handleCameraChange(event: Event) {
        // this.selectedCamera = event.target.value;
        console.log("handleCameraChange", event);
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
            const date = DateTime.fromISO(timeStr);
            if (!date.isValid) {
                continue;
            }

            const dayStr = date.startOf("day").toISODate();
            dayTimes.add(dayStr);
        }

        const minDate = DateTime.min(
            ...[...dayTimes.values()]
                .map((dateStr) => DateTime.fromISO(dateStr))
                .filter((date) => date.isValid)
        ) ?? DateTime.now().startOf('day');
        const maxDate = DateTime.max(
            ...[...dayTimes.values()]
                .map((dateStr) => DateTime.fromISO(dateStr))
                .filter((date) => date.isValid)
        ) ?? DateTime.now().startOf('day');

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
                ${camNames.map((camera) => html` <option value="${camera}">${camera}</option> `)}
            </select>`;
    }

    // Render
    render() {
        return html`
            <h1>DVR UI</h1>

            <div class="controls">
                ${this._initialFetch.render({
                    initial: () => html`<p>Waiting to start task</p>`,
                    pending: () => html`<p>Running task...</p>`,
                    complete: (value) => this.renderCameraData(value.message),
                    error: (error) => html`<p>Oops, something went wrong: ${error}</p>`
                })}
            </div>

            <timeline-component></timeline-component>
        `;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "dvr-ui": DvrUI;
    }
}
