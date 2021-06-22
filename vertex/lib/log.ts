/**
 * Vertex Framework logging functions.
 */
import { stdLog, Neo4j } from "../deps.ts";

export const log = stdLog;

/** Version of JSON.stringify that supports bigint and date types. Useful for debugging. */
export function stringify(data: unknown): string {
    return JSON.stringify(data, (_key, value) =>
        typeof value === "bigint" ? value.toString() + "n" :
        Neo4j.isDate(value) ? value.toString() :
        value
    );
}
