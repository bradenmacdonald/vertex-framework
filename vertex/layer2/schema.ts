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
import { UUID } from "../lib/uuid";

// The UUID of the system user.
export const SYSTEM_UUID: UUID = UUID("00000000-0000-0000-0000-000000000000");

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
            await dbWrite(tx => tx.run(`CALL apoc.uuid.install("VNode")`));
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
    systemUser: {
        dependsOn: ["vnode", "shortIdTrigger"],
        forward: async (dbWrite) => {
            // Create the system user. This is a "bootstrap" User/Action because every user must be created via an
            // action and every action must be performed by a user. So here the system user creates itself.
            await dbWrite(tx => tx.run(`
                CREATE (u:User:VNode {
                    uuid: "${SYSTEM_UUID}",
                    shortId: "system",
                    realname: "System"
                })-[:PERFORMED]->(a:Action:VNode {
                    // A UUID will be created automatically by apoc extension.
                    type: "CreateUser",
                    data: "{}",
                    timestamp: datetime(),
                    tookMs: 0
                })
            `));
        },
        backward: async (dbWrite) => {
            await dbWrite(tx => tx.run(`MATCH (u:User:VNode {uuid: "${SYSTEM_UUID}"}) DETACH DELETE u`));
        },
    },
    trackActionChanges: {
        dependsOn: ["vnode"],
        forward: async (dbWrite) => {
            // Other than migrations, all changes (writes) to the database must be associated with an "Action";
            // the Action node will be automatically created as part of the write transaction by the action-runner code.
            // The Action _must_ include a -[:MODIFIED]-> relationship to every node that it modified (created, updated,
            // marked as Deleted, or created a relationship from).
            // Creating a relationship (a)-[:REL]->(b) only counts as modifying (a), not (b)
            //
            // The purpose of this trigger is to enforce these constraints by checking the transaction before it commits,
            // and throwing an error (aborting the transaction) if it does not correctly mark the action as having
            // MODIFIED the right nodes.
            //
            // This trigger will complain if an Action is marked as modifying a node that it didn't actually modify,
            // although that should also be avoided.
            //
            // This trigger would normally cause issues for schema migrations and data migrations, so the migrator code
            // explicitly pauses and resumes this trigger during each migration.
            await dbWrite(async tx => {
                await tx.run(`
                    CALL apoc.trigger.add("trackActionChanges", "

                        WITH [n IN $createdNodes WHERE n:Action:VNode] AS actions
                            CALL apoc.util.validate(
                                size(actions) <> 1,
                                'every data write transaction should be associated with one Action, found %d', [size(actions)]
                            )
                        WITH head(actions) AS action

                        WITH
                            action,

                            // Check that any newly created nodes are included in the list of nodes :MODIFIED by the current Action
                            [
                                n IN $createdNodes WHERE NOT n:Action AND NOT n:ShortId
                                | {node: n, reason: 'created node'}
                            ] AS createdNodes,

                            // Check that any nodes with modified properties are included in the list of nodes :MODIFIED by the current Action
                            [
                                modProp IN apoc.coll.flatten(
                                    apoc.map.values($assignedNodeProperties, keys($assignedNodeProperties)) +
                                    apoc.map.values($removedNodeProperties, keys($removedNodeProperties))
                                )
                                | {node: modProp.node, reason: 'modified property ' + modProp.key}
                            ] AS modifiedProps,

                            // Check that any modified relationships have their 'from' node included in the list of :MODIFIED nodes:
                            [
                                rel IN ($createdRelationships + $deletedRelationships)
                                WHERE type(rel) <> 'PERFORMED' AND type(rel) <> 'MODIFIED' AND type(rel) <> 'IDENTIFIES'
                                | {node: startNode(rel), reason: 'added/deleted :'+type(rel)+' relationship'}
                            ] AS createdOrDeletedRelationships

                        UNWIND (createdNodes + modifiedProps + createdOrDeletedRelationships) AS change
                            WITH action, change.node AS node, change.reason AS reason
                                WHERE node <> action AND none(x IN $deletedNodes WHERE id(x) = id(node))
                                OPTIONAL MATCH (action)-[rel:MODIFIED]->(node)
                                CALL apoc.util.validate(
                                    rel IS NULL,
                                    'A :%s node was modified by this %s action (%s) but not explicitly marked as modified by the Action.',
                                    [head(labels(node)), action.type, reason]
                                )

                        RETURN null
                    ", {phase: "before"})
                `);
                // Pause the trigger immediately, or it will complain about the upcoming migrations themselves; the migration code will resume it
                await tx.run(`CALL apoc.trigger.pause("trackActionChanges")`);
            });
        },
        backward: async (dbWrite) => {
            await dbWrite(tx => tx.run(`CALL apoc.trigger.remove("trackActionChanges")`));
        },
    },
});
