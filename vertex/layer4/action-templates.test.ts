import { group, test, assertEquals, assertNotEquals, assertStrictEquals, assertRejects, configureTestData } from "../lib/tests.ts";
import {
    C,
    VNID,
    VNodeType,
    Field,
} from "../index.ts";
import { defaultCreateFor, defaultUpdateFor } from "./action-templates.ts";
import { testGraph, CreateTypeTester, TypeTester, UpdateTypeTester } from "../test-project/index.ts";
import { AssertEqual, AssertNotEqual, checkType } from "../lib/ts-utils.ts";
import { VD } from "../lib/types/vdate.ts";

/** A VNodeType for use in this test suite. */
class AstronomicalBody extends VNodeType {
    static label = "AstroBody";
    static readonly properties = {
        ...VNodeType.properties,
        slugId: Field.Slug,
        mass: Field.Float,
    };
}

class Planet extends AstronomicalBody {
    static readonly label = "Planet";
    static readonly properties = {
        ...AstronomicalBody.properties,
        numberOfMoons: Field.NullOr.Int,
    };
    static readonly rel = this.hasRelationshipsFromThisTo({
        /** This planet has moon(s) */
        HAS_MOON: { to: [AstronomicalBody] },
    });
}

const CreateAstroBody = defaultCreateFor(AstronomicalBody, ab => ab.slugId.mass);
const UpdatePlanet = defaultUpdateFor(Planet, p => p.slugId.mass.numberOfMoons, {
    otherUpdates: async (args: {addMoon?: string, deleteMoon?: string}, tx, nodeSnapshot) => {
        if (args.deleteMoon !== undefined) {
            await tx.queryOne(C`
                MATCH (p:${Planet} {id: ${nodeSnapshot.id}})
                MATCH (p)-[rel:${Planet.rel.HAS_MOON}]->(moon:${AstronomicalBody}), moon HAS KEY ${args.deleteMoon}
                DELETE rel
            `.RETURN({}));
        }
        if (args.addMoon !== undefined) {
            await tx.queryOne(C`
                MATCH (p:${Planet} {id: ${nodeSnapshot.id}})
                MATCH (moon:${AstronomicalBody}), moon HAS KEY ${args.addMoon}
                MERGE (p)-[:${Planet.rel.HAS_MOON}]->(moon)
            `.RETURN({}));
        }
        return { additionalModifiedNodes: [] };
    },
});
const CreatePlanet = defaultCreateFor(Planet, p => p.slugId.mass, UpdatePlanet);


group(import.meta, () => {

    configureTestData({isolateTestWrites: true, loadTestProjectData: false, additionalVNodeTypes: [AstronomicalBody, Planet]});

    group("defaultCreateFor", () => {

        test("has a statically typed 'type'", () => {
            checkType<AssertEqual<typeof CreatePlanet.type, "CreatePlanet">>();
            checkType<AssertNotEqual<typeof CreatePlanet.type, "otherString">>();
        })

        test("can create a VNode", async () => {
            const result = await testGraph.runAsSystem(
                CreateAstroBody({slugId: "Ceres", mass: 15}),
            );
            assertEquals(typeof result.id, "string");
            // Get and check the new node in various ways:
            const checkCeres = (p: {id: VNID, slugId: string, mass: number, }): void => {
                assertEquals(p.id, result.id);
                assertEquals(p.slugId, "Ceres");
                assertEquals(p.mass, 15);
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
            assertEquals(typeof ceresId, "string");
            assertEquals(ceresId, VNID(ceresId));  // VNID must be in standard form

            const createPluto = await testGraph.runAsSystem(
                CreateAstroBody({slugId: "pluto", mass: 1930}),
            );
            const plutoId = createPluto.id;
            assertEquals(typeof plutoId, "string");
            assertEquals(plutoId, VNID(plutoId));

            assertNotEquals(ceresId, plutoId);
        });

        test("doesn't allow creating invalid VNodes", async () => {
            // There are overlapping tests in action-runner.test.ts, but that's OK.
            await assertRejects(() => testGraph.runAsSystem(
                // deno-lint-ignore no-explicit-any
                CreateAstroBody({slugId: 17 as any, mass: 15}),
            ), `Field "slugId" is invalid: Not a string`);
            // slugId cannot contain spaces:
            await assertRejects(() => testGraph.runAsSystem(
                CreateAstroBody({slugId: "this slugId has spaces", mass: 123}),
            ), `Field "slugId" is invalid: Not a valid slug (cannot contain spaces or other special characters other than '-')`);
            // required props missing:
            await assertRejects(() => testGraph.runAsSystem(
                // deno-lint-ignore no-explicit-any
                CreateAstroBody({} as any),
            ), `Field "slugId" is invalid: Value is not allowed to be null`);
        });

        test("sets all required labels for VNodeTypes with inherited labels", async () => {
            const {id} = await testGraph.runAsSystem(
                CreatePlanet({slugId: "Earth", mass: 9000})
            );
            const result = await testGraph.read(tx => tx.query(C`MATCH (p:${Planet} {id: ${id}})`.RETURN({"labels(p)": Field.List(Field.String) })));
            assertEquals(new Set(result[0]["labels(p)"]), new Set(["Planet", "AstroBody", "VNode"]));
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
            assertEquals(result.j.slugId, "Jupiter");
            assertEquals(result.j.numberOfMoons, 79);
            assertEquals(result.moon.slugId, "Io");
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
                RETURN propKey, apoc.meta.cypher.type(t[propKey]) AS type
            `.givesShape({propKey: Field.String, type: Field.String})));
            assertEquals(new Set(dbTypes), new Set([
                {propKey: "id", type: "STRING"},
                {propKey: "int", type: "INTEGER"},  // <-- in particular, make sure an int typed field is not saved as a float
                {propKey: "bigInt", type: "INTEGER"},
                {propKey: "float", type: "FLOAT"},
                {propKey: "string", type: "STRING"},
                {propKey: "slug", type: "STRING"},
                {propKey: "boolean", type: "BOOLEAN"},
                {propKey: "date", type: "LocalDate"},
                {propKey: "dateTime", type: "ZonedDateTime"},
            ]));

            // Check that the values are identical.
            const pulled = await testGraph.pullOne(TypeTester, t => t.int.bigInt.float.string.slug.boolean.date.dateTime, {key: id});
            assertStrictEquals(pulled.int, args.int);
            assertStrictEquals(pulled.bigInt, args.bigInt);
            assertStrictEquals(pulled.float, args.float);
            assertStrictEquals(pulled.string, args.string);
            assertStrictEquals(pulled.slug, args.slug);
            assertStrictEquals(pulled.boolean, args.boolean);
            assertStrictEquals(pulled.date.toString(), args.date.toString());
            assertStrictEquals(pulled.dateTime.toString(), args.dateTime.toString());
        });
    });

    group("defaultUpdateFor", () => {

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
            assertStrictEquals(pulled.int, newArgs.int);
            assertStrictEquals(pulled.bigInt, origArgs.bigInt);  // Unchanged
            assertStrictEquals(pulled.float, origArgs.float);  // Unchanged
            assertStrictEquals(pulled.string, newArgs.string);
            assertStrictEquals(pulled.slug, newArgs.slug);
            assertStrictEquals(pulled.boolean, origArgs.boolean);  // Unchanged
            assertStrictEquals(pulled.date.toString(), newArgs.date?.toString());
            assertStrictEquals(pulled.dateTime.toString(), newArgs.dateTime?.toString());
            assertStrictEquals(pulled.nullableFloat, newArgs.nullableFloat);
            assertStrictEquals(pulled.nullableSlug, origArgs.nullableSlug);  // Unchanged
        });

        // TODO - test that VNID cannot be changed

        // TODO - test retrieving by old and new slugId

        // TODO - test other updates, e.g. movie franchise
    });
});
