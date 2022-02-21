import { group, test, assertEquals, assertRejects, configureTestData, assertThrows } from "./lib/tests.ts";
import { Person, testGraph } from "./test-project/index.ts";

import { VNID, SlugId, VNodeType } from "./index.ts";

group("Vertex Core", () => {


    group("VNodeType Registration", () => {
        test("Vertex.registerVNodeType", () => {

            class SomeVNT extends VNodeType {
                static readonly label = "SomeVNT";
                static readonly properties = {
                    ...VNodeType.properties,
                };
            }

            testGraph.registerVNodeType(SomeVNT);
            assertThrows(() => {
                testGraph.registerVNodeType(SomeVNT);
            }, "Duplicate VNodeType label: SomeVNT");
            testGraph.unregisterVNodeType(SomeVNT);
        });
    });


    group("Basic database operations", () => {

        test("Can retrieve a value", async () => {
            const result = await testGraph.read(tx => tx.run("RETURN 42 AS value"));
            assertEquals(result.records.length, 1);
            assertEquals(result.records[0].get("value"), 42n);
        });

        test("Can report an error message", async () => {
            await assertRejects(
                () => testGraph.read(tx => tx.run("RETURN tribble bibble")),
                "Invalid input 'b'",  // 'bibble' is the invalid part here
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
