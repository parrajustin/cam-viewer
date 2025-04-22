import { Dexie, InsertType, type EntityTable } from "dexie";
import { CamData } from "./cam-data";
import { DateTime } from "luxon";
import { StatusResult } from "./common/result";
import { StatusError } from "./common/status_error";
import { WrapPromise } from "./common/wrap_promise";

// Typing for your entities (hint is to move this to its own module)
export interface Video {
    id: number;
    camName: string;
    // Seconds from unix epoch the video starts.
    vidStartEpoch: number;
    // Seconds from unix epoch the video ends.
    vidEndEpoch: number;
    // Seconds from the day start the video starts.
    vidDayStart: number;
    // Seconds from the day start the video ends.
    vidDayEnd: number;
    // Remote file path.
    filePath: string;
}

// Database declaration (move this to its own module also)
export const CAM_DB = new Dexie("VideoDatabase") as Dexie & {
    videoFiles: EntityTable<Video, "id">;
};
CAM_DB.version(1).stores({
    videoFiles: "++id, camName, vidStartEpoch, vidEndEpoch, vidDayStart, vidDayEnd, filePath"
});

export const VIDEOS_LOADED = Promise.withResolvers<void>();

// Push the parsed data to the database.
export async function PushCamDataToDatabase(camData: CamData): Promise<StatusResult<StatusError>> {
    await CAM_DB.videoFiles.clear();

    const newEntries: InsertType<Video, "id">[] = [];
    const camNames = Object.keys(camData);
    for (const camName of camNames) {
        const camEntry = camData[camName];
        const dates = Object.keys(camEntry.dates);
        for (const date of dates) {
            const parsedDate = DateTime.fromFormat(date, "yyyy-MM-dd");
            if (!parsedDate.isValid) {
                continue;
            }
            const dateEntry = camEntry.dates[date];
            for (const hour of dateEntry.videos) {
                for (const video of hour.videos) {
                    const parsedVideoStart = DateTime.fromISO(video.timeOfVideoStart);
                    if (!parsedVideoStart.isValid) {
                        continue;
                    }
                    const videoEnd = parsedVideoStart.plus({ minutes: 1 });

                    const dayStartRelative = Math.abs(
                        parsedDate.diff(parsedVideoStart, "seconds").seconds
                    );
                    const dayEndRelative = Math.abs(parsedDate.diff(videoEnd, "seconds").seconds);

                    newEntries.push({
                        camName: camName,
                        vidStartEpoch: parsedVideoStart.toSeconds(),
                        vidEndEpoch: videoEnd.toSeconds(),
                        vidDayStart: dayStartRelative,
                        vidDayEnd: dayEndRelative,
                        filePath: video.path
                    });
                }
            }
        }
    }

    return WrapPromise(CAM_DB.videoFiles.bulkAdd(newEntries).then((value) => {
        VIDEOS_LOADED.resolve();
        return value;
    }), `Failed to bulk add new entries`);
}
