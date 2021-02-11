/**
 * The core database Schema for a Vertex Framework application
 *
 * Labels used are:
 *  :Migration - tracks database schema and data migration history
 *  :VNode - label for all VNodes (basically all nodes involved in the Vertex Framework, except ShortId and Migration)
 *  :DeletedVNode - label for a VNode that has been "deleted" and should be ignored.
 *  :ShortId - label for ShortId nodes, used to allow looking up a VNode by its current _or_ past shortId values
 *  :User:VNode - label for the User VNode type; must exist and be a VNode but details are up to the application
 */
import { Migration } from "../vertex-interface";

export const migrations: Readonly<{[id: string]: Migration}> = Object.freeze({
    // ES6 objects preserve string key order, so these migrations don't need numbers, only string IDs.
    "_root": {
        dependsOn: [],
        // This is the root migration, which sets up the schema so we can track all other migrations.
        forward: (dbWrite) => dbWrite(tx =>
            tx.run("CREATE CONSTRAINT migration_id_uniq ON (m:Migration) ASSERT m.id IS UNIQUE")
        ),
        backward: (dbWrite) => dbWrite(tx =>
            tx.run("DROP CONSTRAINT migration_id_uniq")
        ),
    },
    vnode: {
        dependsOn: ["_root"],
        forward: async (dbWrite) => {
            await dbWrite(async tx => {
                // We have the core label "VNode" which applies to all VNodes and enforces their UUID+shortId uniqueness
                await tx.run(`CREATE CONSTRAINT vnode_uuid_uniq ON (v:VNode) ASSERT v.uuid IS UNIQUE`);
                await tx.run(`CREATE CONSTRAINT vnode_shortid_uniq ON (v:VNode) ASSERT v.shortId IS UNIQUE`)
                // We also have the "DeletedVNode" label, which applies to VNodes that are "deleted":
                await tx.run(`CREATE CONSTRAINT deletedvnode_uuid_uniq ON (v:DeletedVNode) ASSERT v.uuid IS UNIQUE`);
                // ShortIds are used to identify VNodes, and continue to work even if the "current" shortId is changed:
                await tx.run("CREATE CONSTRAINT shortid_shortid_uniq ON (s:ShortId) ASSERT s.shortId IS UNIQUE");
            });
            // If we somehow create a VNode without giving it a UUID, make Neo4j generate one:
            await dbWrite(tx => tx.run(`CALL apoc.uuid.install("VNode", {addToExistingNodes: false})`));
        },
        backward: async (dbWrite) => {
            await dbWrite(tx => tx.run(`CALL apoc.uuid.remove("VNode")`));
            await dbWrite(async tx => {
                await tx.run("DROP CONSTRAINT shortid_shortid_uniq");
                await tx.run("DROP CONSTRAINT deletedvnode_uuid_uniq");
                await tx.run("DROP CONSTRAINT vnode_shortid_uniq");
                await tx.run("DROP CONSTRAINT vnode_uuid_uniq");
            });
            // Delete all nodes after the indexes have been removed (faster than doing so before):
            await dbWrite(async tx => {
                await tx.run(`MATCH (s:ShortId) DETACH DELETE s`);
                await tx.run(`MATCH (v:VNode) DETACH DELETE v`);
                await tx.run(`MATCH (v:DeletedVNode) DETACH DELETE v`);
            });
        },
    },
    shortIdTrigger: {
        dependsOn: ["vnode"],
        forward: async (dbWrite) => {
            // Create the triggers that maintain shortId relationships for models that use shortIds as identifiers:
            await dbWrite(async tx => {
                // 1) Whenever a new VNode is created, if it has a shortId property, create a :ShortId node
                //    with a relationship to the VNode.
                await tx.run(`
                    CALL apoc.trigger.add("createShortIdRelation","
                        UNWIND $createdNodes AS n
                        WITH n
                        WHERE n:VNode AND EXISTS(n.shortId)
                        CREATE (:ShortId {shortId: n.shortId, timestamp: datetime()})-[:IDENTIFIES]->(n)
                    ", {phase:"before"})
                `);
                // 2) Whenever a new shortId property value is set on an existing VNode, create a :ShortId node
                //    with a relationship to that VNode.
                //    If the ShortId already exists, update its timestamp to make it the "current" one
                await tx.run(`
                    CALL apoc.trigger.add("updateShortIdRelation", "
                        UNWIND apoc.trigger.propertiesByKey($assignedNodeProperties, 'shortId') AS prop
                        WITH prop.node as n, prop.old as oldShortId
                        WHERE n:VNode AND n.shortId IS NOT NULL AND n.shortId <> oldShortId
                        MERGE (s:ShortId {shortId: n.shortId})-[:IDENTIFIES]->(n)
                        SET s.timestamp = datetime()
                    ", {phase: "before"})
                `);
                // There is no delete trigger because deletions should generally be handled by re-labelling nodes to
                // use a "DeletedVNode" label, not actually deleting the nodes.
            });
        },
        backward: async (dbWrite) => {
            await dbWrite(tx => tx.run(`CALL apoc.trigger.remove("createShortIdRelation")`));
            await dbWrite(tx => tx.run(`CALL apoc.trigger.remove("updateShortIdRelation")`));
        },
    },
});
