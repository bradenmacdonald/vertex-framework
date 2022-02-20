import { group, test, assertThrowsAsync, configureTestData, assertEquals } from "../lib/tests.ts";
import { ActedIn, CreateMovie, CreateMovieFranchise, CreatePerson, Movie, MovieFranchise, Person, testGraph, UpdateMovie, } from "../test-project/index.ts";
import {
    VNID,
    getActionChanges,
    GenericCypherAction,
    VD,
} from "../index.ts";
import { C } from "../layer2/cypher-sugar.ts";
import { ActionChangeSet } from "./action-changes.ts";

group(import.meta, () => {

    configureTestData({isolateTestWrites: true, loadTestProjectData: false});
    
    group("getActionChanges", () => {

        test("throws an error for an invalid action ID", async () => {
            await assertThrowsAsync(
                () => testGraph.read(tx => getActionChanges(tx, VNID("_foobar"))),
                undefined,
                "Action not found.",
            );
        });

        test("gives data about created VNodes", async () => {
            const action1 = await testGraph.runAsSystem(
                CreateMovie({slugId: "tropic-thunder", title: "Tropic Thunder", year: 2008}),
            );
            const changes = await testGraph.read(tx => getActionChanges(tx, action1.actionId));
            assertEquals(changes, {
                createdNodes: [
                    {
                        id: action1.id,
                        labels: new Set(["VNode", "TestMovie"]),
                        properties: new Set(["id", "slugId", "title", "year"]),
                    }
                ],
                modifiedNodes: [],
                createdRelationships: [],
                deletedRelationships: [],
                deletedNodeIds: [],
            });
        });

        test("gives data about created VNodes and relationships", async () => {
            const franchiseAction = await testGraph.runAsSystem(
                CreateMovieFranchise({slugId: "jumanji", name: "Jumanji"}),
            )
            const action1 = await testGraph.runAsSystem(
                CreateMovie({slugId: "jumanji-2", title: "Jumanji: The Next Level", year: 2019, franchiseId: "jumanji"}),
            );
            const changes = await testGraph.read(tx => getActionChanges(tx, action1.actionId));
            const expected: ActionChangeSet = {
                createdNodes: [
                    {
                        id: action1.id,
                        labels: new Set(["VNode", "TestMovie"]),
                        properties: new Set(["id", "slugId", "title", "year"]),
                    }
                ],
                modifiedNodes: [],
                createdRelationships: [
                    {
                        type: "FRANCHISE_IS",
                        from: action1.id,
                        to: franchiseAction.id,
                        properties: {},
                    }
                ],
                deletedRelationships: [],
                deletedNodeIds: [],
            };
            assertEquals(changes, expected);
        });

        test("gives data about created VNodes and their relationship properties", async () => {
            const franchiseAction = await testGraph.runAsSystem(
                CreateMovieFranchise({slugId: "jumanji", name: "Jumanji"}),
            )
            const movieVNID = VNID();
            const action1 = await testGraph.runAsSystem(
                // We run some custom cypher code to test creating a VNode and a relationship with properties in a
                // single action, since the code path for tracking relationship property changes is different when the
                // "from" VNode is newly created vs. already existing.
                GenericCypherAction({cypher: C`
                    MATCH (mf:${MovieFranchise}), mf HAS KEY ${franchiseAction.id}
                    CREATE (m:${Movie} {id: ${movieVNID}})-[rel:${Movie.rel.FRANCHISE_IS}]->(mf)
                    SET m += ${{slugId: "jumanji-2", title: "Jumanji: The Next Level", year: C.int(2019)}}
                    SET rel.testProp1 = 1234
                    SET rel.testProp2 = 'hello'
                `, modifiedNodes: [movieVNID]}),
            );
            const changes = await testGraph.read(tx => getActionChanges(tx, action1.actionId));
            const expected: ActionChangeSet = {
                createdNodes: [
                    {
                        id: movieVNID,
                        labels: new Set(["VNode", "TestMovie"]),
                        properties: new Set(["id", "slugId", "title", "year"]),
                    }
                ],
                modifiedNodes: [],
                createdRelationships: [
                    {
                        type: "FRANCHISE_IS",
                        from: movieVNID,
                        to: franchiseAction.id,
                        properties: {
                            testProp1: 1234n,
                            testProp2: "hello",
                        },
                    }
                ],
                deletedRelationships: [],
                deletedNodeIds: [],
            };
            assertEquals(changes, expected);
        });

        test("gives data about modified VNodes and relationships", async () => {
            const franchiseAction = await testGraph.runAsSystem(
                CreateMovieFranchise({slugId: "jumanji", name: "Jumanji"}),
            )
            const movieAction = await testGraph.runAsSystem(
                CreateMovie({slugId: "temp-movie", title: "Temp Title", year: 2019}),
            );
            const movieId = movieAction.id;
            const action1 = await testGraph.runAsSystem(
                UpdateMovie({
                    key: "temp-movie",
                    slugId: "jumanji-2",
                    title: "Jumanji: The Next Level",
                    franchiseId: "jumanji",
                }),
            );
            const changes = await testGraph.read(tx => getActionChanges(tx, action1.actionId));
            const expected: ActionChangeSet = {
                createdNodes: [],
                modifiedNodes: [
                    {
                        id: movieId,
                        properties: new Set(["slugId", "title"]),
                    }
                ],
                createdRelationships: [
                    {
                        type: "FRANCHISE_IS",
                        from: movieId,
                        to: franchiseAction.id,
                        properties: {},
                    }
                ],
                deletedRelationships: [],
                deletedNodeIds: [],
            };
            assertEquals(changes, expected);
        });


        test("gives data about modified VNodes when properties are set to NULL", async () => {
            const franchiseAction = await testGraph.runAsSystem(
                CreateMovieFranchise({slugId: "jumanji", name: "Jumanji"}),
            );
            const _action0 = await testGraph.runAsSystem(
                // Add an extra property that we'll later set null:
                GenericCypherAction({cypher: C`
                    MATCH (mf:${MovieFranchise}), mf HAS KEY ${franchiseAction.id}
                    SET mf.textProperty = "hello"
                `, modifiedNodes: [franchiseAction.id]}),
            );
            const action1 = await testGraph.runAsSystem(
                // Set that property to NULL
                GenericCypherAction({cypher: C`
                    MATCH (mf:${MovieFranchise}), mf HAS KEY ${franchiseAction.id}
                    SET mf.textProperty = NULL
                `, modifiedNodes: [franchiseAction.id]}),
            );
            const changes = await testGraph.read(tx => getActionChanges(tx, action1.actionId));
            const expected: ActionChangeSet = {
                createdNodes: [],
                modifiedNodes: [
                    {
                        id: franchiseAction.id,
                        properties: new Set(["textProperty"]),
                    }
                ],
                createdRelationships: [],
                deletedRelationships: [],
                deletedNodeIds: [],
            };
            assertEquals(changes, expected);
        });

        test("gives data about modified relationship properties", async () => {
            const movieAction = await testGraph.runAsSystem(
                CreateMovie({slugId: "infinity-war", title: "Avengers: Infinity War", year: 2018}),
            );
            const rdjAction = await testGraph.runAsSystem(
                CreatePerson({slugId: "rdj", name: "Robert Downey Jr.", dateOfBirth: VD`1965-04-04`}),
            );
            const action1 = await testGraph.runAsSystem(
                ActedIn({personId: "rdj", movieId: "infinity-war", role: "Tony Stark / Iron Man"}),
            );
            const changes = await testGraph.read(tx => getActionChanges(tx, action1.actionId));
            const expected: ActionChangeSet = {
                createdNodes: [],
                modifiedNodes: [],
                createdRelationships: [
                    {
                        type: "ACTED_IN",
                        from: rdjAction.id,
                        to: movieAction.id,
                        properties: {
                            role: "Tony Stark / Iron Man",
                        },
                    }
                ],
                deletedRelationships: [],
                deletedNodeIds: [],
            };
            assertEquals(changes, expected);
        });

        test("actions are not allowed to mutate properties on a relationship; they must re-created them", async () => {
            const _movieAction = await testGraph.runAsSystem(
                CreateMovie({slugId: "infinity-war", title: "Avengers: Infinity War", year: 2018}),
            );
            const rdjAction = await testGraph.runAsSystem(
                CreatePerson({slugId: "rdj", name: "Robert Downey Jr.", dateOfBirth: VD`1965-04-04`}),
            );
            const _action0 = await testGraph.runAsSystem(
                ActedIn({personId: "rdj", movieId: "infinity-war", role: "Tony Stark / Iron Man"}),
            );
            await assertThrowsAsync(() => testGraph.runAsSystem(
                GenericCypherAction({cypher: C`
                    MATCH (p:${Person})-[rel:${Person.rel.ACTED_IN}]->(m:${Movie}), p HAS KEY ${"rdj"}, m HAS KEY ${"infinity-war"}
                    SET rel.role = "NEW ROLE"
                `, modifiedNodes: [rdjAction.id]}),
            ), undefined, "Error executing triggers");
        });

        test("gives data about deleted relationships", async () => {
            const movieAction = await testGraph.runAsSystem(
                CreateMovie({slugId: "infinity-war", title: "Avengers: Infinity War", year: 2018}),
            );
            const rdjAction = await testGraph.runAsSystem(
                CreatePerson({slugId: "rdj", name: "Robert Downey Jr.", dateOfBirth: VD`1965-04-04`}),
            );
            await testGraph.runAsSystem(
                ActedIn({personId: "rdj", movieId: "infinity-war", role: "Tony Stark / Iron Man"}),
            );
            const action1 = await testGraph.runAsSystem(
                // Remove the relationship that was just created:
                GenericCypherAction({cypher: C`
                    MATCH (p:${Person})-[rel:${Person.rel.ACTED_IN}]->(m:${Movie}), p HAS KEY ${"rdj"}, m HAS KEY ${"infinity-war"}
                    DELETE rel
                `, modifiedNodes: [rdjAction.id]}),
            );
            const changes = await testGraph.read(tx => getActionChanges(tx, action1.actionId));
            const expected: ActionChangeSet = {
                createdNodes: [],
                modifiedNodes: [],
                createdRelationships: [],
                deletedRelationships: [
                    {
                        type: "ACTED_IN",
                        from: rdjAction.id,
                        to: movieAction.id,
                        properties: {
                            role: "Tony Stark / Iron Man",
                        },
                    }
                ],
                deletedNodeIds: [],
            };
            assertEquals(changes, expected);
        });

        test("records when nodes are fully deleted", async () => {
            await testGraph.runAsSystem(
                // To make this test more complex, we'll be soft deleting and restoring a node with relationships:
                CreateMovieFranchise({slugId: "mcu", name: "Marvel Cinematic Universe"}),
            );
            const movieAction = await testGraph.runAsSystem(
                CreateMovie({slugId: "infinity-war", title: "Avengers: Infinity War", year: 2018, franchiseId: "mcu"}),
            );
            const action1 = await testGraph.runAsSystem(
                // Soft delete the movie:
                GenericCypherAction({cypher: C`
                    MATCH (m:${Movie}), m HAS KEY ${"infinity-war"}
                    MATCH (s:SlugId)-[:IDENTIFIES]->(m)
                    DETACH DELETE m
                    DETACH DELETE s
                `, modifiedNodes: [movieAction.id]}),
            );
            const changes = await testGraph.read(tx => getActionChanges(tx, action1.actionId));
            const expected: ActionChangeSet = {
                createdNodes: [],
                modifiedNodes: [],
                createdRelationships: [],
                deletedRelationships: [],
                deletedNodeIds: [movieAction.id],
            };
            assertEquals(changes, expected);
        });
    });
});
