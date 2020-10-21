import { suite, test, assertRejects, isolateTestWrites, assert } from "./lib/intern-tests";

import { CreatePerson, Person } from "./test-project/Person";
import { testGraph } from "./test-project/graph";
import { UUID } from "./lib/uuid";
import { SYSTEM_UUID } from "./schema";
import { log } from "./lib/log";

// Data for use in tests ///////////////////////////////////////////////////////////////////////////////////////////////

suite("action", () => {
    isolateTestWrites();

    suite("test isolation", () => {
        // Test that our test cases have sufficient test isolation, via isolateTestWrites()
        const createJamie = CreatePerson({shortId: "jamie", name: "Jamie", props: {}});
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
        test("An Action can create a VNode", async () => {
            const result = await testGraph.runAsSystem(
                CreatePerson({shortId: "ash", name: "Ash", props: {}}),
            );
            assert.isString(result.uuid);
            // Get and check the new node in various ways:
            const checkPerson = (p: {uuid: UUID, shortId: string, name: string, dateOfBirth: string|undefined, }): void => {
                assert.equal(p.uuid, result.uuid);
                assert.equal(p.shortId, "ash");
                assert.equal(p.name, "Ash");
                assert.equal(p.dateOfBirth, undefined);
            };
            for (const entry of await testGraph.pull(Person, p => p.allProps)) {
                log(`Found entry ${JSON.stringify(entry)}`);
            }
            // By its shortId:
            const r1 = await testGraph.read(tx => tx.queryOne(`MATCH (p:${Person.label})::{$key}`, {key: "ash"}, {p: Person}));
            checkPerson(r1.p);
            // By its UUID:
            const r2 = await testGraph.read(tx => tx.queryOne(`MATCH (p:${Person.label})::{$key}`, {key: result.uuid}, {p: Person}));
            checkPerson(r2.p);
            // Using pull()
            const p3 = await testGraph.pullOne(Person, p => p.allProps, {key: result.uuid});
            checkPerson(p3);
        });
        test("Actions are performed by the system user by default", async () => {
            const result = await testGraph.runAsSystem(
                CreatePerson({shortId: "ash", name: "Ash", props: {}}),
            );
            const userResult = await testGraph.read(tx => tx.queryOne(`
                MATCH (u:User)-[:PERFORMED]->(a:Action {type: $type})-[:MODIFIED]->(:${Person.label})::{$key}
            `, {type: CreatePerson.type, key: result.uuid}, {u: "any"}));
            log.debug(`Result: ${JSON.stringify(userResult.u)}`);
            // Because "u" is typed as "any" instead of a User VNode, we have to access its properties via .properties:
            assert.equal(userResult.u.properties.shortId, "system");
            assert.equal(userResult.u.properties.uuid, SYSTEM_UUID);
        });
    });
});
