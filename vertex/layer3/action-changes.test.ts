import { suite, test, assertRejects, assert, log, before, after, configureTestData } from "../lib/intern-tests";
import { ActedIn, CreateMovie, CreateMovieFranchise, CreatePerson, Movie, MovieFranchise, Person, testGraph, UpdateMovie, } from "../test-project";
import {
    VNID,
    getActionChanges,
    GenericCypherAction,
    VD,
} from "..";
import { C } from "../layer2/cypher-sugar";
import { ActionChangeSet } from "./action-changes";

suite(__filename, () => {

    configureTestData({isolateTestWrites: true, loadTestProjectData: false});
    
    suite("getActionChanges", () => {

        test("throws an error for an invalid action ID", async () => {
            await assertRejects(
                testGraph.read(tx => getActionChanges(tx, VNID("_foobar"))),
                "Action not found.",
            );
        });

        test("gives data about created VNodes", async () => {
            const action1 = await testGraph.runAsSystem(
                CreateMovie({slugId: "tropic-thunder", title: "Tropic Thunder", year: 2008}),
            );
            const changes = await testGraph.read(tx => getActionChanges(tx, action1.actionId));
            assert.deepStrictEqual(changes, {
                createdNodes: [
                    {
                        id: action1.id,
                        labels: new Set(["VNode", "TestMovie"]),
                        properties: {
                            id: action1.id,
                            slugId: "tropic-thunder",
                            title: "Tropic Thunder",
                            year: 2008n,  // Raw database types mean that integers are always returned as BigInt
                        }
                    }
                ],
                modifiedNodes: [],
                createdRelationships: [],
                deletedRelationships: [],
                softDeletedNodes: [],
                unDeletedNodes: [],
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
            assert.deepStrictEqual(changes, {
                createdNodes: [
                    {
                        id: action1.id,
                        labels: new Set(["VNode", "TestMovie"]),
                        properties: {
                            id: action1.id,
                            slugId: "jumanji-2",
                            title: "Jumanji: The Next Level",
                            year: 2019n,  // Raw database types mean that integers are always returned as BigInt
                        }
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
                softDeletedNodes: [],
                unDeletedNodes: [],
            });
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
                        properties: {
                            id: movieVNID,
                            slugId: "jumanji-2",
                            title: "Jumanji: The Next Level",
                            year: 2019n,  // Raw database types mean that integers are always returned as BigInt
                        }
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
                softDeletedNodes: [],
                unDeletedNodes: [],
            };
            assert.deepStrictEqual(changes, expected);
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
                        properties: {
                            slugId: {old: "temp-movie", new: "jumanji-2"},
                            title: {old: "Temp Title", new: "Jumanji: The Next Level"},
                        },
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
                softDeletedNodes: [],
                unDeletedNodes: [],
            };
            assert.deepStrictEqual(changes, expected);
        });


        test("gives data about modified VNodes when properties are set to NULL", async () => {
            const franchiseAction = await testGraph.runAsSystem(
                CreateMovieFranchise({slugId: "jumanji", name: "Jumanji"}),
            );
            const action0 = await testGraph.runAsSystem(
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
                        properties: {
                            textProperty: {old: "hello", new: null},
                        },
                    }
                ],
                createdRelationships: [],
                deletedRelationships: [],
                softDeletedNodes: [],
                unDeletedNodes: [],
            };
            assert.deepStrictEqual(changes, expected);
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
                softDeletedNodes: [],
                unDeletedNodes: [],
            };
            assert.deepStrictEqual(changes, expected);
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
                softDeletedNodes: [],
                unDeletedNodes: [],
            };
            assert.deepStrictEqual(changes, expected);
        });

        test("gives data about soft-deleted nodes, and un-deleted ones", async () => {
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
                    SET m:DeletedVNode
                    REMOVE m:VNode
                `, modifiedNodes: [movieAction.id]}),
            );
            const changes = await testGraph.read(tx => getActionChanges(tx, action1.actionId));
            const expected: ActionChangeSet = {
                createdNodes: [],
                modifiedNodes: [],
                createdRelationships: [],
                deletedRelationships: [],
                softDeletedNodes: [movieAction.id],
                unDeletedNodes: [],
            };
            assert.deepStrictEqual(changes, expected);

            // Now un-delete it:
            const action2 = await testGraph.runAsSystem(
                // Soft delete the movie:
                GenericCypherAction({cypher: C`
                    MATCH (m:DeletedVNode {id: ${movieAction.id}})
                    SET m:VNode
                    REMOVE m:DeletedVNode
                `, modifiedNodes: [movieAction.id]}),
            );
            const changes2 = await testGraph.read(tx => getActionChanges(tx, action2.actionId));
            const expected2: ActionChangeSet = {
                createdNodes: [],
                modifiedNodes: [],
                createdRelationships: [],
                deletedRelationships: [],
                softDeletedNodes: [],
                unDeletedNodes: [movieAction.id],
            };
            assert.deepStrictEqual(changes2, expected2);
        });
    });
});
