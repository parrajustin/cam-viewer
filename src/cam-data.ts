import { signal } from "@lit-labs/signals";

type IsoTime = string;

interface VideoEntryData {
    timeOfVideoStart: IsoTime;
    path: string;
}

interface HourVideoImageData {
    hourOfDayStart: IsoTime;
    videos: VideoEntryData[];
}

interface DayVideoImageData {
    dayStart: IsoTime;
    videos: HourVideoImageData[];
}

type DateStringIsoDate = string;
interface CamEntry {
    name: string;
    dates: Record<DateStringIsoDate, DayVideoImageData>;
}

export type CamData = { [camName: string]: CamEntry };

export const CAM_DATA = signal<CamData>({} as CamData);
