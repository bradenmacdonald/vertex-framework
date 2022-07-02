/**
 * Tests for relationship validation code, in layer2/vnode-base.ts _BaseVNodeType.validate()
 * 
 * The tests are in layer 3 because testing the validation code requires updating the graph via actions, which are part
 * of layer 3.
 */
import { group, test, assertRejects, assertEquals, configureTestData } from "../lib/tests.ts";
import { testGraph, } from "../test-project/index.ts";
import {
    C,
    VNID,
    VNodeType,
    Field,
    GenericCypherAction,
    defaultCreateFor,
} from "../index.ts";

class BirthCertificate extends VNodeType {
    static label = "BirthCert";
    static readonly properties = {...VNodeType.properties};
}

class Person extends VNodeType {
    static label = "PersonRVT";  // RVT: Relationship Validation Tests
    static readonly properties = {...VNodeType.properties, slugId: Field.Slug};
    static readonly rel = this.hasRelationshipsFromThisTo({
        HAS_BIRTH_CERT: {
            to: [BirthCertificate],
            cardinality: VNodeType.Rel.ToOneRequired,  // Every person must have a birth certificate
        },
        HAS_FRIEND: {
            to: [this],
            cardinality: VNodeType.Rel.ToManyUnique,
            properties: {
                friendsSince: Field.Date,
            },
        },
        HAS_SPOUSE: {
            to: [this],
            cardinality: VNodeType.Rel.ToOneOrNone,
            properties: {
                marriedOn: Field.Date,
            },
        },
    });
}

const createPerson = async (name: string): Promise<VNID> => {
    const id = VNID(), birthCertId = VNID();
    await testGraph.runAsSystem(GenericCypherAction({
        cypher: C`CREATE (p:${Person} { id: ${id}, slugId: ${name}})-[:${Person.rel.HAS_BIRTH_CERT}]->(bc:${BirthCertificate} {id: ${birthCertId}})`,
        modifiedNodes: [id, birthCertId],
    }));
    return id;
}


class Note extends VNodeType {
    static label = "Note";
    static readonly slugIdPrefix = "note-";
    static readonly properties = {...VNodeType.properties, slugId: Field.Slug, text: Field.NullOr.String};
}

const CreateNote = defaultCreateFor(Note, n => n.slugId);


group(import.meta, () => {

    configureTestData({isolateTestWrites: true, loadTestProjectData: false, additionalVNodeTypes: [
        BirthCertificate,
        Person,
        Note,
    ]});

    group("test slugIdPrefix validation", () => {

        test("Creating a VNode with a valid slugIdPrefix works fine", async () => {
            const {id} = await testGraph.runAsSystem(CreateNote({slugId: "note-test1"}));
            const check = await testGraph.read(tx => tx.queryOne(C`MATCH (n:${Note}), n HAS KEY ${id}`.RETURN({n: Field.VNode(Note)})));
            assertEquals(check.n.slugId, "note-test1");
        });

        test("Creating a VNode with an invalid slugIdPrefix works fine", async () => {
            await assertRejects(
                () => testGraph.runAsSystem(CreateNote({slugId: "test1-note-foo"})),
                `Note has an invalid slugId "test1-note-foo". Expected it to start with "note-".`,
            );
        });
    });

    group("test relationship validation", () => {
        
        test("ToOneRequired cardinality makes a to-one relationship required", async () => {
            // Try creating a person and a birth certificate - this should succeed:
            const aliceId = VNID(), bcId = VNID(), bobId = VNID();
            await testGraph.runAsSystem(GenericCypherAction({
                cypher: C`CREATE (p:${Person} { id: ${aliceId}, slugId: "Alice"})-[:${Person.rel.HAS_BIRTH_CERT}]->(bc:${BirthCertificate} {id: ${bcId}})`,
                modifiedNodes: [aliceId, bcId],
            }));
            // Try creating a person without the required BirthCertificate:
            await assertRejects(
                () => testGraph.runAsSystem(GenericCypherAction({
                    cypher: C`CREATE (p:${Person} { id: ${bobId}, slugId: "Bob"})`,
                    modifiedNodes: [bobId],
                })),
                "Required relationship type HAS_BIRTH_CERT must point to one node, but does not exist."
            );
        });
        
        test("ToOneRequired cardinality prohibits relationship to multiple nodes", async () => {
            // Try creating a person and a birth certificate - this should succeed:
            const aliceId = VNID(), bcId = VNID(), bcId2 = VNID();
            await testGraph.runAsSystem(GenericCypherAction({
                cypher: C`CREATE (p:${Person} { id: ${aliceId}, slugId: "Alice"})-[:${Person.rel.HAS_BIRTH_CERT}]->(bc:${BirthCertificate} {id: ${bcId}})`,
                modifiedNodes: [aliceId, bcId],
            }));
            // Try adding an additional birth certificate to that person:
            await assertRejects(
                () => testGraph.runAsSystem(GenericCypherAction({
                    cypher: C`
                        MATCH (p:${Person} {slugId: "Alice"})
                        CREATE (p)-[:${Person.rel.HAS_BIRTH_CERT}]->(bc:${BirthCertificate} {id: ${bcId2}})
                    `,
                    modifiedNodes: [aliceId, bcId],
                })),
                "Required to-one relationship type HAS_BIRTH_CERT is pointing to more than one node."
            );
        });
        
        test("ToOneOrNone cardinality prohibits relationship to multiple nodes", async () => {
            // Try creating a person with no spouse - this should succeed:
            // Create alice, bob, and charli:
            const aliceId = await createPerson("alice");
            const bobId = await createPerson("bob");
            const charliId = await createPerson("charli");
            // Alice's spouse is Bob:
            await testGraph.runAsSystem(GenericCypherAction({
                cypher: C`
                    MATCH (alice:${Person} {slugId: "alice"})
                    MATCH (bob:${Person} {slugId: "bob"})
                    CREATE (alice)-[:${Person.rel.HAS_SPOUSE} {marriedOn: date("2010-01-01")}]->(bob)
                `,
                modifiedNodes: [aliceId, bobId],
            })),
            // Try adding an additional spouse to Alice:
            await assertRejects(
                () => testGraph.runAsSystem(GenericCypherAction({
                    cypher: C`
                        MATCH (alice:${Person} {slugId: "alice"})
                        MATCH (charli:${Person} {slugId: "charli"})
                        CREATE (alice)-[:${Person.rel.HAS_SPOUSE} {marriedOn: date("2010-01-01")}]->(charli)
                    `,
                    modifiedNodes: [aliceId, charliId],
                })),
                "To-one relationship type HAS_SPOUSE is pointing to more than one node."
            );
        });
        
        test("ToManyUnique cardinality prohibits multiple relationships between the same pair of nodes", async () => {
            // Create alice, bob, and charli:
            const aliceId = await createPerson("alice");
            const bobId = await createPerson("bob");
            const charliId = await createPerson("charli");

            const addFriendship = async (person1Id: VNID, person2Id: VNID): Promise<void> => {
                await testGraph.runAsSystem(GenericCypherAction({
                    cypher: C`
                        MATCH (p1:${Person}), p1 HAS KEY ${person1Id}
                        MATCH (p2:${Person}), p2 HAS KEY ${person2Id}
                        CREATE (p1)-[:${Person.rel.HAS_FRIEND} {friendsSince: date("2010-01-01")}]->(p2)
                    `,
                    modifiedNodes: [person1Id, person2Id],
                }));
            };

            // Mark Alice and Bob as being friends
            await addFriendship(aliceId, bobId);
            // Mark Alice and Charli as being friends:
            await addFriendship(aliceId, charliId);
            // Try adding an additional friendship between Alice and Bob, who are already friends:
            await assertRejects(
                () => addFriendship(aliceId, bobId),
                "Creating multiple HAS_FRIEND relationships between the same pair of nodes is not allowed."
            );
        });
    });

});
