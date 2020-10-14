// import { registerSuite, assert, assertRejects, dedent } from "./lib/intern-tests";
// import { registerVNodeType, VNodeType, ShortIdProperty, VirtualPropType } from "./vnode";
// import Joi from "@hapi/joi";
// import { defaultUpdateActionFor, defaultCreateFor } from "./action";
// import { runAction } from "./action-runner";
// import { testHelpers, SYSTEM_UUID } from "./schema";
// import { _restrictedWrite as dbWrite} from "../../app/db";
// import * as graph from ".";
// import { User } from "../user/models";
// import { runWithoutAction } from "./migrator";

// /**
//  * A VNode type for testing only
//  */
// class TestNode extends VNodeType {
//     static readonly label = "TestNode";
//     static readonly properties = {
//         ...VNodeType.properties,
//         shortId: ShortIdProperty,
//         optionalStringField: Joi.string(),
//         requiredBoolField: Joi.boolean().required(),
//     };
// }
// registerVNodeType(TestNode);

// // Parameters for the "UpdateTestNode" Action
// interface UpdateArgs {
//     shortId?: string;
//     optionalStringField?: string|null;
//     requiredBoolField?: boolean;
// }
// const UpdateTestNode = defaultUpdateActionFor<UpdateArgs>(TestNode, {
//     mutableProperties: ["shortId", "optionalStringField", "requiredBoolField"],
// });
// const CreateTestNode = defaultCreateFor<{shortId: string, requiredBoolField: boolean}, UpdateArgs>(TestNode, UpdateTestNode);



// /**
//  * A VNode type for testing relationships
//  */
// class TestAnimal extends VNodeType {
//     static readonly label = "TestAnimal";
//     static readonly properties = {
//         ...VNodeType.properties,
//         shortId: ShortIdProperty,
//         name: Joi.string(),
//     };
//     static readonly relationshipsFrom = {
//         /** This TestAnimal _is_ a type of another TestAnimal */
//         IS_A: {
//             toLabels: ["TestAnimal"],
//             properties: {},
//         },
//     };
//     static readonly virtualProperties = {
//         children: {
//             type: VirtualPropType.ManyRelationship,
//             query: `(@child:TestAnimal)-[rel:IS_A]->(@)`,
//             gives: {child: TestAnimal, rel: TestAnimal.relationshipsFrom.IS_A},
//         },
//     }
// }
// registerVNodeType(TestAnimal);

// // Parameters for the "UpdateTestAnimal" Action
// interface UpdateArgs {
//     shortId?: string;
//     name?: string|null;
//     isA?: string|null;
// }
// const UpdateTestAnimal = defaultUpdateActionFor<UpdateArgs>(TestAnimal, {
//     mutableProperties: ["shortId", "name", ],
//     otherUpdates: async ({tx, data, nodeSnapshot}) => {
//         // Update the "parent"
//         const previousValues: UpdateArgs = {};
//         if (data.isA !== undefined) {
//             // Get and erase the current parent, if any:
//             const parentResult = await tx.query(
//                 `MATCH (node:TestAnimal {uuid: $uuid})-[rel:IS_A]->(parent:TestAnimal) DELETE rel`,
//                 {uuid: nodeSnapshot.uuid},
//                 {"parent.shortId": "string"}
//             );
//             if (parentResult.length === 1) {
//                 previousValues.isA = parentResult[0]["parent.shortId"];
//             } else {
//                 previousValues.isA = null;
//             }
//             // Set the new parent:
//             if (data.isA !== null) {
//                 const updateResult = await tx.query(
//                     `MATCH (node:TestAnimal {uuid: $uuid})
//                     MATCH (parent:TestAnimal)::{$parentKey}
//                     MERGE (node)-[:IS_A]->(parent)`,
//                     {uuid: nodeSnapshot.uuid, parentKey: data.isA},
//                     {"null": "any"}
//                 );
//                 if (updateResult.length !== 1) {
//                     throw new Error("Unable to set parent. Invalid parent ID?");
//                 }
//             }
//         }
//         return {
//             previousValues,
//             additionalModifiedNodes: [],
//         };
//     },
// });
// const CreateTestAnimal = defaultCreateFor<{shortId: string, name: string}, UpdateArgs>(TestAnimal, UpdateTestAnimal);



// // Tests of the VNode and Actions framework
// registerSuite("VNode", {
//     before: async () => {
//         await runWithoutAction(async () => {
//             await dbWrite(tx => tx.run(`MATCH (m:TestNode) DETACH DELETE m`));
//             await dbWrite(tx => tx.run(`MATCH (m:TestAnimal) DETACH DELETE m`));
//             try { await testHelpers.removeModel("TestAnimal", {shortId: true}); } catch {}
//             try { await testHelpers.removeModel("TestNode", {shortId: true}); } catch {}
//             await testHelpers.declareModel("TestNode", {shortId: true});
//             await testHelpers.declareModel("TestAnimal", {shortId: true});
//         });
//     },
//     after: async () => {
//         // Nothing at the moment
//     },
//     tests: {
//         async "can create and get a TestNode"() {
//             const result = await runAction(
//                 // TODO: make props optional
//                 CreateTestNode({shortId: "test1", requiredBoolField: true, props: {}}),
//             );
//             assert.isString(result.uuid);
//             // Get the test node by its shortId
//             const r1 = await graph.getOne(TestNode, "test1");
//             assert.equal(r1.uuid, result.uuid);
//             assert.equal(r1.shortId, "test1");
//             assert.equal(r1.requiredBoolField, true);
//             assert.equal(r1.optionalStringField, null);
//             // Get the test node by its UUID
//             const r2 = await graph.getOne(TestNode, result.uuid);
//             assert.equal(r2.uuid, result.uuid);
//             assert.equal(r2.shortId, "test1");
//             assert.equal(r2.requiredBoolField, true);
//             assert.equal(r2.optionalStringField, null);
//         },
//         async "Actions are performed by the system user by default"() {
//             const result = await runAction(
//                 CreateTestNode({shortId: "test2", requiredBoolField: true, props: {}}),
//             );
//             const userResult = await graph.queryOne(`
//                 MATCH (u:User)-[:PERFORMED]->(a:Action {type: $type})-[:MODIFIED]->(:TestNode)::{$key}
//             `, {type: CreateTestNode.type, key: result.uuid}, {u: User});
//             assert.equal(userResult.u.shortId, "system");
//             assert.equal(userResult.u.uuid, SYSTEM_UUID);
//         },
//         async "can update a TestNode"() {
//             const key = "test3";
//             const result = await runAction(
//                 CreateTestNode({shortId: key, requiredBoolField: false, props: {optionalStringField: "hello"}}),
//             );
//             // The field values start with the values specified on creation:
//             await graph.getOne(TestNode, key).then(r => {
//                 assert.equal(r.requiredBoolField, false);
//                 assert.equal(r.optionalStringField, "hello");
//             });
//             // Now we mutate it:
//             const result2 = await runAction(UpdateTestNode({
//                 key,
//                 requiredBoolField: true,
//                 optionalStringField: "goodbye",
//                 shortId: "test3-newkey",
//             }));
//             await graph.getOne(TestNode, key).then(r => {
//                 assert.equal(r.requiredBoolField, true);
//                 assert.equal(r.optionalStringField, "goodbye");
//                 assert.equal(r.shortId, "test3-newkey");
//             });
//         },
//         async "can fetch a TestNode by old or new shortId"() {
//             const key1 = "test4";
//             const {uuid} = await runAction(CreateTestNode({shortId: key1, requiredBoolField: false, props: {}}));
//             // Now change the shortId to key2
//             const key2 = "test4-b";
//             await runAction(UpdateTestNode({key: key1, shortId: key2}));
//             // Now ensure we can still fetch by key1:
//             await graph.getOne(TestNode, key1).then(r => {
//                 assert.equal(r.uuid, uuid);
//                 assert.equal(r.shortId, key2);
//             });
//             // Or by key2:
//             await graph.getOne(TestNode, key2).then(r => {
//                 assert.equal(r.uuid, uuid);
//                 assert.equal(r.shortId, key2);
//             });
//         },
//         async "validates data"() {
//             await assertRejects(
//                 runAction(CreateTestNode({shortId: 23423 as any as string, requiredBoolField: true, props: {}})),
//                 `"shortId" must be a string`,
//             );
//             await assertRejects(
//                 runAction(CreateTestNode({shortId: "30b66feb-40eb-41a3-baca-89156b37a909", requiredBoolField: true, props: {}})),
//                 `fails to match the required pattern`,
//             );
//             const key = "test5";
//             await assertRejects(
//                 runAction(CreateTestNode({shortId: key, requiredBoolField: "not a bool" as any, props: {}})),
//                 `"requiredBoolField" must be a boolean`,
//             );
//             await assertRejects(
//                 runAction(CreateTestNode({shortId: key, requiredBoolField: true, props: {optionalStringField: 123 as any as string}})),
//                 `"optionalStringField" must be a string`,
//             );
//             // Now create it with valid data:
//             await runAction(CreateTestNode({shortId: key, requiredBoolField: true, props: {}}));
//             // Now test that validation applies on update as well:
//             await assertRejects(
//                 runAction(UpdateTestNode({key, optionalStringField: [1, 2, 3] as any as string})),
//                 `"optionalStringField" must be a string`,
//             );
//         },
//         //// Relationships
//         async "Can create a VNode with relationships"() {
//             await runAction(
//                 CreateTestAnimal({shortId: "mammal", name: "Class Mammalia", props: {}}),
//             );
//             await runAction(
//                 CreateTestAnimal({shortId: "dog", name: "Canis lupus familiaris", props: {isA: "mammal"}}),
//             );
//             const checkResult = await graph.queryOne(`
//                 MATCH (child:TestAnimal)-[:IS_A]->(parent:TestAnimal)::{$parentKey}
//             `, {parentKey: "mammal"}, {child: TestAnimal});
//             assert.equal(checkResult.child.shortId, "dog");
//         },
//     },
// });
