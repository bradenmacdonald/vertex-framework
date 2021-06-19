/* istanbul ignore file */
import intern from "intern";
export { intern };

import { testGraph, createTestData } from "../test-project";
import { VertexTestDataSnapshot } from "../vertex-interface";
import { log } from "./log";
export { log };

export const { registerSuite } = intern.getPlugin("interface.object");
export const { suite, test, before, beforeEach, after, afterEach } = intern.getPlugin("interface.tdd");
export const { assert } = intern.getPlugin("chai");

export const assertRejects = async (what: Promise<any>, msg?: string): Promise<void> => {
    await what.then(() => {
        assert.fail(undefined, undefined, "Expected promise to reject, but it resolved.");
    }, err => {
        if (msg) {
            assert.throws(() => { throw err; }, msg);
        }
    });
}
