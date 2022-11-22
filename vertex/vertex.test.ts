import { group, test, assertEquals, assertRejects, configureTestData, assertThrows } from "./lib/tests.ts";
import { Movie, testGraph } from "./test-project/index.ts";

import { VNodeType } from "./index.ts";

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

    group("Query profiling", () => {

        configureTestData({loadTestProjectData: true, isolateTestWrites: false});

        test("Can check how many dbHits a query takes", async () => {
            const data = await testGraph.read(tx => tx.run(`MATCH (m:${Movie.label}:VNode {slugId: $s}) RETURN m.id`, {s: "tropic-thunder"}));
            const movieId: string = data.records[0].get("m.id");
            // For some reason, the # of dbHits was flaky when looking up by slugId, so we just look up by ID to get a
            // consistent result here.
            testGraph.startProfile("compact");
            const result = await testGraph.read(tx => tx.run(`MATCH (m:${Movie.label}:VNode {id: $id}) RETURN m.title`, {id: movieId}));
            const profile = testGraph.finishProfile();
            assertEquals(result.records.length, 1);
            assertEquals(result.records[0].get("m.title"), "Tropic Thunder");
            assertEquals(profile.dbHits, 4);
        });
    });
});
