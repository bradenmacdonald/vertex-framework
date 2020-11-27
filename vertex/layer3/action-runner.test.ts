import Joi from "@hapi/joi";
import { suite, test, assertRejects, assert, log, before, after, configureTestData } from "../lib/intern-tests";
import { testGraph, } from "../test-project";
import {
    C,
    UUID,
    VNodeType,
    defineAction,
    SYSTEM_UUID,
    GenericCypherAction,
} from "..";

@VNodeType.declare
class AstronomicalBody extends VNodeType {
    static label = "AstroBody";
    static readonly properties = {
        ...VNodeType.properties,
        name: Joi.string().required(),
        mass: Joi.number().required(),
    };
}

@VNodeType.declare
class Planet extends AstronomicalBody {
    static label = "Planet";
    static readonly properties = {
        ...AstronomicalBody.properties,
        numberOfMoons: Joi.number(),
    };
}

/** A generic create action that can create a node with any labels and properties */
const GenericCreateAction = defineAction<{labels: string[], data: any}, {uuid: UUID}>({
    type: `GenericCreateForART`,  // for Action Runner Tests
    apply: async (tx, data) => {
        const uuid = UUID();
        await tx.query(C`CREATE (p:${C(data.labels.join(":"))} {uuid: ${uuid}}) SET p += ${data.data}`);
        return { resultData: {uuid}, modifiedNodes: [uuid], };
    },
    invert: (data, resultData) => null,
});

suite("action runner", () => {

    configureTestData({isolateTestWrites: true, loadTestProjectData: false});

    suite("test isolation", () => {
        // Test that our test cases have sufficient test isolation, via isolateTestWrites()
        const uuid = UUID("425e3b87-2704-4988-9ab4-50e5ad3cbf3a");
        const createAsteroid = GenericCypherAction({
            cypher: C`CREATE (b:${AstronomicalBody} {uuid: ${uuid}, name: "253 Mathilde", mass: 0})`,
            modifiedNodes: [uuid],
        });
        test("create a node", async () => {
            await testGraph.runAsSystem(createAsteroid);
        });

        test("create a node (2)", async () => {
            // Should succeed, even though there is a unique constraint on uuid.
            // This will only fail if the previous test case wasn't rolled back correctly.
            await testGraph.runAsSystem(createAsteroid);
        });

        test("create a node (check constraint)", async () => {
            // Check our assumptions: make sure there actually is a unique constraint on uuid
            await testGraph.runAsSystem(createAsteroid);
            await assertRejects(
                testGraph.runAsSystem(createAsteroid)
            );
        });
    });

    test("Actions are performed by the system user by default", async () => {
        const result = await testGraph.runAsSystem(
            GenericCreateAction({labels: ["AstroBody", "VNode"], data: {name: "Moon", mass: 15}}),
        );
        const readResult = await testGraph.read(tx => tx.queryOne(C`
            MATCH (u:User:VNode)-[:PERFORMED]->(a:Action:VNode {type: ${GenericCreateAction.type}})-[:MODIFIED]->(p:${AstronomicalBody} {uuid: ${result.uuid}})
        `.RETURN({"u.shortId": "string", "u.uuid": "uuid"})));
        assert.equal(readResult["u.shortId"], "system");
        assert.equal(readResult["u.uuid"], SYSTEM_UUID);
    });

    test("Running an action with a non-existent user ID will raise an error", async () => {
        const name = "Moon17";
        await assertRejects(testGraph.runAs(
            UUID("6996ddbf-6cd0-4541-9ee9-3c37f8028941"),
            GenericCreateAction({labels: ["AstroBody", "VNode"], data: {name, mass: 15}}),
        ), `Invalid user ID - unable to apply action.`);
        assert.equal(
            (await testGraph.read(tx => tx.query(C`MATCH (m:${AstronomicalBody} {name: ${name}}) RETURN m`))).length,
            0
        )
    });

    suite("Graph data cannot be modified outside of an action", () => {

        test("from a read transaction", async () => {
            await assertRejects(
                testGraph.read(tx =>
                    tx.run("CREATE (x:SomeNode) RETURN x", {})
                ),
                "Writing in read access mode not allowed."
            );
        });

        test("from a write transaction", async () => {
            // Application code should not ever use _restrictedWrite, but even when it is used,
            // a trigger should enfore that no changes to the database are made outside of an
            // action. Doing so requires using both _restrictedWrite() and 
            // _restrictedAllowWritesWithoutAction() together.
            await assertRejects(
                testGraph._restrictedWrite(tx =>
                    tx.run("CREATE (x:SomeNode) RETURN x", {})
                ),
                "every data write transaction should be associated with one Action"
            );
        });
    });

    test("An action cannot create a node without including it in modifiedNodes", async () => {
        // Here is an action that creates a new node, and may or may not report that new node as "modified"
        const CreateCeresAction = defineAction<{markAsModified: boolean}, {uuid: string}>({
            type: `CreateCeres1`,
            apply: async (tx, data) => {
                const uuid = UUID();
                await tx.query(C`
                    CREATE (p:${AstronomicalBody} {uuid: ${uuid}})
                    SET p.name = "Ceres", p.mass = 0.00016
                `);
                return {
                    resultData: {uuid},
                    // If "markAsModified" is true, say that we modified the new node, otherwise skip it.
                    modifiedNodes: data.markAsModified ? [uuid] : [],
                };
            },
            invert: (data, resultData) => null,
        });

        // The action will fail if the action implementation creates a node but doesn't include its UUID in "modifiedNodes":
        await assertRejects(
            testGraph.runAsSystem( CreateCeresAction({markAsModified: false}) ),
            "A :AstroBody node was modified by this CreateCeres1 action (created node) but not explicitly marked as modified by the Action.",
        );

        // Then it should work if it does mark the node as modified:
        const result = await testGraph.runAsSystem( CreateCeresAction({markAsModified: true}) );
        assert.isString(result.uuid);
        assert.isString(result.actionUuid);
    });

    test("An action cannot mutate a node without including it in modifiedNodes", async () => {
        // Create a new AstronomicalBody node:
        const {uuid} = await testGraph.runAsSystem(
            GenericCreateAction({labels: ["AstroBody", "VNode"], data: {name: "Test Dwarf 2", mass: 100}})
        );
        // Try modifying the node without returning any "modifiedNodes" - this should be denied:
        const cypher = C`MATCH (ab:${AstronomicalBody} {uuid: ${uuid}}) SET ab.mass = 5`;
        await assertRejects(
            testGraph.runAsSystem(GenericCypherAction({cypher, modifiedNodes: []})),
            "A :AstroBody node was modified by this GenericCypherAction action (modified property mass) but not explicitly marked as modified by the Action.",
        );
        // Then it should work if it does mark the node as modified:
        await testGraph.runAsSystem(GenericCypherAction({cypher, modifiedNodes: [uuid]}));
    });

    test("An action cannot create a node that doesn't match its properties schema", async () => {
        // Create a new node but with invalid properties:
        await assertRejects(
            testGraph.runAsSystem(
                GenericCreateAction({labels: ["AstroBody", "VNode"], data: {name: 123456}})
            ),
            `"name" must be a string`,
        );
        await assertRejects(
            testGraph.runAsSystem(
                GenericCreateAction({labels: ["AstroBody", "VNode"], data: {name: "foo"}})
            ),
            `"mass" is required`,
        );
    });

    test("An action cannot save a node with only the label :VNode", async () => {
        await assertRejects(
            testGraph.runAsSystem(
                GenericCreateAction({labels: ["VNode"], data: {name: "foo"}})
            ),
            "Tried saving a VNode without additional labels. Every VNode must have the :VNode label and at least one other label.",
        );
    });

    test("An action can delete a node by re-labelling it", async () => {
        // Create the planet and test that we can retrieve it:
        const {uuid} = await testGraph.runAsSystem(
            GenericCreateAction({labels: ["Planet", "AstroBody", "VNode"], data: {name: "Test Planet 5", mass: 100, numberOfMoons: 0}})
        );
        const getPlanetName = async (): Promise<string> =>{
            const p = await testGraph.read(tx => tx.queryOne(C`MATCH (p:${Planet})`.RETURN({"p.name": "string"})));
            return p["p.name"];
        };
        assert.equal(await getPlanetName(), "Test Planet 5");
        // Now delete the planet:
        await testGraph.runAsSystem(GenericCypherAction({
            cypher: C`MATCH (p:${Planet} {uuid: ${uuid}}) REMOVE p:VNode SET p:DeletedVNode`,
            modifiedNodes: [uuid],
        }));
        await assertRejects(getPlanetName(), "Expected a single result, got 0");
    });

    test("An action cannot mark a node as both deleted and not deleted.", async () => {
        await assertRejects(
            testGraph.runAsSystem(
                GenericCreateAction({labels: ["Planet", "VNode", "DeletedVNode"], data: {name: "Test Planet 6", mass: 100, numberOfMoons: 0}})
            ),
            "VNode definition with label DeletedVNode has not been loaded."
        );
    });

    test("An action must apply all labels from a VNode's inheritance chain", async () => {
        await assertRejects(
            testGraph.runAsSystem(
                GenericCreateAction({labels: ["Planet", "VNode"], data: {name: "Test Planet 7", mass: 100, numberOfMoons: 0}})
            ),
            "VNode with label :Planet is missing required inherited label :AstroBody"
        );
    });
});
