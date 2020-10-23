import { suite, test, assertRejects, isolateTestWrites, assert } from "./lib/intern-tests";

import { CreatePerson, Person } from "./test-project/Person";
import { testGraph } from "./test-project/graph";
import { UUID } from "./lib/uuid";
import { SYSTEM_UUID } from "./schema";
import { log } from "./lib/log";
import { CreateMovieFranchise } from "./test-project/MovieFranchise";
import { CreateMovie, Movie } from "./test-project/Movie";

// Data for use in tests ///////////////////////////////////////////////////////////////////////////////////////////////

suite("action", () => {
    isolateTestWrites();

    suite("test isolation", () => {
        // Test that our test cases have sufficient test isolation, via isolateTestWrites()
        const createJamie = CreatePerson({shortId: "jamie", name: "Jamie"});
        test("create a person", async () => {
            await testGraph.runAsSystem(createJamie);
        });

        test("create a person (2)", async () => {
            // Should succeed, even though there is a unique constraint on shortId.
            // This will only fail if the previous test case wasn't rolled back correctly.
            await testGraph.runAsSystem(createJamie);
        });

        test("create a person (check constraint)", async () => {
            // Check our assumptions: make sure there actually is a unique constraint on shortId
            await testGraph.runAsSystem(createJamie);
            await assertRejects(
                testGraph.runAsSystem(createJamie)
            );
        });
    });

    suite("basic checks", () => {

        test("Actions are performed by the system user by default", async () => {
            const result = await testGraph.runAsSystem(
                CreatePerson({shortId: "ash", name: "Ash"}),
            );
            const userResult = await testGraph.read(tx => tx.queryOne(`
                MATCH (u:User:VNode)-[:PERFORMED]->(a:Action:VNode {type: $type})-[:MODIFIED]->(:${Person.label}:VNode)::{$key}
            `, {type: CreatePerson.type, key: result.uuid}, {u: "any"}));
            // Because "u" is typed as "any" instead of a User VNode, we have to access its properties via .properties:
            assert.equal(userResult.u.properties.shortId, "system");
            assert.equal(userResult.u.properties.uuid, SYSTEM_UUID);
        });

        test("Running an action with a non-existent user ID will raise an error", async () => {
            await assertRejects(testGraph.runAs(
                UUID("6996ddbf-6cd0-4541-9ee9-3c37f8028941"),
                CreatePerson({shortId: "ash", name: "Ash"}),
            ), `Invalid user ID - unable to apply action.`);
            assert.equal(
                (await testGraph.pull(Person, p => p.shortId, {key: "ash"})).length,
                0
            )
        });

        suite("Graph data cannot be modified outside of an action", () => {

            test("from a read transaction", async () => {
                await assertRejects(
                    testGraph.read(tx =>
                        tx.run("CREATE (x:SomeNode) RETURN x", {})
                    ),
                    "Writing in read access mode not allowed."
                );
            });

            test("from a write transaction", async () => {
                // Application code should not ever use _restrictedWrite, but even when it is used,
                // a trigger should enfore that no changes to the database are made outside of an
                // action. Doing so requires using both _restrictedWrite() and 
                // _restrictedAllowWritesWithoutAction() together.
                await assertRejects(
                    testGraph._restrictedWrite(tx =>
                        tx.run("CREATE (x:SomeNode) RETURN x", {})
                    ),
                    "every data write transaction should be associated with one Action"
                );
            });
        });
    });
});
