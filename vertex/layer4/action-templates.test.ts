import { suite, test, assertRejects, configureTestData, assert, log, before, after } from "../lib/intern-tests";
import {
    C,
    VNID,
    VNodeType,
    Field,
    UndoAction,
} from "..";
import { defaultCreateFor, defaultUpdateFor } from "./action-templates";
import { testGraph, CreateTypeTester, TypeTester, UpdateTypeTester } from "../test-project";
import { AssertEqual, AssertNotEqual, checkType } from "../lib/ts-utils";
import { VD } from "../lib/types/vdate";

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
        numberOfMoons: Field.NullOr.Int,
    };
    static readonly rel = {
        /** This planet has moon(s) */
        HAS_MOON: { to: [AstronomicalBody] },
    };
}

const CreateAstroBody = defaultCreateFor(AstronomicalBody, ab => ab.slugId.mass);
const UpdatePlanet = defaultUpdateFor(Planet, p => p.slugId.mass.numberOfMoons, {
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
            const r1 = await testGraph.read(tx => tx.queryOne(C`MATCH (p:${AstronomicalBody}), p HAS KEY ${"Ceres"}`.RETURN({p: Field.VNode(AstronomicalBody)})));
            checkCeres(r1.p);
            // By its VNID:
            const r2 = await testGraph.read(tx => tx.queryOne(C`MATCH (p:${AstronomicalBody}), p HAS KEY ${result.id}`.RETURN({p: Field.VNode(AstronomicalBody)})));
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
            const result = await testGraph.read(tx => tx.query(C`MATCH (p:${Planet} {id: ${id}})`.RETURN({"labels(p)": Field.List(Field.String) })));
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
            `.RETURN({moon: Field.VNode(AstronomicalBody), j: Field.VNode(Planet)})));
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
            const findJupiter = C`MATCH (j:${Planet}), j HAS KEY ${"Jupiter"}`.RETURN({j: Field.VNode(Planet)});
            const orig = await testGraph.read(tx => tx.query(findJupiter));
            assert.equal(orig.length, 1);
            assert.equal(orig[0].j.slugId, "Jupiter");
            // Now undo it:
            await testGraph.runAsSystem(UndoAction({actionId: createResult.actionId}));
            // Now make sure it's gone:
            const postDelete = await testGraph.read(tx => tx.query(findJupiter));
            assert.equal(postDelete.length, 0);
        });

        test("Sets correct types for all fields", async () => {
            const dateTime = new Date();

            const args: Parameters<typeof CreateTypeTester>[0] = {
                int: -50,
                bigInt: 1234n,
                float: -0.0625,
                string: "負けるが勝ち",
                slug: "main-entrée",
                boolean: true,
                date: VD`2021-05-21`,
                dateTime: dateTime,
                // All the nullable fields will start as null
            };

            // Use defaultCreateAction to create a "TypeTester" VNode:
            const {id} = await testGraph.runAsSystem(
                CreateTypeTester(args)
            );

            // Confirm that the types saved into the database are correct.
            const dbTypes = await testGraph.read(tx => tx.query(C`
                MATCH (t:${TypeTester} {id: ${id}})
                UNWIND keys(t) AS propKey
                RETURN propKey, apoc.meta.type(t[propKey]) AS type
            `.givesShape({propKey: Field.String, type: Field.String})));
            assert.sameDeepMembers(dbTypes, [
                {propKey: "id", type: "STRING"},
                {propKey: "int", type: "INTEGER"},  // <-- in particular, make sure an int typed field is not saved as a float
                {propKey: "bigInt", type: "INTEGER"},
                {propKey: "float", type: "FLOAT"},
                {propKey: "string", type: "STRING"},
                {propKey: "slug", type: "STRING"},
                {propKey: "boolean", type: "BOOLEAN"},
                {propKey: "date", type: "LocalDate"},
                {propKey: "dateTime", type: "ZonedDateTime"},
            ]);

            // Check that the values are identical.
            const pulled = await testGraph.pullOne(TypeTester, t => t.int.bigInt.float.string.slug.boolean.date.dateTime, {key: id});
            assert.strictEqual(pulled.int, args.int);
            assert.strictEqual(pulled.bigInt, args.bigInt);
            assert.strictEqual(pulled.float, args.float);
            assert.strictEqual(pulled.string, args.string);
            assert.strictEqual(pulled.slug, args.slug);
            assert.strictEqual(pulled.boolean, args.boolean);
            assert.strictEqual(pulled.date.toString(), args.date.toString());
            assert.strictEqual(pulled.dateTime.toString(), args.dateTime.toString());
        });
    });

    suite("defaultUpdateFor", () => {

        // Test changing data


        test("Sets correct types for all fields", async () => {
            const dateTime1 = new Date("2021-05-08T16:24:52.000Z");
            const dateTime2 = new Date();

            const origArgs: Parameters<typeof CreateTypeTester>[0] = {
                int: -50,
                bigInt: 1234n,
                float: -0.0625,
                string: "負けるが勝ち",
                slug: "main-entrée",
                boolean: true,
                date: VD`2021-05-21`,
                dateTime: dateTime1,

                nullableFloat: 15.5,
                nullableSlug: "nullable-slug",
            };

            // Use defaultCreateAction to create a "TypeTester" VNode:
            const {id} = await testGraph.runAsSystem(
                CreateTypeTester(origArgs)
            );

            // And then update it:
            const newArgs: Parameters<typeof UpdateTypeTester>[0] = {
                key: id,
                int: 100,
                string: "yo",
                slug: "new-slug",
                date: VD`2021-02-20`,
                dateTime: dateTime2,
                nullableFloat: null,
            };
            await testGraph.runAsSystem(UpdateTypeTester(newArgs));

            // Check that the values are identical.
            const pulled = await testGraph.pullOne(TypeTester, t => t.int.bigInt.float.string.slug.boolean.date.dateTime.nullableFloat.nullableSlug, {key: id});
            assert.strictEqual(pulled.int, newArgs.int);
            assert.strictEqual(pulled.bigInt, origArgs.bigInt);  // Unchanged
            assert.strictEqual(pulled.float, origArgs.float);  // Unchanged
            assert.strictEqual(pulled.string, newArgs.string);
            assert.strictEqual(pulled.slug, newArgs.slug);
            assert.strictEqual(pulled.boolean, origArgs.boolean);  // Unchanged
            assert.strictEqual(pulled.date.toString(), newArgs.date?.toString());
            assert.strictEqual(pulled.dateTime.toString(), newArgs.dateTime?.toString());
            assert.strictEqual(pulled.nullableFloat, newArgs.nullableFloat);
            assert.strictEqual(pulled.nullableSlug, origArgs.nullableSlug);  // Unchanged
        });

        // TODO - test that VNID cannot be changed

        // TODO - test retrieving by old and new slugId

        // TODO - test other updates, e.g. movie franchise
    });
});
