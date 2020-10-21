
//     tests: {
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
