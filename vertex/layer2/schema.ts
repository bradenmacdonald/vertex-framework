/**
 * The core database Schema for a Vertex Framework application
 *
 * Labels used are:
 *  :Migration - tracks database schema and data migration history
 *  :VNode - label for all VNodes (basically all nodes involved in the Vertex Framework, except SlugId and Migration)
 *  :DeletedVNode - label for a VNode that has been "deleted" and should be ignored.
 *  :SlugId - label for SlugId nodes, used to allow looking up a VNode by its current _or_ past slugId values
 *  :User:VNode - label for the User VNode type; must exist and be a VNode but details are up to the application
 */
import { Migration } from "../vertex-interface.ts";

export const migrations: Readonly<{[id: string]: Migration}> = Object.freeze({
    // ES6 objects preserve string key order, so these migrations don't need numbers, only string IDs.
    "_root": {
        dependsOn: [],
        // This is the root migration, which sets up the schema so we can track all other migrations.
        forward: (dbWrite) => dbWrite(tx =>
            tx.run("CREATE CONSTRAINT migration_id_uniq ON (m:Migration) ASSERT m.id IS UNIQUE")
        ),
        backward: (dbWrite) => dbWrite(tx =>
            tx.run("DROP CONSTRAINT migration_id_uniq IF EXISTS")
        ),
    },
    vnode: {
        dependsOn: ["_root"],
        forward: async (dbWrite) => {
            await dbWrite(async tx => {
                // We have the core label "VNode" which applies to all VNodes and enforces their VNID+slugId uniqueness
                await tx.run(`CREATE CONSTRAINT vnode_id_uniq ON (v:VNode) ASSERT v.id IS UNIQUE`);
                await tx.run(`CREATE CONSTRAINT vnode_slugid_uniq ON (v:VNode) ASSERT v.slugId IS UNIQUE`)
                // We also have the "DeletedVNode" label, which applies to VNodes that are "deleted":
                await tx.run(`CREATE CONSTRAINT deletedvnode_id_uniq ON (v:DeletedVNode) ASSERT v.id IS UNIQUE`);
                // SlugIds are used to identify VNodes, and continue to work even if the "current" slugId is changed:
                await tx.run("CREATE CONSTRAINT slugid_slugid_uniq ON (s:SlugId) ASSERT s.slugId IS UNIQUE");
            });
        },
        backward: async (dbWrite) => {
            await dbWrite(async tx => {
                await tx.run("DROP CONSTRAINT slugid_slugid_uniq IF EXISTS");
                await tx.run("DROP CONSTRAINT deletedvnode_id_uniq IF EXISTS");
                await tx.run("DROP CONSTRAINT vnode_slugid_uniq IF EXISTS");
                await tx.run("DROP CONSTRAINT vnode_id_uniq IF EXISTS");
            });
            // Delete all nodes after the indexes have been removed (faster than doing so before):
            await dbWrite(async tx => {
                await tx.run(`MATCH (s:SlugId) DETACH DELETE s`);
                await tx.run(`MATCH (v:VNode) DETACH DELETE v`);
                await tx.run(`MATCH (v:DeletedVNode) DETACH DELETE v`);
            });
        },
    },
    slugIdTrigger: {
        dependsOn: ["vnode"],
        forward: async (dbWrite) => {
            // Create the triggers that maintain slugId relationships for models that use slugIds as identifiers:
            await dbWrite(async tx => {
                // 1) Whenever a new VNode is created, if it has a slugId property, create a :SlugId node
                //    with a relationship to the VNode.
                await tx.run(`
                    CALL apoc.trigger.add("createSlugIdRelation","
                        UNWIND $createdNodes AS n
                        WITH n
                        WHERE n:VNode AND n.slugId IS NOT NULL
                        CREATE (:SlugId {slugId: n.slugId, timestamp: datetime()})-[:IDENTIFIES]->(n)
                    ", {phase:"before"})
                `);
                // 2) Whenever a new slugId property value is set on an existing VNode, create a :SlugId node
                //    with a relationship to that VNode.
                //    If the SlugId already exists, update its timestamp to make it the "current" one
                await tx.run(`
                    CALL apoc.trigger.add("updateSlugIdRelation", "
                        // $assignedNodeProperties is map of {key: [list of {key,old,new,node}]}
                        UNWIND $assignedNodeProperties.slugId AS prop
                        WITH prop.node as n, prop.old as oldSlugId
                        WHERE n:VNode AND n.slugId IS NOT NULL AND n.slugId <> oldSlugId
                        MERGE (s:SlugId {slugId: n.slugId})-[:IDENTIFIES]->(n)
                        SET s.timestamp = datetime()
                    ", {phase: "before"})
                `);
                // 3) When a VNode is deleted, delete any "floating" slug IDs.
                await tx.run(`
                    CALL apoc.trigger.add("deleteSlugIdRelation", "
                        WITH $deletedNodes AS deletedNodes
                        WHERE size(deletedNodes) > 0
                        MATCH (s:SlugId)
                        WHERE NOT EXISTS {
                            MATCH (s)-[rel:IDENTIFIES]->(n)
                        }
                        DELETE s
                    ", {phase: "before"})
                `);
            });
        },
        backward: async (dbWrite) => {
            await dbWrite(tx => tx.run(`CALL apoc.trigger.remove("createSlugIdRelation")`));
            await dbWrite(tx => tx.run(`CALL apoc.trigger.remove("updateSlugIdRelation")`));
            await dbWrite(tx => tx.run(`CALL apoc.trigger.remove("deleteSlugIdRelation")`));
        },
    },
});
