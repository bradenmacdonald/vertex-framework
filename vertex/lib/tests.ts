import {test, group as baseGroup, afterAll, afterEach, beforeAll, beforeEach} from "https://deno.land/x/hooked@v0.1.0/mod.ts";
import * as assert from "https://deno.land/std@0.99.0/testing/asserts.ts";

export {
    assert,
    test,
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
};

/**
 * Helper to create a nice name for the base test group in a test suite file.
 * 
 * Usage:
 *     group(import.meta, () => {
 *         group("UUIDv4", () => {
 *             test("parse and format a UUIDv4", () => {
 *                 // test code
 *
 * @param nameOrImportMeta A custom name for this group, or `import.meta` to auto-generate the name from the filename
 */
export function group(nameOrImportMeta: {url: string}|string, tests: () => any) {
    if (typeof nameOrImportMeta === "string") {
        return baseGroup(nameOrImportMeta, tests);
    }
    const url = nameOrImportMeta.url;
    const idx = url.indexOf("/vertex/");
    if (idx === -1) {
        return baseGroup(url, tests);
    }
    return baseGroup(url.substr(idx + 1), tests);
}

