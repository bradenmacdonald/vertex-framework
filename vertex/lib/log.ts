/**
 * Vertex Framework logging functions.
 */
import { stdLog, Neo4j } from "../deps.ts";

/** Version of JSON.stringify that supports bigint and date types. Useful for debugging. */
export function stringify(data: unknown): string {
    return JSON.stringify(data, (_key, value) =>
        typeof value === "bigint" ? value.toString() + "n" :
        Neo4j.isDate(value) ? value.toString() :
        value
    );
}

// Fix the awkward Deno std log API by wrapping it.
// This will ensure all logs use the "vertex-framework" logger so that applications can have fine control over our logs.
// This will also change the log functions so that they'll convert any arguments to nicely formatted strings.
const moduleName = "vertex-framework";
const getLogger = stdLog.getLogger;
const fmtObj = typeof Deno?.inspect === "function" ? Deno.inspect : stringify;
const fmt = (msg: unknown) => typeof msg === "string" ? msg : fmtObj(msg);
export const log = {
    warning(...args: unknown[]) {
        getLogger(moduleName).warning(() => args.map((a) => fmt(a)).join(" "));
    },
    debug(...args: unknown[]) {
        getLogger(moduleName).debug(() => args.map((a) => fmt(a)).join(" "));
    },
    info(...args: unknown[]) {
        getLogger(moduleName).info(() => args.map((a) => fmt(a)).join(" "));
    },
    error(...args: unknown[]) {
        getLogger(moduleName).error(() => args.map((a) => fmt(a)).join(" "));
    },
    critical(...args: unknown[]) {
        getLogger(moduleName).critical(() => args.map((a) => fmt(a)).join(" "));
    },
};
