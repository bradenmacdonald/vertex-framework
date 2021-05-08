/**
 * The core database Schema for Actions in a Vertex Framework Application
 */
import { Migration } from "../vertex-interface";
import { VNID } from "../lib/vnid";

// The VNID of the system user.
export const SYSTEM_VNID: VNID = VNID("_0");

export const migrations: Readonly<{[id: string]: Migration}> = Object.freeze({
    // ES6 objects preserve string key order, so these migrations don't need numbers, only string IDs.
    systemUser: {
        dependsOn: ["vnode", "slugIdTrigger"],
        forward: async (dbWrite) => {
            // Create the system user. This is a "bootstrap" User/Action because every user must be created via an
            // action and every action must be performed by a user. So here the system user creates itself.
            await dbWrite(tx => tx.run(`
                CREATE (u:User:VNode {
                    id: "${SYSTEM_VNID}",
                    slugId: "user-system",
                    fullName: "System"
                })-[:PERFORMED]->(a:Action:VNode {
                    id: "${VNID()}",
                    type: "CreateUser",
                    data: "{}",
                    timestamp: datetime(),
                    tookMs: 0
                })
            `));
        },
        backward: async (dbWrite) => {
            await dbWrite(tx => tx.run(`MATCH (u:User:VNode {id: "${SYSTEM_VNID}"}) DETACH DELETE u`));
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
                                n IN $createdNodes WHERE NOT n:Action AND NOT n:SlugId
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
                                    [last(labels(node)), action.type, reason]
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
