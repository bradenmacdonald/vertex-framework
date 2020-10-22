import { suite, test, assertRejects, isolateTestWrites, assert } from "./lib/intern-tests";

import { CreatePerson, Person } from "./test-project/Person";
import { testGraph } from "./test-project/graph";
import { normalizeUUID, UUID } from "./lib/uuid";
import { SYSTEM_UUID } from "./schema";
import { log } from "./lib/log";
import { CreateMovieFranchise } from "./test-project/MovieFranchise";
import { CreateMovie, Movie } from "./test-project/Movie";

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

        test("Actions are performed by the system user by default", async () => {
            const result = await testGraph.runAsSystem(
                CreatePerson({shortId: "ash", name: "Ash", props: {}}),
            );
            const userResult = await testGraph.read(tx => tx.queryOne(`
                MATCH (u:User)-[:PERFORMED]->(a:Action {type: $type})-[:MODIFIED]->(:${Person.label})::{$key}
            `, {type: CreatePerson.type, key: result.uuid}, {u: "any"}));
            // Because "u" is typed as "any" instead of a User VNode, we have to access its properties via .properties:
            assert.equal(userResult.u.properties.shortId, "system");
            assert.equal(userResult.u.properties.uuid, SYSTEM_UUID);
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

    suite("Default Create Action Template", () => {

        test("can create a VNode", async () => {
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

        test("gives VNodes unique, valid UUIDs", async () => {
            const createAsh = await testGraph.runAsSystem(
                CreatePerson({shortId: "ash", name: "Ash", props: {}}),
            );
            const uuidAsh = createAsh.uuid;
            assert.isString(uuidAsh);
            assert.equal(uuidAsh, normalizeUUID(uuidAsh));  // UUID must be in standard form
            const p = await testGraph.pullOne(Person, p => p.uuid, {key: "ash"});
            assert.equal(p.uuid, uuidAsh);

            const createBailey = await testGraph.runAsSystem(
                CreatePerson({shortId: "bailey", name: "Bailey", props: {}}),
            );
            const uuidBailey = createBailey.uuid;
            assert.isString(uuidBailey);
            assert.equal(uuidBailey, normalizeUUID(uuidBailey));
            const p2 = await testGraph.pullOne(Person, p => p.uuid, {key: "bailey"});
            assert.equal(p2.uuid, uuidBailey);

            assert.notEqual(uuidAsh, uuidBailey);
        });

        test("doesn't allow creating invalid VNodes", async () => {
            await assertRejects(testGraph.runAsSystem(
                CreatePerson({shortId: "ash", name: 17 as any, props: {}}),
            ), `"name" must be a string`);
            // shortId must be short:
            await assertRejects(testGraph.runAsSystem(
                CreatePerson({shortId: "this-is-a-very-long-short-ID-and-will-not-be-allowed", name: "Ash", props: {}}),
            ), `"shortId"`);
            // required props missing:
            await assertRejects(testGraph.runAsSystem(
                CreatePerson({props: {}} as any),
            ), `"shortId" is required`);
        });

        test("it can set properties and relationships via the Update action", async () => {
            await testGraph.runAsSystem(
                CreateMovieFranchise({shortId: "star-wars", name: "Star Wars", props: {}}),
                CreateMovie({shortId: "star-wars-4", title: "Star Wars: Episode IV – A New Hope", year: 1977, props: {
                    franchiseId: "star-wars",
                }}),
            );
            // Note that we only call the CreateMovie action (not UpdateMovie), and the logic for how to set the
            // franchise from the "franchiseId" argument is only defined in UpdateMovie, but this still works,
            // because the CreateMovie action uses UpdateMovie internally:
            const starWars = await testGraph.pullOne(Movie, m => m.franchise(f => f.name), {key: "star-wars-4"});
            assert.equal(starWars.franchise?.name, "Star Wars");
        });

        // TODO - test undo
    });

    suite("Default Update Action Template", () => {

        // TODO - test changing data

        // TODO - test retrieving by old and new shortId

        // TODO - test other updates, e.g. movie franchise
    });
});
