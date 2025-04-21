import type { Result } from "./result";
import { Ok } from "./result";
import { StatusError } from "./status_error";
import { UnknownError } from "./status_error";

export function CombineResults<T>(results: Result<T, StatusError>[]): Result<T[], StatusError> {
    const returnee: T[] = [];
    for (const result of results) {
        if (result.err) {
            return result;
        }
        returnee.push(result.safeUnwrap());
    }
    return Ok(returnee);
}

/** Converts unknown data to an unknown error. */
export function ConvertToUnknownError(errorStr: string): (err: unknown) => StatusError {
    return (err: unknown) => {
        if (err instanceof Error) {
            return UnknownError(`${errorStr}. "${err.message}" "${err.stack}"`);
        }

        if (err instanceof StatusError) {
            return err;
        }

        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        return UnknownError(`${errorStr}. "${err}"`);
    };
}
