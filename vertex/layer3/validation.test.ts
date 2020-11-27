/**
 * Tests for relationship validation code, in layer2/vnode-base.ts _BaseVNodeType.validate()
 * 
 * The tests are in layer 3 because testing the validation code requires updating the graph via actions, which are part
 * of layer 3.
 */
import Joi from "@hapi/joi";
import { suite, test, assertRejects, assert, log, before, after, configureTestData } from "../lib/intern-tests";
import { testGraph, } from "../test-project";
import {
    C,
    UUID,
    VNodeType,
    ShortIdProperty,
    GenericCypherAction,
} from "..";

@VNodeType.declare
class BirthCertificate extends VNodeType {
    static label = "BirthCertRVT";  // RVT: Relationship Validation Tests
    static readonly properties = {...VNodeType.properties};
}

@VNodeType.declare
class Person extends VNodeType {
    static label = "PersonRVT";  // RVT: Relationship Validation Tests
    static readonly properties = {...VNodeType.properties, shortId: ShortIdProperty};
    static readonly rel = {
        HAS_BIRTH_CERT: {
            to: [BirthCertificate],
            cardinality: VNodeType.Rel.ToOneRequired,  // Every person must have a birth certificate
        },
        HAS_FRIEND: {
            to: [Person],
            cardinality: VNodeType.Rel.ToManyUnique,
            properties: {
                friendsSince: Joi.date().required(),
            },
        },
        HAS_SPOUSE: {
            to: [Person],
            cardinality: VNodeType.Rel.ToOneOrNone,
            properties: {
                marriedOn: Joi.date().required(),
            },
        },
    };
}

const createPerson = async (name: string): Promise<UUID> => {
    const uuid = UUID(), birthCertUuid = UUID();
    await testGraph.runAsSystem(GenericCypherAction({
        cypher: C`CREATE (p:${Person} { uuid: ${uuid}, shortId: ${name}})-[:${Person.rel.HAS_BIRTH_CERT}]->(bc:${BirthCertificate} {uuid: ${birthCertUuid}})`,
        modifiedNodes: [uuid, birthCertUuid],
    }));
    return uuid;
}


suite(__filename, () => {

    configureTestData({isolateTestWrites: true, loadTestProjectData: false});

    suite("test relationship validation", () => {
        
        test("ToOneRequired cardinality makes a to-one relationship required", async () => {
            // Try creating a person and a birth certificate - this should succeed:
            const aliceUuid = UUID(), bcUuid = UUID(), bobUuid = UUID();
            await testGraph.runAsSystem(GenericCypherAction({
                cypher: C`CREATE (p:${Person} { uuid: ${aliceUuid}, shortId: "Alice"})-[:${Person.rel.HAS_BIRTH_CERT}]->(bc:${BirthCertificate} {uuid: ${bcUuid}})`,
                modifiedNodes: [aliceUuid, bcUuid],
            }));
            // Try creating a person without the required BirthCertificate:
            await assertRejects(
                testGraph.runAsSystem(GenericCypherAction({
                    cypher: C`CREATE (p:${Person} { uuid: ${bobUuid}, shortId: "Bob"})`,
                    modifiedNodes: [bobUuid],
                })),
                "Required relationship type HAS_BIRTH_CERT must point to one node, but does not exist."
            );
        });
        
        test("ToOneRequired cardinality prohibits relationship to multiple nodes", async () => {
            // Try creating a person and a birth certificate - this should succeed:
            const aliceUuid = UUID(), bcUuid = UUID(), bcUuid2 = UUID();
            await testGraph.runAsSystem(GenericCypherAction({
                cypher: C`CREATE (p:${Person} { uuid: ${aliceUuid}, shortId: "Alice"})-[:${Person.rel.HAS_BIRTH_CERT}]->(bc:${BirthCertificate} {uuid: ${bcUuid}})`,
                modifiedNodes: [aliceUuid, bcUuid],
            }));
            // Try adding an additional birth certificate to that person:
            await assertRejects(
                testGraph.runAsSystem(GenericCypherAction({
                    cypher: C`
                        MATCH (p:${Person} {shortId: "Alice"})
                        CREATE (p)-[:${Person.rel.HAS_BIRTH_CERT}]->(bc:${BirthCertificate} {uuid: ${bcUuid2}})
                    `,
                    modifiedNodes: [aliceUuid, bcUuid],
                })),
                "Required to-one relationship type HAS_BIRTH_CERT is pointing to more than one node."
            );
        });
        
        test("ToOneOrNone cardinality prohibits relationship to multiple nodes", async () => {
            // Try creating a person with no spouse - this should succeed:
            // Create alice, bob, and charli:
            const aliceUuid = await createPerson("alice");
            const bobUuid = await createPerson("bob");
            const charliUuid = await createPerson("charli");
            // Alice's spouse is Bob:
            await testGraph.runAsSystem(GenericCypherAction({
                cypher: C`
                    MATCH (alice:${Person} {shortId: "alice"})
                    MATCH (bob:${Person} {shortId: "bob"})
                    CREATE (alice)-[:${Person.rel.HAS_SPOUSE} {marriedOn: "2010-01-01"}]->(bob)
                `,
                modifiedNodes: [aliceUuid, bobUuid],
            })),
            // Try adding an additional spouse to Alice:
            await assertRejects(
                testGraph.runAsSystem(GenericCypherAction({
                    cypher: C`
                        MATCH (alice:${Person} {shortId: "alice"})
                        MATCH (charli:${Person} {shortId: "charli"})
                        CREATE (alice)-[:${Person.rel.HAS_SPOUSE} {marriedOn: "2010-01-01"}]->(charli)
                    `,
                    modifiedNodes: [aliceUuid, charliUuid],
                })),
                "To-one relationship type HAS_SPOUSE is pointing to more than one node."
            );
        });
        
        test("ToManyUnique cardinality prohibits multiple relationships between the same pair of nodes", async () => {
            // Create alice, bob, and charli:
            const aliceUuid = await createPerson("alice");
            const bobUuid = await createPerson("bob");
            const charliUuid = await createPerson("charli");

            const addFriendship = async (person1uuid: UUID, person2uuid: UUID): Promise<void> => {
                await testGraph.runAsSystem(GenericCypherAction({
                    cypher: C`
                        MATCH (p1:${Person}), p1 HAS KEY ${person1uuid}
                        MATCH (p2:${Person}), p2 HAS KEY ${person2uuid}
                        CREATE (p1)-[:${Person.rel.HAS_FRIEND} {friendsSince: "2010-01-01"}]->(p2)
                    `,
                    modifiedNodes: [person1uuid, person2uuid],
                }));
            };

            // Mark Alice and Bob as being friends
            await addFriendship(aliceUuid, bobUuid);
            // Mark Alice and Charli as being friends:
            await addFriendship(aliceUuid, charliUuid);
            // Try adding an additional friendship between Alice and Bob, who are already friends:
            await assertRejects(
                addFriendship(aliceUuid, bobUuid),
                "Creating multiple HAS_FRIEND relationships between the same pair of nodes is not allowed."
            );
        });
    });

});
