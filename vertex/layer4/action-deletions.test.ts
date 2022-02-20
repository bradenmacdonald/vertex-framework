import { group, test, configureTestData, assertEquals } from "../lib/tests.ts";
import { CreateMovie, CreateMovieFranchise, Movie, testGraph, } from "../test-project/index.ts";
import {
    C,
    GenericCypherAction,
    Action,
    Field,
} from "../index.ts";

group(import.meta, () => {

    configureTestData({isolateTestWrites: true, loadTestProjectData: false});
    
    group("trackActionDeletes", () => {

        test("records when nodes are fully deleted", async () => {
            await testGraph.runAsSystem(
                // To make this test more complex, we'll be deleting a node with relationships:
                CreateMovieFranchise({slugId: "mcu", name: "Marvel Cinematic Universe"}),
            );
            const movie = await testGraph.runAsSystem(
                CreateMovie({slugId: "infinity-war", title: "Avengers: Infinity War", year: 2018, franchiseId: "mcu"}),
            );
            const action1 = await testGraph.runAsSystem(
                // Soft delete the movie:
                GenericCypherAction({cypher: C`
                    MATCH (m:${Movie}), m HAS KEY ${"infinity-war"}
                    DETACH DELETE m
                `, modifiedNodes: [movie.id]}),
            );
            const changes = await testGraph.read(tx => tx.queryOne(C`
                MATCH (a:${Action} {id: ${action1.actionId}})
            `.RETURN({"a.deletedNodeIds": Field.List(Field.VNID)})));
            assertEquals(changes["a.deletedNodeIds"], [movie.id]);
        });
    });
});
