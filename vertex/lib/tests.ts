import {test, group as baseGroup, afterAll, afterEach, beforeAll, beforeEach} from "https://deno.land/x/hooked@v0.1.0/mod.ts";
export * from "https://deno.land/std@0.99.0/testing/asserts.ts";

import { log } from "./log.ts"
import { VertexTestDataSnapshot } from "../vertex-interface.ts";
import { testGraph, createTestData } from "../test-project/index.ts";

export {
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



let dataStr: string;
try {
    dataStr = await Deno.readTextFile("_vertex-tests-data.json");
} catch (err) {
    log.error("Please run 'deno run --allow-net --allow-write vertex/lib/test-setup.ts'");
    Deno.exit(1);
}
let dataSnapshot: VertexTestDataSnapshot = JSON.parse(dataStr);

async function resetTestDbToSnapshot(): Promise<void> {
    try {
        await testGraph.resetDBToSnapshot(dataSnapshot);
    } catch (err) {
        log.error(`Error during resetTestDbToSnapshot: ${err}`);
        throw err;
    }
}


export function configureTestData(args: {
    // Load the data from test-project/test-data.ts before running these tests?
    loadTestProjectData: boolean,
    // If these tests are writing to the database, set this to true and the database will be reset after each test.
    // If the tests are read-only, set this false for better performance.
    isolateTestWrites: boolean,
}): void {
    if (args.isolateTestWrites) {
        if (args.loadTestProjectData) {
            beforeEach(async () => {
                await createTestData(testGraph);
            });
        }
        // Reset the database to the snapshot after each test
        afterEach(resetTestDbToSnapshot);
    } else {
        // These tests are not writing to the database so we don't need to reset it after each test.
        // But if the test suite as a whole needs sample data, we need to load it first and reset it after:
        if (args.loadTestProjectData) {
            beforeAll(async () => {
                await createTestData(testGraph);
            });
            afterAll(resetTestDbToSnapshot);
        }
    }
}

// Template string helper for comparing strings, dedenting a multiline string.
// This is modified from Desmond Brand's MIT licensed implementation https://github.com/dmnd/dedent
export function dedent(strings: TemplateStringsArray, ...values: string[]): string {
    const raw = typeof strings === "string" ? [strings] : strings.raw;
  
    // first, perform interpolation
    let result = "";
    for (let i = 0; i < raw.length; i++) {
        result += raw[i]
        // join lines when there is a suppressed newline
        .replace(/\\\n[ \t]*/g, "")
        // handle escaped backticks
        .replace(/\\`/g, "`");

        if (i < values.length) {
            result += values[i];
        }
    }
  
    // now strip indentation
    const lines = result.split("\n");
    let mindent: number | null = null;
    lines.forEach(l => {
        const m = l.match(/^(\s+)\S+/);
        if (m) {
            const indent = m[1].length;
            if (!mindent) {
                // this is the first indented line
                mindent = indent;
            } else {
                mindent = Math.min(mindent, indent);
            }
        }
    });
  
    if (mindent !== null) {
        const m = mindent; // appease Flow
        result = lines.map(l => l[0] === " " ? l.slice(m) : l).join("\n");
    }
  
    return result
        // dedent eats leading and trailing whitespace too
        .trim()
        // handle escaped newlines at the end to ensure they don't get stripped too
        .replace(/\\n/g, "\n");
}
