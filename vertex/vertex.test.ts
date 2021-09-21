import { group, test, assertEquals, assertThrowsAsync, configureTestData } from "./lib/tests.ts";
import { Person, testGraph } from "./test-project/index.ts";

import { VNID, SlugId } from "./index.ts";

group("Vertex Core", () => {

    group("Basic database operations", () => {

        test("Can retrieve a value", async () => {
            const result = await testGraph.read(tx => tx.run("RETURN 42 AS value"));
            assertEquals(result.records.length, 1);
            assertEquals(result.records[0].get("value"), 42n);
        });

        test("Can report an error message", async () => {
            await assertThrowsAsync(
                () => testGraph.read(tx => tx.run("RETURN tribble bibble")),
                undefined,
                "Invalid input 'b'",  // The 'b' at the start of "bibble" is where the parsing error occurs
            );
        });
    });

    group("vnidForkey", () => {

        configureTestData({loadTestProjectData: true, isolateTestWrites: false});

        test("can retrieve VNID from either key type", async () => {
            // First, check Chris Pratt's VNID
            const slugId: SlugId = "chris-pratt";
            const vnid: VNID = (await testGraph.pullOne(Person, p => p.id, {key: slugId})).id;

            assertEquals(await testGraph.vnidForKey(vnid), vnid);
            assertEquals(await testGraph.vnidForKey(slugId), vnid);
        });
    });
});