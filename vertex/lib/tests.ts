// deno-lint-ignore-file no-explicit-any
import {test as baseTest, group as baseGroup, afterAll, afterEach, beforeAll, beforeEach} from "./tests-hooked.ts";
export * from "https://deno.land/std@0.175.0/testing/asserts.ts";
export * from "https://deno.land/std@0.175.0/testing/types.ts";

import { log } from "./log.ts"
import { VertexTestDataSnapshot } from "../vertex-interface.ts";
import { testGraph } from "../test-project/index.ts";
import type { VNodeType } from "../layer3/vnode.ts";

export {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
};

// Additional asserts
export function assertIsEmpty(value: Record<string, unknown>) {
    if (typeof value !== "object" || Object.keys(value).length > 0) {
        throw new Error(`Expected object "${value}" to be empty; found keys: ${Object.keys(value).join(", ")}`);
    }
}

/** Compile-time helper for asserting that an object doesn't have a specific property */
export type IsPropertyPresent<Type, KeyName extends string> =
    Type extends {[K in KeyName]: any} ? true : false;

/** Compile-time helper for asserting that an object has a specific optional property */
export type IsPropertyOptional<Type, KeyName extends string, ValueType = any> =
    Type extends {[K in KeyName]: ValueType} ? false :
    Type extends {[K in KeyName]?: ValueType} ? true :
    false;

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
 export function group(nameOrImportMeta: {url: string}|string, tests: () => unknown) {
    if (typeof nameOrImportMeta === "string") {
        return baseGroup(nameOrImportMeta, tests);
    }
    const url = nameOrImportMeta.url;
    const idx = url.indexOf("/vertex/");
    if (idx === -1) {
        return baseGroup(url, tests);
    }
    return baseGroup(url.substring(idx + 1), tests);
}


// Override the test() function to disable the ops/resources sanitizers by default, as our beforeTest/afterTest code
// interferes with them.
function badArgs(): never { throw new Error("Invalid test definition"); }
export function test(t: Deno.TestDefinition): void;
export function test(name: string, fn: () => void | Promise<void>): void;
export function test(
    t: Deno.TestDefinition | string,
    testFn?: () => void | Promise<void>,
): void {
    // Extract args
    const { name, fn, ...opts } = typeof t === "object"
        ? t
        : (typeof testFn !== "undefined" ? { name: t, fn: testFn } : badArgs());
    opts.sanitizeOps = false;
    opts.sanitizeResources = false;
    return baseTest({name, fn, ...opts});
}


let dataStr: string;
try {
    dataStr = await Deno.readTextFile("_vertex-tests-data.json");
} catch {
    log.error("Please run 'deno run --allow-env --allow-net --allow-write vertex/lib/test-setup.ts'");
    Deno.exit(1);
}
const {baseSnapshot, testProjectSnapshot} = JSON.parse(dataStr) as {[K: string]: VertexTestDataSnapshot};

async function resetTestDbToSnapshot(): Promise<void> {
    try {
        await testGraph.resetDBToSnapshot(baseSnapshot);
    } catch (err) {
        log.error(`Error during resetTestDbToSnapshot: ${err}`);
        throw err;
    }
}
async function loadTestProjectData(): Promise<void> {
    try {
        await testGraph.resetDBToSnapshot(testProjectSnapshot);
    } catch (err) {
        log.error(`Error during loadTestProjectData: ${err}`);
        throw err;
    }
}

afterAll(async () => {
    await testGraph.shutdown();
})


export function configureTestData(args: {
    // Load the data from test-project/test-data.ts before running these tests?
    loadTestProjectData: boolean,
    // If these tests are writing to the database, set this to true and the database will be reset after each test.
    // If the tests are read-only, set this false for better performance.
    isolateTestWrites: boolean,
    // Additional VNodeTypes to register:
    additionalVNodeTypes?: VNodeType[],
}): void {
    if (args.isolateTestWrites) {
        if (args.loadTestProjectData) {
            beforeEach(loadTestProjectData);
        } else {
            beforeEach(resetTestDbToSnapshot);
        }
    } else {
        // These tests are not writing to the database so we don't need to reset it after each test.
        // But if the test suite as a whole needs sample data, we need to load it first and reset it after:
        if (args.loadTestProjectData) {
            beforeAll(loadTestProjectData);
            afterAll(resetTestDbToSnapshot);
        }
    }

    if (args.additionalVNodeTypes !== undefined) {
        const vnts = args.additionalVNodeTypes;
        beforeAll(() => { testGraph.registerVNodeTypes(vnts); });
        afterAll(() => { vnts.forEach(vnt => { testGraph.unregisterVNodeType(vnt); }); });
    }
}
