import { group, test, assertEquals, assertRejects, configureTestData } from "../lib/tests.ts";
import {
    C,
    VNodeType,
    Field,
    defaultCreateFor,
    defaultUpdateFor,
    VNodeKey,
    VDate,
    VD,
} from "../index.ts";
import { testGraph } from "../test-project/index.ts";

/** A VNodeType for use in this test group. */
class Person extends VNodeType {
    static label = "PersonAHT";  // AHT: action-helpers.test
    static readonly properties = {
        ...VNodeType.properties,
        slugId: Field.Slug,
    };
}

/** A VNodeType for use in this test group. */
class AstronomicalBody extends VNodeType {
    static label = "AstroBody";
    static readonly properties = {
        ...VNodeType.properties,
        slugId: Field.Slug,
    };
    static readonly rel = this.hasRelationshipsFromThisTo({
        // A -to-one relationship:
        ORBITS: {
            to: [this],
            cardinality: VNodeType.Rel.ToOneOrNone,
            // An optional "periodInSeconds" property:
            properties: { periodInSeconds: Field.NullOr.Float, },
        },
        // A -to-many relationship:
        VISITED_BY: { to: [Person], properties: { when: Field.Date } }
    });
}

const CreatePerson = defaultCreateFor(Person, p => p.slugId);
const UpdateAstronomicalBody = defaultUpdateFor(AstronomicalBody, ab => ab.slugId, {
    otherUpdates: async (args: {orbits?: {key: string|null, periodInSeconds?: number|null}, visitedBy?: {key: string, when: VDate}[]}, tx, nodeSnapshot) => {
        if (args.orbits !== undefined) {
            await tx.updateToOneRelationship({
                from: [AstronomicalBody, nodeSnapshot.id],
                rel: AstronomicalBody.rel.ORBITS,
                to: args.orbits,
            });
        }

        if (args.visitedBy !== undefined) {
            await tx.updateToManyRelationship({
                from: [AstronomicalBody, nodeSnapshot.id],
                rel: AstronomicalBody.rel.VISITED_BY,
                to: args.visitedBy,
            });
        }

        return { additionalModifiedNodes: []};
    },
})
const CreateAstronomicalBody = defaultCreateFor(AstronomicalBody, ab => ab.slugId, UpdateAstronomicalBody);

/** For test assertions, get the astronomical body that the specified one orbits around */
const getOrbit = async (key: VNodeKey): Promise<string|null> => {
    const dbResult = await testGraph.read(tx => tx.query(C`
        MATCH (ab:${AstronomicalBody}), ab HAS KEY ${key}
        MATCH (ab)-[:${AstronomicalBody.rel.ORBITS}]->(x:${AstronomicalBody})
    `.RETURN({x: Field.VNode(AstronomicalBody)})));
    return dbResult.length === 1 ? dbResult[0].x.slugId : null;
};
const getOrbitAndPeriod = async (key: VNodeKey): Promise<{key: string, periodInSeconds: number|null}|null> => {
    const dbResult = await testGraph.read(tx => tx.query(C`
        MATCH (ab:${AstronomicalBody}), ab HAS KEY ${key}
        MATCH (ab)-[rel:${AstronomicalBody.rel.ORBITS}]->(x:${AstronomicalBody})
    `.RETURN({x: Field.VNode(AstronomicalBody), rel: Field.Relationship})));
    if (dbResult.length === 1) {
        return {key: dbResult[0].x.slugId, periodInSeconds: dbResult[0].rel.properties.periodInSeconds}
    } else {
        return null;
    }
};
/** For test assertions, get the people that have visited the astronomical body */
const getVisitors = async (key: VNodeKey): Promise<{key: string, when: VDate}[]> => {
    return await testGraph.read(tx => tx.query(C`
        MATCH (ab:${AstronomicalBody}), ab HAS KEY ${key}
        MATCH (ab)-[rel:${AstronomicalBody.rel.VISITED_BY}]->(p:${Person})
        RETURN p.slugId as key, rel.when as when ORDER BY rel.when ASC, p.slugId ASC
    `.givesShape({"key": Field.Slug, "when": Field.Date})));
};

const earthOrbitsTheSun = {key: "sun", periodInSeconds: 3.1558149e7};

group(import.meta, () => {

    configureTestData({isolateTestWrites: true, loadTestProjectData: false, additionalVNodeTypes: [
        AstronomicalBody,
        Person,
    ]});

    group("updateToOneRelationship", () => {

        test("can set a -to-one relationship", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({slugId: "sun"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({slugId: "earth", orbits: {key: "sun"}}));

            assertEquals(await getOrbit("earth"), "sun");
        });
        test("can set a -to-one relationship with properties", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({slugId: "sun"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({slugId: "earth", orbits: earthOrbitsTheSun}));

            assertEquals(await getOrbitAndPeriod("earth"), earthOrbitsTheSun);
        });

        test("can change a -to-one relationship", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({slugId: "sun"}), CreateAstronomicalBody({slugId: "proxima-centauri"}));

            // Wrongly set the earth as orbiting Proxima Centauri
            await testGraph.runAsSystem(CreateAstronomicalBody({slugId: "earth", orbits: {key: "proxima-centauri"}}));
            assertEquals(await getOrbit("earth"), "proxima-centauri");
            // Now change it:
            await testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: {key: "sun"}}));
            assertEquals(await getOrbit("earth"), "sun");
        });

        test("can clear a -to-one relationship", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({slugId: "sun"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({slugId: "earth", orbits: {key: "sun"}}));
            assertEquals(await getOrbit("earth"), "sun");
            // Now change it:
            await testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: {key: null}}));
            assertEquals(await getOrbit("earth"), null);
        });

        test("gives an error with an invalid ID", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({slugId: "earth"}));
            await assertRejects(
                () => testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: {key: "foobar"}})),
                `Cannot change AstronomicalBody relationship ORBITS to "foobar" - target not found.`,
            );
        });

        test("gives an error with a node of a different type", async () => {
            await testGraph.runAsSystem(CreatePerson({slugId: "Jamie"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({slugId: "earth"}));
            await assertRejects(
                () => testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: {key: "Jamie"}})),
                `Cannot change AstronomicalBody relationship ORBITS to "Jamie" - target not found.`,
            );
        });
    });

    group("updateToManyRelationship", () => {

        const neilArmstrongApollo11 = Object.freeze({key: "neil-armstrong", when: VD`1969-07-20`});
        const buzzAldrinApollo11 = Object.freeze({key: "buzz-aldrin", when: VD`1969-07-20`});
        const jimLovellApollo8 = Object.freeze({key: "jim-lovell", when: VD`1968-12-24`});
        const jimLovellApollo13 = Object.freeze({key: "jim-lovell", when: VD`1970-04-15`});

        test("can set a -to-many relationship", async () => {
            await testGraph.runAsSystem(CreatePerson({slugId: "neil-armstrong"}), CreatePerson({slugId: "buzz-aldrin"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({
                slugId: "moon",
                visitedBy: [neilArmstrongApollo11, buzzAldrinApollo11],
            }));
            
            assertEquals(
                await getVisitors("moon"),
                // They visited on the same date so get sorted into alphabetical order:
                [buzzAldrinApollo11, neilArmstrongApollo11],
            );
        });

        test("can change a -to-many relationship", async () => {
            await testGraph.runAsSystem(CreatePerson({slugId: "neil-armstrong"}), CreatePerson({slugId: "buzz-aldrin"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({
                slugId: "moon",
                visitedBy: [],
            }));
            assertEquals(await getVisitors("moon"), []);

            // Change visited by:
            await testGraph.runAsSystem(UpdateAstronomicalBody({key: "moon",
                visitedBy: [neilArmstrongApollo11, buzzAldrinApollo11]
            }));
            assertEquals(
                await getVisitors("moon"),
                // They visited on the same date so get sorted into alphabetical order:
                [buzzAldrinApollo11, neilArmstrongApollo11],
            );

            // Change again, removing an entry:
            await testGraph.runAsSystem(UpdateAstronomicalBody({key: "moon",
                visitedBy: [neilArmstrongApollo11]
            }));
            assertEquals(
                await getVisitors("moon"),
                [neilArmstrongApollo11],
            );
        });

        test("can create multiple relationships to the same node, with different properties", async () => {
            await testGraph.runAsSystem(
                CreatePerson({slugId: "jim-lovell"}),
                CreatePerson({slugId: "neil-armstrong"}),
                CreatePerson({slugId: "buzz-aldrin"}),
            );
            await testGraph.runAsSystem(CreateAstronomicalBody({
                slugId: "moon",
                visitedBy: [
                    jimLovellApollo8,
                    neilArmstrongApollo11,
                    jimLovellApollo13,  // Jim Lovell is the same node as above in Apollo8, but with a different property on the relationship
                ],
            }));
            assertEquals(await getVisitors("moon"), [
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
            assertEquals(await getVisitors("moon"), [
                jimLovellApollo8,
                buzzAldrinApollo11,
                neilArmstrongApollo11,
                jimLovellApollo13,
            ]);
        });

        test("gives an error with an invalid ID", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({slugId: "moon"}));
            await assertRejects(
                () => testGraph.runAsSystem(UpdateAstronomicalBody({key: "moon", visitedBy: [{key: "nobody", when: VD`1970-01-01`}]})),
                `Cannot set VISITED_BY relationship to VNode with key "nobody" which doesn't exist or is the wrong type.`,
            );
        });

        test("gives an error with a node of a different type", async () => {
            const notAPersonKey = "alz-budrin";
            await testGraph.runAsSystem(CreateAstronomicalBody({slugId: notAPersonKey}));
            await testGraph.runAsSystem(CreateAstronomicalBody({slugId: "moon"}));
            await assertRejects(
                () => testGraph.runAsSystem(UpdateAstronomicalBody({key: "moon", visitedBy: [
                    {key: notAPersonKey, when: VD`1970-01-01`}
                ]})),
                `Cannot set VISITED_BY relationship to VNode with key "${notAPersonKey}" which doesn't exist or is the wrong type.`,
            );
        });
    });
});
