import Joi from "@hapi/joi";
import { suite, test, assertRejects, assert, log, before, after, configureTestData } from "../lib/intern-tests";
import { testGraph, } from "../test-project";
import {
    C,
    UUID,
    VNodeType,
    registerVNodeType,
    unregisterVNodeType,
    defineAction,
} from "..";

class AstronomicalBody extends VNodeType {
    static label = "AstroBody";
    static readonly properties = {
        ...VNodeType.properties,
        name: Joi.string().required(),
        mass: Joi.number().required(),
    };
}

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

    before(() => {
        registerVNodeType(AstronomicalBody);
        registerVNodeType(Planet);
    });

    after(() => {
        unregisterVNodeType(AstronomicalBody);
        unregisterVNodeType(Planet);
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
            "node was modified by this CreateCeres1 action (created node) but not explicitly marked as modified by the Action.",
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

        // Here is an action that modifies the node, but may or may not report that it modified the node
        const ModifyAction = defineAction<{uuid: UUID, markAsModified: boolean}, {/* no return data */}>({
            type: `ModifyAction2`,
            apply: async (tx, data) => {
                await tx.query(C`MATCH (p:${AstronomicalBody} {uuid: ${data.uuid}}) SET p.mass = 5`);
                return { resultData: {}, modifiedNodes: data.markAsModified ? [data.uuid] : [] };
            },
            invert: (data, resultData) => null,
        });

        await assertRejects(
            testGraph.runAsSystem( ModifyAction({uuid, markAsModified: false}) ),
            "node was modified by this ModifyAction2 action (modified property mass) but not explicitly marked as modified by the Action.",
        );

        // Then it should work if it does mark the node as modified:
        await testGraph.runAsSystem( ModifyAction({uuid, markAsModified: true}) );
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
        // Here is an action that deletes a node:
        const DeletePlanetAction = defineAction<{uuid: UUID}, {/* no result */}>({
            type: `DeletePlanet5`,
            apply: async (tx, data) => {
                await tx.query(C`MATCH (p:${Planet} {uuid: ${data.uuid}}) REMOVE p:VNode SET p:DeletedVNode`);
                return { resultData: {}, modifiedNodes: [data.uuid], };
            },
            invert: (data, resultData) => null,
        });
        // Now create the planet and test that we can retrieve it:
        const {uuid} = await testGraph.runAsSystem(
            GenericCreateAction({labels: ["Planet", "AstroBody", "VNode"], data: {name: "Test Planet 5", mass: 100, numberOfMoons: 0}})
        );
        const getPlanetName = async (): Promise<string> =>{
            const p = await testGraph.read(tx => tx.queryOne(C`MATCH (p:${Planet})`.RETURN({"p.name": "string"})));
            return p["p.name"];
        };
        assert.equal(await getPlanetName(), "Test Planet 5");
        // Now delete the planet:
        await testGraph.runAsSystem(DeletePlanetAction({uuid}));
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
