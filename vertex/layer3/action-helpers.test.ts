import Joi from "@hapi/joi";
import { suite, test, assertRejects, configureTestData, assert, log, before, after } from "../lib/intern-tests";
import {
    C,
    VNodeType,
    ShortIdProperty,
    defaultCreateFor,
    defaultUpdateActionFor,
    UUID,
    updateToOneRelationship,
    updateToManyRelationship,
    registerVNodeType,
    unregisterVNodeType,
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
        ORBITS: { to: [AstronomicalBody], properties: { periodInSeconds: Joi.number().required() } },
        // A -to-many relationship:
        VISITED_BY: { to: [Person], properties: { when: Joi.date() } }
    });
}

const CreatePerson = defaultCreateFor(Person, p => p.shortId);
const UpdateAstronomicalBody = defaultUpdateActionFor(AstronomicalBody, ab => ab.shortId, {
    otherUpdates: async (args: {orbits?: UUID|string|null, visitedBy?: {key: string, when: string}[]}, tx, nodeSnapshot) => {
        const previousValues: Partial<typeof args> = {};
        if (args.orbits !== undefined) {
            const {previousUuid} = await updateToOneRelationship({
                from: [AstronomicalBody, nodeSnapshot.uuid],
                rel: AstronomicalBody.rel.ORBITS,
                tx,
                toKey: args.orbits,
                allowNull: true,
                // TODO: periodInSeconds
            });
            previousValues.orbits = previousUuid;
        }

        if (args.visitedBy !== undefined) {
            const {previousRelationshipsList} = await updateToManyRelationship({
                from: [AstronomicalBody, nodeSnapshot.uuid],
                rel: AstronomicalBody.rel.VISITED_BY,
                tx,
                newTargets: args.visitedBy,
            });
            previousValues.visitedBy = previousRelationshipsList as any;
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
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "earth", orbits: "sun"}));

            assert.equal(await getOrbit("earth"), "sun");
        });

        test("can change a -to-one relationship", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "sun"}), CreateAstronomicalBody({shortId: "proxima-centauri"}));

            // Wrongly set the earth as orbiting Proxima Centauri
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "earth", orbits: "proxima-centauri"}));
            assert.equal(await getOrbit("earth"), "proxima-centauri");
            // Now change it:
            await testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: "sun"}));
            assert.equal(await getOrbit("earth"), "sun");
        });

        test("can clear a -to-one relationship", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "sun"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "earth", orbits: "sun"}));
            assert.equal(await getOrbit("earth"), "sun");
            // Now change it:
            await testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: null}));
            assert.equal(await getOrbit("earth"), null);
        });

        test("can be undone", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "sun"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "earth"}));
            const action1 = await testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: "sun"}));
            const action2 = await testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: null}));
            assert.equal(await getOrbit("earth"), null);
            // Undo action 2:
            await testGraph.undoAction({actionUuid: action2.actionUuid, asUserId: undefined});
            assert.equal(await getOrbit("earth"), "sun");
            // Undo action 1:
            await testGraph.undoAction({actionUuid: action1.actionUuid, asUserId: undefined});
            assert.equal(await getOrbit("earth"), null);
        });

        test("gives an error with an invalid ID", async () => {
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "earth"}));
            await assertRejects(
                testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: "foobar"})),
                `Cannot change AstronomicalBody relationship ORBITS to "foobar" - target not found.`,
            );
        });

        test("gives an error with a node of a different type", async () => {
            await testGraph.runAsSystem(CreatePerson({shortId: "Jamie"}));
            await testGraph.runAsSystem(CreateAstronomicalBody({shortId: "earth"}));
            await assertRejects(
                testGraph.runAsSystem(UpdateAstronomicalBody({key: "earth", orbits: "Jamie"})),
                `Cannot change AstronomicalBody relationship ORBITS to "Jamie" - target not found.`,
            );
        });
    });
});
