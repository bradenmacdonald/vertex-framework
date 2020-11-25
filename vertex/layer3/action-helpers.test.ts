import Joi from "@hapi/joi";
import { suite, test, assertRejects, configureTestData, assert, log, before, after } from "../lib/intern-tests";
import {
    C,
    VNodeType,
    ShortIdProperty,
    defaultCreateFor,
    defaultUpdateActionFor,
    UUID,
    registerVNodeType,
    unregisterVNodeType,
    VNodeRelationship,
} from "..";
import { testGraph } from "../test-project";

/** A VNodeType for use in this test suite. */
class Person extends VNodeType {
    static label = "PersonAHT";  // AHT: action-helpers.test
    static readonly properties = {
        ...VNodeType.properties,
        shortId: ShortIdProperty,
    };
}

/** A VNodeType for use in this test suite. */
class AstronomicalBody extends VNodeType {
    static label = "AstroBodyAHT";  // AHT: action-helpers.test
    static readonly properties = {
        ...VNodeType.properties,
        shortId: ShortIdProperty,
    };
    static readonly rel = AstronomicalBody.hasRelationshipsFromThisTo({
        // A -to-one relationship:
        ORBITS: {
            to: [AstronomicalBody],
            cardinality: VNodeRelationship.Cardinality.ToOneOrNone,
            // An optional "periodInSeconds" property:
            properties: { periodInSeconds: Joi.number(), },
        },
        // A -to-many relationship:
        VISITED_BY: { to: [Person], properties: { when: Joi.date() } }
    });
}

const CreatePerson = defaultCreateFor(Person, p => p.shortId);
const UpdateAstronomicalBody = defaultUpdateActionFor(AstronomicalBody, ab => ab.shortId, {
    otherUpdates: async (args: {orbits?: {key: string|null, periodInSeconds?: number}, visitedBy?: {key: string, when: string}[]}, tx, nodeSnapshot) => {
        const previousValues: Partial<typeof args> = {};
        if (args.orbits !== undefined) {
            const {prevTo} = await tx.updateToOneRelationship({
                from: [AstronomicalBody, nodeSnapshot.uuid],
                rel: AstronomicalBody.rel.ORBITS,
                to: args.orbits,
            });
            previousValues.orbits = prevTo;
        }

        if (args.visitedBy !== undefined) {
            const {prevTo} = await tx.updateToManyRelationship({
                from: [AstronomicalBody, nodeSnapshot.uuid],
                rel: AstronomicalBody.rel.VISITED_BY,
                to: args.visitedBy,
            });
            previousValues.visitedBy = prevTo as any;
        }

        return { previousValues, additionalModifiedNodes: []};
    },
})
const CreateAstronomicalBody = defaultCreateFor(AstronomicalBody, ab => ab.shortId, UpdateAstronomicalBody);

/** For test assertions, get the astronomical body that the specified one orbits around */
const getOrbit = async (key: UUID|string): Promise<string|null> => {
    const dbResult = await testGraph.read(tx => tx.query(C`
        MATCH (ab:${AstronomicalBody}), ab HAS KEY ${key}
        MATCH (ab)-[:${AstronomicalBody.rel.ORBITS}]->(x:${AstronomicalBody})
    `.RETURN({"x": AstronomicalBody})));
    return dbResult.length === 1 ? dbResult[0].x.shortId : null;
};
const getOrbitAndPeriod = async (key: UUID|string): Promise<{key: string, periodInSeconds: number|null}|null> => {
    const dbResult = await testGraph.read(tx => tx.query(C`
        MATCH (ab:${AstronomicalBody}), ab HAS KEY ${key}
        MATCH (ab)-[rel:${AstronomicalBody.rel.ORBITS}]->(x:${AstronomicalBody})
    `.RETURN({x: AstronomicalBody, rel: "any"})));
    if (dbResult.length === 1) {
        return {key: dbResult[0].x.shortId, periodInSeconds: dbResult[0].rel.properties.periodInSeconds}
    } else {
        return null;
    }
};
/** For test assertions, get the people that have visited the astronomical body */
const getVisitors = async (key: UUID|string): Promise<{key: string, when: string}[]> => {
    return await testGraph.read(tx => tx.query(C`
        MATCH (ab:${AstronomicalBody}), ab HAS KEY ${key}
        MATCH (ab)-[rel:${AstronomicalBody.rel.VISITED_BY}]->(p:${Person})
        RETURN p.shortId as key, rel.when as when ORDER BY rel.when ASC, p.shortId ASC
    `.givesShape({"key": "string", "when": "string"})));
};

const earthOrbitsTheSun = {key: "sun", periodInSeconds: 3.1558149e7};

suite("action-helpers", () => {

    configureTestData({isolateTestWrites: true, loadTestProjectData: false});
    before(() => {
        registerVNodeType(Person);
        registerVNodeType(AstronomicalBody);
    });

    after(() => {
        unregisterVNodeType(Person);
        unregisterVNodeType(AstronomicalBody);
    });


    suite("updateToOneRelationship", () => {

        test("can set a -to-one relationship", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "sun"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "earth", orbits: {key: "sun"}}));

            assert.equal(await getOrbit("earth"), "sun");
        });
        test("can set a -to-one relationship with properties", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "sun"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "earth", orbits: earthOrbitsTheSun}));

            assert.deepStrictEqual(await getOrbitAndPeriod("earth"), earthOrbitsTheSun);
        });

        test("can change a -to-one relationship", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "sun"}), CreateAstronomicalBody({shortId: "proxima-centauri"}));

            // Wrongly set the earth as orbiting Proxima Centauri
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "earth", orbits: {key: "proxima-centauri"}}));
            assert.equal(await getOrbit("earth"), "proxima-centauri");
            // Now change it:
            await testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: {key: "sun"}}));
            assert.equal(await getOrbit("earth"), "sun");
        });

        test("can clear a -to-one relationship", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "sun"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "earth", orbits: {key: "sun"}}));
            assert.equal(await getOrbit("earth"), "sun");
            // Now change it:
            await testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: {key: null}}));
            assert.equal(await getOrbit("earth"), null);
        });

        test("can be undone", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "sun"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "earth"}));
            const action1 = await testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: earthOrbitsTheSun}));
            const action2 = await testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: {key: null}}));
            assert.equal(await getOrbit("earth"), null);
            // Undo action 2:
            await testGraph.undoAction({actionUuid: action2.actionUuid, asUserId: undefined});
            assert.deepStrictEqual(await getOrbitAndPeriod("earth"), earthOrbitsTheSun);
            // Undo action 1:
            await testGraph.undoAction({actionUuid: action1.actionUuid, asUserId: undefined});
            assert.equal(await getOrbit("earth"), null);
        });

        test("gives an error with an invalid ID", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "earth"}));
            await assertRejects(
                testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: {key: "foobar"}})),
                `Cannot change AstronomicalBody relationship ORBITS to "foobar" - target not found.`,
            );
        });

        test("gives an error with a node of a different type", async () => {
            await testGraph.runAsSystem(CreatePerson({shortId: "Jamie"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "earth"}));
            await assertRejects(
                testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: {key: "Jamie"}})),
                `Cannot change AstronomicalBody relationship ORBITS to "Jamie" - target not found.`,
            );
        });
    });

    suite("updateToManyRelationship", () => {

        const neilArmstrongApollo11 = Object.freeze({key: "neil-armstrong", when: "1969-07-20"});
        const buzzAldrinApollo11 = Object.freeze({key: "buzz-aldrin", when: "1969-07-20"});
        const jimLovellApollo8 = Object.freeze({key: "jim-lovell", when: "1968-12-24"});
        const jimLovellApollo13 = Object.freeze({key: "jim-lovell", when: "1970-04-15"});

        test("can set a -to-many relationship", async () => {
            await testGraph.runAsSystem(CreatePerson({shortId: "neil-armstrong"}), CreatePerson({shortId: "buzz-aldrin"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({
                shortId: "moon",
                visitedBy: [neilArmstrongApollo11, buzzAldrinApollo11],
            }));
            
            assert.deepStrictEqual(
                await getVisitors("moon"),
                // They visited on the same date so get sorted into alphabetical order:
                [buzzAldrinApollo11, neilArmstrongApollo11],
            );
        });

        test("can change a -to-many relationship", async () => {
            await testGraph.runAsSystem(CreatePerson({shortId: "neil-armstrong"}), CreatePerson({shortId: "buzz-aldrin"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({
                shortId: "moon",
                visitedBy: [],
            }));
            assert.deepStrictEqual(await getVisitors("moon"), []);

            // Change visited by:
            await testGraph.runAsSystem(UpdateAstronomicalBody({key: "moon",
                visitedBy: [neilArmstrongApollo11, buzzAldrinApollo11]
            }));
            assert.deepStrictEqual(
                await getVisitors("moon"),
                // They visited on the same date so get sorted into alphabetical order:
                [buzzAldrinApollo11, neilArmstrongApollo11],
            );

            // Change again, removing an entry:
            await testGraph.runAsSystem(UpdateAstronomicalBody({key: "moon",
                visitedBy: [neilArmstrongApollo11]
            }));
            assert.deepStrictEqual(
                await getVisitors("moon"),
                [neilArmstrongApollo11],
            );
        });

        test("can create multiple relationships to the same node, with different properties", async () => {
            await testGraph.runAsSystem(
                CreatePerson({shortId: "jim-lovell"}),
                CreatePerson({shortId: "neil-armstrong"}),
                CreatePerson({shortId: "buzz-aldrin"}),
            );
            await testGraph.runAsSystem(CreateAstronomicalBody({
                shortId: "moon",
                visitedBy: [
                    jimLovellApollo8,
                    neilArmstrongApollo11,
                    jimLovellApollo13,  // Jim Lovell is the same node as above in Apollo8, but with a different property on the relationship
                ],
            }));
            assert.deepStrictEqual(await getVisitors("moon"), [
                jimLovellApollo8,
                neilArmstrongApollo11,
                jimLovellApollo13,
            ]);

            // Minor change - add Buzz Aldrin:
            await testGraph.runAsSystem(UpdateAstronomicalBody({key: "moon",
                visitedBy: [
                    jimLovellApollo8,
                    buzzAldrinApollo11,
                    neilArmstrongApollo11,
                    jimLovellApollo13,
                ],
            }));
            assert.deepStrictEqual(await getVisitors("moon"), [
                jimLovellApollo8,
                buzzAldrinApollo11,
                neilArmstrongApollo11,
                jimLovellApollo13,
            ]);
        });

        test("can be undone", async () => {
            await testGraph.runAsSystem(
                CreatePerson({shortId: "jim-lovell"}),
                CreatePerson({shortId: "neil-armstrong"}),
                CreateAstronomicalBody({shortId: "moon"}),
            );
            const action1 = await testGraph.runAsSystem(UpdateAstronomicalBody({key: "moon",
            visitedBy: [
                    jimLovellApollo8,
                    neilArmstrongApollo11,
                    jimLovellApollo13,
                ],
            }));
            // Now remove Neil Armstrong:
            const action2 = await testGraph.runAsSystem(UpdateAstronomicalBody({key: "moon",
                visitedBy: [
                    jimLovellApollo8,
                    jimLovellApollo13,
                ],
            }));
            // Now undo each action in turn:
            await testGraph.undoAction({actionUuid: action2.actionUuid, asUserId: undefined});
            assert.deepStrictEqual(await getVisitors("moon"), [
                jimLovellApollo8,
                neilArmstrongApollo11,
                jimLovellApollo13,
            ]);
            await testGraph.undoAction({actionUuid: action1.actionUuid, asUserId: undefined});
            assert.deepStrictEqual(await getVisitors("moon"), []);
        });

        test("gives an error with an invalid ID", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "moon"}));
            await assertRejects(
                testGraph.runAsSystem(UpdateAstronomicalBody({key: "moon", visitedBy: [{key: "nobody", when: "1970-01-01"}]})),
                `Cannot set VISITED_BY relationship to VNode with key "nobody" which doesn't exist or is the wrong type.`,
            );
        });

        test("gives an error with a node of a different type", async () => {
            const notAPersonKey = "alz-budrin";
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: notAPersonKey}));
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "moon"}));
            await assertRejects(
                testGraph.runAsSystem(UpdateAstronomicalBody({key: "moon", visitedBy: [
                    {key: notAPersonKey, when: "1970-01-01"}
                ]})),
                `Cannot set VISITED_BY relationship to VNode with key "${notAPersonKey}" which doesn't exist or is the wrong type.`,
            );
        });
    });
});
