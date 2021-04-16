import Joi from "@hapi/joi";
import { suite, test, assertRejects, configureTestData, assert, log, before, after } from "../lib/intern-tests";
import {
    C,
    UUID,
    VNodeType,
    ShortIdProperty,
} from "..";
import { defaultCreateFor, defaultUpdateActionFor } from "./action-templates";
import { testGraph } from "../test-project";
import { AssertEqual, AssertNotEqual, checkType } from "../lib/ts-utils";

/** A VNodeType for use in this test suite. */
@VNodeType.declare
class AstronomicalBody extends VNodeType {
    static label = "AstroBodyAT";  // AT = Action Templates test
    static readonly properties = {
        ...VNodeType.properties,
        shortId: ShortIdProperty,
        mass: Joi.number().required(),
    };
}

@VNodeType.declare
class Planet extends AstronomicalBody {
    static readonly label = "PlanetAT";  // AT = Action Templates test
    static readonly properties = {
        ...AstronomicalBody.properties,
        numberOfMoons: Joi.number(),
    };
    static readonly rel = {
        /** This planet has moon(s) */
        HAS_MOON: { to: [AstronomicalBody] },
    };
}

const CreateAstroBody = defaultCreateFor(AstronomicalBody, ab => ab.shortId.mass);
const UpdatePlanet = defaultUpdateActionFor(Planet, p => p.shortId.mass.numberOfMoons, {
    otherUpdates: async (args: {addMoon?: string, deleteMoon?: string}, tx, nodeSnapshot, changes) => {
        const previousValues: Partial<typeof args> = {};
        if (args.deleteMoon !== undefined) {
            await tx.queryOne(C`
                MATCH (p:${Planet} {uuid: ${nodeSnapshot.uuid}})
                MATCH (p)-[rel:${Planet.rel.HAS_MOON}]->(moon:${AstronomicalBody}), moon HAS KEY ${args.deleteMoon}
                DELETE rel
            `.RETURN({}));
            previousValues.addMoon = args.deleteMoon;
        }
        if (args.addMoon !== undefined) {
            await tx.queryOne(C`
                MATCH (p:${Planet} {uuid: ${nodeSnapshot.uuid}})
                MATCH (moon:${AstronomicalBody}), moon HAS KEY ${args.addMoon}
                MERGE (p)-[:${Planet.rel.HAS_MOON}]->(moon)
            `.RETURN({}));
            previousValues.deleteMoon = args.addMoon;
        }
        return { additionalModifiedNodes: [], previousValues };
    },
});
const CreatePlanet = defaultCreateFor(Planet, p => p.shortId.mass, UpdatePlanet);


suite(__filename, () => {

    configureTestData({isolateTestWrites: true, loadTestProjectData: false});

    suite("defaultCreateFor", () => {

        test("has a statically typed 'type'", () => {
            checkType<AssertEqual<typeof CreatePlanet.type, "CreatePlanetAT">>();
            checkType<AssertNotEqual<typeof CreatePlanet.type, "otherString">>();
        })

        test("can create a VNode", async () => {
            const result = await testGraph.runAsSystem(
                CreateAstroBody({shortId: "Ceres", mass: 15}),
            );
            assert.isString(result.uuid);
            // Get and check the new node in various ways:
            const checkCeres = (p: {uuid: UUID, shortId: string, mass: number, }): void => {
                assert.equal(p.uuid, result.uuid);
                assert.equal(p.shortId, "Ceres");
                assert.equal(p.mass, 15);
            };
            // By its shortId:
            const r1 = await testGraph.read(tx => tx.queryOne(C`MATCH (p:${AstronomicalBody}), p HAS KEY ${"Ceres"}`.RETURN({p: AstronomicalBody})));
            checkCeres(r1.p);
            // By its UUID:
            const r2 = await testGraph.read(tx => tx.queryOne(C`MATCH (p:${AstronomicalBody}), p HAS KEY ${result.uuid}`.RETURN({p: AstronomicalBody})));
            checkCeres(r2.p);
            // Using pull()
            const p3 = await testGraph.pullOne(AstronomicalBody, p => p.allProps, {key: result.uuid});
            checkCeres(p3);
        });

        test("gives VNodes unique, valid UUIDs", async () => {
            const createCeres = await testGraph.runAsSystem(
                CreateAstroBody({shortId: "Ceres", mass: 1801}),
            );
            const uuidCeres = createCeres.uuid;
            assert.isString(uuidCeres);
            assert.equal(uuidCeres, UUID(uuidCeres));  // UUID must be in standard form

            const createPluto = await testGraph.runAsSystem(
                CreateAstroBody({shortId: "pluto", mass: 1930}),
            );
            const uuidPluto = createPluto.uuid;
            assert.isString(uuidPluto);
            assert.equal(uuidPluto, UUID(uuidPluto));

            assert.notEqual(uuidCeres, uuidPluto);
        });

        test("doesn't allow creating invalid VNodes", async () => {
            // There are overlapping tests in action-runner.test.ts, but that's OK.
            await assertRejects(testGraph.runAsSystem(
                CreateAstroBody({shortId: 17 as any, mass: 15}),
            ), `"shortId" must be a string`);
            // shortId must be short:
            await assertRejects(testGraph.runAsSystem(
                CreateAstroBody({shortId: "this-is-a-very-long-short-ID-and-will-not-be-allowed", mass: 123}),
            ), `"shortId"`);
            // required props missing:
            await assertRejects(testGraph.runAsSystem(
                CreateAstroBody({} as any),
            ), `"shortId" is required`);
        });

        test("sets all required labels for VNodeTypes with inherited labels", async () => {
            const {uuid} = await testGraph.runAsSystem(
                CreatePlanet({shortId: "Earth", mass: 9000})
            );
            const result = await testGraph.read(tx => tx.query(C`MATCH (p:${Planet} {uuid: ${uuid}})`.RETURN({"labels(p)": {list: "string"} })));
            assert.sameMembers(result[0]["labels(p)"], ["PlanetAT", "AstroBodyAT", "VNode"]);
        })

        test("it can set properties via the Update action", async () => {
            await testGraph.runAsSystem(
                CreateAstroBody({shortId: "Io", mass: 1}),
                CreatePlanet({shortId: "Jupiter", mass: 99999, numberOfMoons: 79, addMoon: "Io"}),
            );
            // Note that we only call the CreatePlanet action (not UpdatePlanet), and the logic for how to set the
            // moon relationship from the "addMoon" argument is only defined in UpdatePlanet, but this still works,
            // because the CreatePlanet action uses UpdatePlanet internally:
            const result = await testGraph.read(tx => tx.queryOne(C`
                MATCH (j:${Planet}), j HAS KEY ${"Jupiter"}
                MATCH (j)-[:${Planet.rel.HAS_MOON}]->(moon:${AstronomicalBody})
            `.RETURN({moon: AstronomicalBody, j: Planet})));
            assert.equal(result.j.shortId, "Jupiter");
            assert.equal(result.j.numberOfMoons, 79);
            assert.equal(result.moon.shortId, "Io");
        });

        test("it can be undone", async () => {
            await testGraph.runAsSystem(
                CreateAstroBody({shortId: "Io", mass: 1})
            );
            // Create a planet - this is the action that we will soon undo:
            const createResult = await testGraph.runAsSystem(
                CreatePlanet({shortId: "Jupiter", mass: 99999, numberOfMoons: 79, addMoon: "Io"}),
            );
            // Check that it was created:
            const findJupiter = C`MATCH (j:${Planet}), j HAS KEY ${"Jupiter"}`.RETURN({j: Planet});
            const orig = await testGraph.read(tx => tx.query(findJupiter));
            assert.equal(orig.length, 1);
            assert.equal(orig[0].j.shortId, "Jupiter");
            // Now undo it:
            await testGraph.undoAction({actionUuid: createResult.actionUuid, asUserId: undefined});
            // Now make sure it's gone:
            const postDelete = await testGraph.read(tx => tx.query(findJupiter));
            assert.equal(postDelete.length, 0);
        });
    });

    suite("defaultUpdateActionFor", () => {

        // TODO - test changing data

        // TODO - test that UUID cannot be changed

        // TODO - test retrieving by old and new shortId

        // TODO - test other updates, e.g. movie franchise
    });
});
