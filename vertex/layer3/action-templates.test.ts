import { suite, test, assertRejects, configureTestData, assert, log, before, after } from "../lib/intern-tests";
import {
    C,
    VNID,
    VNodeType,
    Field,
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
        slugId: Field.Slug,
        mass: Field.Float,
    };
}

@VNodeType.declare
class Planet extends AstronomicalBody {
    static readonly label = "PlanetAT";  // AT = Action Templates test
    static readonly properties = {
        ...AstronomicalBody.properties,
        numberOfMoons: Field.Int.OrNull,
    };
    static readonly rel = {
        /** This planet has moon(s) */
        HAS_MOON: { to: [AstronomicalBody] },
    };
}

const CreateAstroBody = defaultCreateFor(AstronomicalBody, ab => ab.slugId.mass);
const UpdatePlanet = defaultUpdateActionFor(Planet, p => p.slugId.mass.numberOfMoons, {
    otherUpdates: async (args: {addMoon?: string, deleteMoon?: string}, tx, nodeSnapshot, changes) => {
        const previousValues: Partial<typeof args> = {};
        if (args.deleteMoon !== undefined) {
            await tx.queryOne(C`
                MATCH (p:${Planet} {id: ${nodeSnapshot.id}})
                MATCH (p)-[rel:${Planet.rel.HAS_MOON}]->(moon:${AstronomicalBody}), moon HAS KEY ${args.deleteMoon}
                DELETE rel
            `.RETURN({}));
            previousValues.addMoon = args.deleteMoon;
        }
        if (args.addMoon !== undefined) {
            await tx.queryOne(C`
                MATCH (p:${Planet} {id: ${nodeSnapshot.id}})
                MATCH (moon:${AstronomicalBody}), moon HAS KEY ${args.addMoon}
                MERGE (p)-[:${Planet.rel.HAS_MOON}]->(moon)
            `.RETURN({}));
            previousValues.deleteMoon = args.addMoon;
        }
        return { additionalModifiedNodes: [], previousValues };
    },
});
const CreatePlanet = defaultCreateFor(Planet, p => p.slugId.mass, UpdatePlanet);


suite(__filename, () => {

    configureTestData({isolateTestWrites: true, loadTestProjectData: false});

    suite("defaultCreateFor", () => {

        test("has a statically typed 'type'", () => {
            checkType<AssertEqual<typeof CreatePlanet.type, "CreatePlanetAT">>();
            checkType<AssertNotEqual<typeof CreatePlanet.type, "otherString">>();
        })

        test("can create a VNode", async () => {
            const result = await testGraph.runAsSystem(
                CreateAstroBody({slugId: "Ceres", mass: 15}),
            );
            assert.isString(result.id);
            // Get and check the new node in various ways:
            const checkCeres = (p: {id: VNID, slugId: string, mass: number, }): void => {
                assert.equal(p.id, result.id);
                assert.equal(p.slugId, "Ceres");
                assert.equal(p.mass, 15);
            };
            // By its slugId:
            const r1 = await testGraph.read(tx => tx.queryOne(C`MATCH (p:${AstronomicalBody}), p HAS KEY ${"Ceres"}`.RETURN({p: AstronomicalBody})));
            checkCeres(r1.p);
            // By its VNID:
            const r2 = await testGraph.read(tx => tx.queryOne(C`MATCH (p:${AstronomicalBody}), p HAS KEY ${result.id}`.RETURN({p: AstronomicalBody})));
            checkCeres(r2.p);
            // Using pull()
            const p3 = await testGraph.pullOne(AstronomicalBody, p => p.allProps, {key: result.id});
            checkCeres(p3);
        });

        test("gives VNodes unique, valid VNIDs", async () => {
            const createCeres = await testGraph.runAsSystem(
                CreateAstroBody({slugId: "Ceres", mass: 1801}),
            );
            const ceresId = createCeres.id;
            assert.isString(ceresId);
            assert.equal(ceresId, VNID(ceresId));  // VNID must be in standard form

            const createPluto = await testGraph.runAsSystem(
                CreateAstroBody({slugId: "pluto", mass: 1930}),
            );
            const plutoId = createPluto.id;
            assert.isString(plutoId);
            assert.equal(plutoId, VNID(plutoId));

            assert.notEqual(ceresId, plutoId);
        });

        test("doesn't allow creating invalid VNodes", async () => {
            // There are overlapping tests in action-runner.test.ts, but that's OK.
            await assertRejects(testGraph.runAsSystem(
                CreateAstroBody({slugId: 17 as any, mass: 15}),
            ), `"slugId" must be a string`);
            // slugId cannot contain spaces:
            await assertRejects(testGraph.runAsSystem(
                CreateAstroBody({slugId: "this slugId has spaces", mass: 123}),
            ), `"slugId"`);
            // required props missing:
            await assertRejects(testGraph.runAsSystem(
                CreateAstroBody({} as any),
            ), `"slugId" must be a string. "mass" must be a number`);
        });

        test("sets all required labels for VNodeTypes with inherited labels", async () => {
            const {id} = await testGraph.runAsSystem(
                CreatePlanet({slugId: "Earth", mass: 9000})
            );
            const result = await testGraph.read(tx => tx.query(C`MATCH (p:${Planet} {id: ${id}})`.RETURN({"labels(p)": {list: "string"} })));
            assert.sameMembers(result[0]["labels(p)"], ["PlanetAT", "AstroBodyAT", "VNode"]);
        })

        test("it can set properties via the Update action", async () => {
            await testGraph.runAsSystem(
                CreateAstroBody({slugId: "Io", mass: 1}),
                CreatePlanet({slugId: "Jupiter", mass: 99999, numberOfMoons: 79, addMoon: "Io"}),
            );
            // Note that we only call the CreatePlanet action (not UpdatePlanet), and the logic for how to set the
            // moon relationship from the "addMoon" argument is only defined in UpdatePlanet, but this still works,
            // because the CreatePlanet action uses UpdatePlanet internally:
            const result = await testGraph.read(tx => tx.queryOne(C`
                MATCH (j:${Planet}), j HAS KEY ${"Jupiter"}
                MATCH (j)-[:${Planet.rel.HAS_MOON}]->(moon:${AstronomicalBody})
            `.RETURN({moon: AstronomicalBody, j: Planet})));
            assert.equal(result.j.slugId, "Jupiter");
            assert.equal(result.j.numberOfMoons, 79);
            assert.equal(result.moon.slugId, "Io");
        });

        test("it can be undone", async () => {
            await testGraph.runAsSystem(
                CreateAstroBody({slugId: "Io", mass: 1})
            );
            // Create a planet - this is the action that we will soon undo:
            const createResult = await testGraph.runAsSystem(
                CreatePlanet({slugId: "Jupiter", mass: 99999, numberOfMoons: 79, addMoon: "Io"}),
            );
            // Check that it was created:
            const findJupiter = C`MATCH (j:${Planet}), j HAS KEY ${"Jupiter"}`.RETURN({j: Planet});
            const orig = await testGraph.read(tx => tx.query(findJupiter));
            assert.equal(orig.length, 1);
            assert.equal(orig[0].j.slugId, "Jupiter");
            // Now undo it:
            await testGraph.undoAction({actionId: createResult.actionId, asUserId: undefined});
            // Now make sure it's gone:
            const postDelete = await testGraph.read(tx => tx.query(findJupiter));
            assert.equal(postDelete.length, 0);
        });
    });

    suite("defaultUpdateActionFor", () => {

        // TODO - test changing data

        // TODO - test that VNID cannot be changed

        // TODO - test retrieving by old and new slugId

        // TODO - test other updates, e.g. movie franchise
    });
});
