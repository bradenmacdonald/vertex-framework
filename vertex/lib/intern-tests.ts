/* istanbul ignore file */
import intern from "intern";
export { intern };

import { reverseAllMigrations, runMigrations } from "../migrator";
import { testGraph } from "../test-project/graph";
import { createTestData } from "../test-project/test-data";

export const { registerSuite } = intern.getPlugin("interface.object");
export const { suite, test, before, beforeEach } = intern.getPlugin("interface.tdd");
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

intern.on("beforeRun", async () => {
    // Wipe out all existing Neo4j data
    await reverseAllMigrations(testGraph);
    // Apply pending migrations
    await runMigrations(testGraph);
    // Create test data
    await createTestData(testGraph);
});

intern.on("afterRun", async () => {
    await testGraph.shutdown();
});

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
