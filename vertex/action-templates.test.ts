import { suite, test, assertRejects, isolateTestWrites, assert } from "./lib/intern-tests";

import { CreatePerson, Person } from "./test-project/Person";
import { testGraph } from "./test-project/graph";
import { normalizeUUID, UUID } from "./lib/uuid";
import { SYSTEM_UUID } from "./schema";
import { log } from "./lib/log";
import { CreateMovieFranchise } from "./test-project/MovieFranchise";
import { CreateMovie, Movie } from "./test-project/Movie";

// Data for use in tests ///////////////////////////////////////////////////////////////////////////////////////////////

suite("action templates", () => {
    isolateTestWrites();

    suite("defaultCreateFor", () => {

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

        test("it can be undone", async () => {
            await testGraph.runAsSystem(
                CreateMovieFranchise({shortId: "star-wars", name: "Star Wars", props: {}}),
            );
            // Create a movie - this is the action that we will soon undo:
            const createResult = await testGraph.runAsSystem(
                CreateMovie({shortId: "star-wars-4", title: "Star Wars: Episode IV – A New Hope", year: 1977, props: {
                    franchiseId: "star-wars",
                }}),
            );
            // Check that it was created:
            const orig = await testGraph.pullOne(Movie, m => m.title.franchise(f => f.name), {key: "star-wars-4"});
            assert.equal(orig.title, "Star Wars: Episode IV – A New Hope")
            assert.equal(orig.franchise?.name, "Star Wars");
            // Now undo it
            const undoResult = await testGraph.undoAction({actionUuid: createResult.actionUuid, asUserId: undefined});
            const newResult = await testGraph.pull(Movie, m => m.title.franchise(f => f.name), {key: "star-wars-4"});
            assert.equal(newResult.length, 0);
        });
    });

    suite("defaultUpdateActionFor", () => {

        // TODO - test changing data

        // TODO - test retrieving by old and new shortId

        // TODO - test other updates, e.g. movie franchise
    });
});
