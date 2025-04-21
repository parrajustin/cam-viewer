import { Err, Ok, Result } from "./common/result";
import { StatusError, UnavailableError } from "./common/status_error";
import { WrapPromise } from "./common/wrap_promise";

const POSSIBLE_SERVER_BASE_URL = ["http://localhost:8070", "http://192.168.20.3:7777", "https://epcamvidserver.parrajustin.com", ];
export let SERVER_BASE_URL = "https://epcamvidserver.parrajustin.com";
const UNIQ_ENDPOINT = "019656a2-ef1d-710c-8946-0396075162c2";

type ExpectedServerResp = { success: true, message: "019656a2-ef1d-710c-8946-0396075162c2" };

export async function IdentifyServerBaseUrl(): Promise<Result<string, StatusError>> {

    for (const url of POSSIBLE_SERVER_BASE_URL) {
        const response  = await WrapPromise(fetch(`${url}/${UNIQ_ENDPOINT}`), "");
        if (response.err) {
            continue;
        }
        if (!response.val.ok) {
            continue;
        }
        const json  = await WrapPromise(response.val.json(), "");
        if (json.err) {
            continue;
        }
        const jsonVal = json.val as ExpectedServerResp;
        if (jsonVal.success === true && jsonVal.message === "019656a2-ef1d-710c-8946-0396075162c2") {
            SERVER_BASE_URL = url;
            return Ok(url);
        }
    }

    return Err(UnavailableError(`Unable to find server url.`));
}