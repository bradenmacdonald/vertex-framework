import { group, test, assertEquals, assertThrowsAsync, configureTestData } from "../lib/tests.ts";
import { testGraph, } from "../test-project/index.ts";
import {
    C,
    VNID,
    VNodeType,
    defineAction,
    SYSTEM_VNID,
    GenericCypherAction,
    Field,
    EmptyResultError,
} from "../index.ts";

@VNodeType.declare
class AstronomicalBody extends VNodeType {
    static label = "AstroBody";
    static readonly properties = {
        ...VNodeType.properties,
        name: Field.String,
        mass: Field.Float,
    };
}

@VNodeType.declare
class Planet extends AstronomicalBody {
    static label = "Planet";
    static readonly properties = {
        ...AstronomicalBody.properties,
        numberOfMoons: Field.Int,
    };
}

/** A generic create action that can create a node with any labels and properties */
const GenericCreateAction = defineAction({
    type: `GenericCreateForART`,  // for Action Runner Tests
    // deno-lint-ignore no-explicit-any
    parameters: {} as {labels: string[], data: any},
    resultData: {} as {id: VNID},
    apply: async (tx, data) => {
        const id = VNID();
        await tx.query(C`CREATE (p:${C(data.labels.join(":"))} {id: ${id}}) SET p += ${data.data}`);
        return { resultData: {id}, modifiedNodes: [id], description: `Created VNode with labels ${data.labels.join(", ")}` };
    },
});

group("action runner", () => {

    configureTestData({isolateTestWrites: true, loadTestProjectData: false});

    group("test isolation", () => {
        // Test that our test cases have sufficient test isolation, via isolateTestWrites()
        const id = VNID("_XtzOcazuJbitHvhviKM");
        const createAsteroid = GenericCypherAction({
            cypher: C`CREATE (b:${AstronomicalBody} {id: ${id}, name: "253 Mathilde", mass: 0})`,
            modifiedNodes: [id],
        });
        test("create a node", async () => {
            await testGraph.runAsSystem(createAsteroid);
        });

        test("create a node (2)", async () => {
            // Should succeed, even though there is a unique constraint on id.
            // This will only fail if the previous test case wasn't rolled back correctly.
            await testGraph.runAsSystem(createAsteroid);
        });

        test("create a node (check constraint)", async () => {
            // Check our assumptions: make sure there actually is a unique constraint on id
            await testGraph.runAsSystem(createAsteroid);
            await assertThrowsAsync(
                () => testGraph.runAsSystem(createAsteroid)
            );
        });
    });

    test("Actions are performed by the system user by default", async () => {
        const result = await testGraph.runAsSystem(
            GenericCreateAction({labels: ["AstroBody", "VNode"], data: {name: "Moon", mass: 15}}),
        );
        const readResult = await testGraph.read(tx => tx.queryOne(C`
            MATCH (u:User:VNode)-[:PERFORMED]->(a:Action:VNode {type: ${GenericCreateAction.type}})-[:MODIFIED]->(p:${AstronomicalBody} {id: ${result.id}})
        `.RETURN({"u.slugId": Field.Slug, "u.id": Field.VNID})));
        assertEquals(readResult["u.slugId"], "user-system");
        assertEquals(readResult["u.id"], SYSTEM_VNID);
    });

    test("Running an action with a non-existent user ID will raise an error", async () => {
        const name = "Moon17";
        await assertThrowsAsync(() => testGraph.runAs(
            VNID("_VuIbH1qBVKPl61pzwd1wL"),
            GenericCreateAction({labels: ["AstroBody", "VNode"], data: {name, mass: 15}}),
        ), undefined, `Invalid user ID - unable to apply action.`);
        assertEquals(
            (await testGraph.read(tx => tx.query(C`MATCH (m:${AstronomicalBody} {name: ${name}}) RETURN m`))).length,
            0
        )
    });

    group("Graph data cannot be modified outside of an action", () => {

        test("from a read transaction", async () => {
            await assertThrowsAsync(
                () => testGraph.read(tx =>
                    tx.run("CREATE (x:SomeNode) RETURN x", {})
                ),
                undefined,
                "Writing in read access mode not allowed."
            );
        });

        test("from a write transaction", async () => {
            // Application code should not ever use _restrictedWrite, but even when it is used,
            // a trigger should enfore that no changes to the database are made outside of an
            // action. Doing so requires using both _restrictedWrite() and 
            // _restrictedAllowWritesWithoutAction() together.
            await assertThrowsAsync(
                () => testGraph._restrictedWrite(tx =>
                    tx.run("CREATE (x:SomeNode) RETURN x", {})
                ),
                undefined,
                "Error executing triggers {trackActionChanges=Unable to complete transaction.}",
                // Should be: "every data write transaction should be associated with one Action"
                // I tried every fucking way to get the trackActionChanges to produce this error like it used to, but
                // Neo4j just doesn't like to allow raising exceptions and writing to relationship properties in a
                // trigger transaction :-/  (Uncommenting the "SET modRel += ..." line will restore the custom errors)
            );
        });
    });

    test("An action cannot create a node without including it in modifiedNodes", async () => {
        // Here is an action that creates a new node, and may or may not report that new node as "modified"
        const CreateCeresAction = defineAction({
            type: `CreateCeres1`,
            parameters: {} as {markAsModified: boolean},
            resultData: {} as {id: string},
            apply: async (tx, data) => {
                const id = VNID();
                await tx.query(C`
                    CREATE (p:${AstronomicalBody} {id: ${id}})
                    SET p.name = "Ceres", p.mass = 0.00016
                `);
                return {
                    resultData: {id},
                    // If "markAsModified" is true, say that we modified the new node, otherwise skip it.
                    modifiedNodes: data.markAsModified ? [id] : [],
                    description: "Created Ceres",
                };
            },
        });

        // The action will fail if the action implementation creates a node but doesn't include its VNID in "modifiedNodes":
        await assertThrowsAsync(
            () => testGraph.runAsSystem( CreateCeresAction({markAsModified: false}) ),
            undefined,
            "Error executing triggers {trackActionChanges=Unable to complete transaction.}",
            // Should be: "A :AstroBody node was modified by this CreateCeres1 action (created) but not explicitly marked as modified by the Action.",
            // I tried every fucking way to get the trackActionChanges to produce this error like it used to, but
            // Neo4j just doesn't like to allow raising exceptions and writing to relationship properties in a
            // trigger transaction :-/  (Uncommenting the "SET modRel += ..." line will restore the custom errors)
        );

        // Then it should work if it does mark the node as modified:
        const result = await testGraph.runAsSystem( CreateCeresAction({markAsModified: true}) );
        assertEquals(typeof result.id, "string");
        assertEquals(typeof result.actionId, "string");
        assertEquals(result.actionDescription, "Created Ceres");
    });

    test("An action cannot mutate a node without including it in modifiedNodes", async () => {
        // Create a new AstronomicalBody node:
        const {id} = await testGraph.runAsSystem(
            GenericCreateAction({labels: ["AstroBody", "VNode"], data: {name: "Test Dwarf 2", mass: 100}})
        );
        // Try modifying the node without returning any "modifiedNodes" - this should be denied:
        const cypher = C`MATCH (ab:${AstronomicalBody} {id: ${id}}) SET ab.mass = 5`;
        await assertThrowsAsync(
            () => testGraph.runAsSystem(GenericCypherAction({cypher, modifiedNodes: []})),
            undefined,
            "Error executing triggers {trackActionChanges=Unable to complete transaction.}",
            // Should be: "A :AstroBody node was modified by this GenericCypherAction action (newProp:mass) but not explicitly marked as modified by the Action.",
            // I tried every fucking way to get the trackActionChanges to produce this error like it used to, but
            // Neo4j just doesn't like to allow raising exceptions and writing to relationship properties in a
            // trigger transaction :-/  (Uncommenting the "SET modRel += ..." line will restore the custom errors)
        );
        // Then it should work if it does mark the node as modified:
        await testGraph.runAsSystem(GenericCypherAction({cypher, modifiedNodes: [id]}));
    });

    test("An action cannot create a node that doesn't match its properties schema", async () => {
        // Create a new node but with invalid properties:
        await assertThrowsAsync(
            () => testGraph.runAsSystem(
                GenericCreateAction({labels: ["AstroBody", "VNode"], data: {name: 123456}})
            ),
            undefined,
            `Field "name" is invalid: Not a string`,
        );
        await assertThrowsAsync(
            () => testGraph.runAsSystem(
                GenericCreateAction({labels: ["AstroBody", "VNode"], data: {name: "foo"}})
            ),
            undefined,
            `Field "mass" is invalid: Value is not allowed to be null`,
        );
    });

    test("An action cannot save a node with only the label :VNode", async () => {
        await assertThrowsAsync(
            () => testGraph.runAsSystem(
                GenericCreateAction({labels: ["VNode"], data: {name: "foo"}})
            ),
            undefined,
            "Tried saving a VNode without additional labels. Every VNode must have the :VNode label and at least one other label.",
        );
    });

    test("An action can delete a node by re-labelling it", async () => {
        // Create the planet and test that we can retrieve it:
        const {id} = await testGraph.runAsSystem(
            GenericCreateAction({labels: ["Planet", "AstroBody", "VNode"], data: {name: "Test Planet 5", mass: 100, numberOfMoons: 0}})
        );
        const getPlanetName = async (): Promise<string> =>{
            const p = await testGraph.read(tx => tx.queryOne(C`MATCH (p:${Planet})`.RETURN({"p.name": Field.String})));
            return p["p.name"];
        };
        assertEquals(await getPlanetName(), "Test Planet 5");
        // Now delete the planet:
        await testGraph.runAsSystem(GenericCypherAction({
            cypher: C`MATCH (p:${Planet} {id: ${id}}) REMOVE p:VNode SET p:DeletedVNode`,
            modifiedNodes: [id],
        }));
        await assertThrowsAsync(() => getPlanetName(), EmptyResultError);
    });

    test("An action cannot mark a node as both deleted and not deleted.", async () => {
        await assertThrowsAsync(
            () => testGraph.runAsSystem(
                GenericCreateAction({labels: ["Planet", "VNode", "DeletedVNode"], data: {name: "Test Planet 6", mass: 100, numberOfMoons: 0}})
            ),
            undefined,
            "Nodes must not have :VNode and :DeletedVNode"
        );
    });

    test("An action must apply all labels from a VNode's inheritance chain", async () => {
        await assertThrowsAsync(
            () => testGraph.runAsSystem(
                GenericCreateAction({labels: ["Planet", "VNode"], data: {name: "Test Planet 7", mass: 100, numberOfMoons: 0}})
            ),
            undefined,
            "VNode with label :Planet is missing required inherited label :AstroBody"
        );
    });
});
