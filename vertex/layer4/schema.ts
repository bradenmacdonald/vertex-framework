/**
 * The core database Schema for Actions in a Vertex Framework Application
 */
import { Migration } from "../vertex-interface.ts";
import { VNID } from "../lib/types/vnid.ts";

// The VNID of the system user.
export const SYSTEM_VNID: VNID = VNID("_0");

export const migrations: Readonly<{[id: string]: Migration}> = Object.freeze({
    // ES6 objects preserve string key order, so these migrations don't need numbers, only string IDs.
    systemUser: {
        dependsOn: ["vnode"],
        forward: async (dbWrite) => {
            // Create the system user. This is a "bootstrap" User/Action because every user must be created via an
            // action and every action must be performed by a user. So here the system user creates itself.
            await dbWrite(tx => tx.run(`
                CREATE (u:User:VNode {
                    id: "${SYSTEM_VNID}",
                    username: "system",
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
    requireAction: {
        dependsOn: ["vnode"],
        forward: async (dbWrite) => {
            // Other than migrations, all changes (writes) to the database must be associated with an "Action";
            // the Action node will be automatically created as part of the write transaction by the action-runner code.
            await dbWrite(async tx => {
                await tx.run(`
                    CALL apoc.trigger.add("requireAction", "

                        WITH [n IN $createdNodes WHERE n:Action:VNode] AS actions
                            CALL apoc.util.validate(
                                size(actions) <> 1,
                                'every data write transaction should be associated with one Action, found %d', [size(actions)]
                            )
                            RETURN null

                    ", {phase: "before"})
                `);
                // Pause the trigger immediately, or it will complain about the upcoming migrations themselves; the migration code will resume it
                await tx.run(`CALL apoc.trigger.pause("requireAction")`);
            });
        },
        backward: async (dbWrite) => {
            await dbWrite(`CALL apoc.trigger.remove("requireAction")`);
        },
    },
    validateActionModified: {
        dependsOn: ["vnode", "requireAction"],
        forward: async (dbWrite) => {
            // Other than migrations, all changes (writes) to the database must be associated with an "Action";
            // the Action node will be automatically created as part of the write transaction by the action-runner code.
            //
            // Actions are required to explicitly/manually specify the IDs of all VNodes that they modify, for two
            // reasons:
            // (1) in case they want to mark a node as modified that this trigger wouldn't normally mark, such as the
            //     "to" end of a relationship (especially in case of a symmetrical relationship)
            // (2) so that we can run validation on every modified node _before_ committing the transaction. It's not
            //     currently possible to get the "list of nodes the transaction will modify" without also attempting to
            //     commit the transaction, and we need to run the validation before we attempt to commit.
            //
            // This trigger enforces that.
            //
            // Important: Creating a relationship (a)-[:REL]->(b) only counts as modifying (a), not (b)
            // However, actions can also include (b) in their list of modified nodes if they think it's useful.

            await dbWrite(async tx => {
                await tx.run(`
                    CALL apoc.trigger.add("validateActionModified", "

                        // Start with a MATCH so this trigger only runs when there is an action in the transaction
                        MATCH (action:Action:VNode)
                            WHERE id(action) IN [cn IN $createdNodes WHERE cn:Action | id(cn)]

                        WITH action,

                            // $createdNodes is [list of nodes]
                            [
                                node IN $createdNodes
                                | node
                            ] AS createdNodes,

                            // $assignedLabels is a map: {label: [list of nodes]}
                            //    e.g. {foo: [1, 2], bar: [4]} where 1,2,4 are nodes
                            [
                                node IN apoc.coll.flatten([k in keys($assignedLabels) | $assignedLabels[k]])
                                | node
                            ] AS newLabelNodes,

                            // $removedLabels is a map: {label: [list of nodes]}
                            [
                                node IN apoc.coll.flatten([k in keys($removedLabels) | $removedLabels[k]])
                                | node
                            ] AS removedLabelNodes,

                            // $assignedNodeProperties is map: {key: [list of {key,old,new,node}]}
                            [
                                entry IN apoc.coll.flatten([k in keys($assignedNodeProperties) | $assignedNodeProperties[k]])
                                | entry.node
                            ] AS newPropertyNodes,

                            // $removedNodeProperties is map: {key: [list of {key,old,node}]}
                            [
                                entry IN apoc.coll.flatten([k in keys($removedNodeProperties) | $removedNodeProperties[k]])
                                | entry.node
                            ] AS removedPropertyNodes,

                            // $createdRelationships is a list of relationships
                            [
                                rel IN $createdRelationships
                                WHERE endNode(rel):VNode AND endNode(rel) <> action
                                | startNode(rel)
                            ] as newRelationshipNodes,

                            // $deletedRelationships is a list of relationships
                            [
                                rel IN $deletedRelationships
                                WHERE endNode(rel):VNode AND endNode(rel) <> action
                                | startNode(rel)
                            ] as deletedRelationshipNodes,

                            // $assignedRelationshipProperties is a map: {key: [list of {key,old,new,relationship}]}
                            // $removedRelationshipProperties is a map: {key: [list of {key,old,relationship}]}
                            [
                                changedRelPropData IN apoc.coll.flatten(
                                    [k in keys($assignedRelationshipProperties) | $assignedRelationshipProperties[k]] +
                                    [k in keys($removedRelationshipProperties) | $removedRelationshipProperties[k]]
                                )
                                WHERE endNode(changedRelPropData.relationship):VNode
                                | startNode(changedRelPropData.relationship)
                            ] as updatedRelationshipPropertyNodes

                        WITH action, (createdNodes + newLabelNodes + removedLabelNodes + newPropertyNodes + removedPropertyNodes + newRelationshipNodes + deletedRelationshipNodes + updatedRelationshipPropertyNodes) AS changedNodes
                        UNWIND changedNodes AS modifiedNode
                        WITH DISTINCT action, modifiedNode
                            WHERE modifiedNode:VNode AND NOT modifiedNode:Action

                            OPTIONAL MATCH (action)-[modRel:MODIFIED]->(modifiedNode)
                                CALL apoc.util.validate(
                                    modRel IS NULL,
                                    'A %s node was modified by this action but not explicitly marked as modified by the Action.',
                                    [last(labels(modifiedNode))]
                                )
                                RETURN null
                    ", {phase: "before"})
                `);
            });
        },
        backward: async (dbWrite) => {
            await dbWrite(`CALL apoc.trigger.remove("validateActionModified")`);
        },
    },
    trackActionDeletes: {
        dependsOn: ["vnode", "requireAction"],
        forward: async (dbWrite) => {
            // When an action fully deletes a VNode, we lose track of that VNode - so record that the action deleted a
            // VNode with the given ID.

            await dbWrite(async tx => {
                await tx.run(`
                    CALL apoc.trigger.add("trackActionDeletes", "

                        // Start with a MATCH so this trigger only runs when there is an action in the transaction
                        MATCH (action:Action:VNode)
                            WHERE id(action) IN [cn IN $createdNodes WHERE cn:Action | id(cn)]

                        WITH action
                            WHERE size($deletedNodes) > 0  // Stop the trigger here if no nodes were deleted.

                        // Record the IDs of any VNodes deleted by this action
                        SET action.deletedNodeIds = [
                            dn IN $deletedNodes WHERE dn IN $removedLabels['VNode']
                            | head([entry IN $removedNodeProperties['id'] WHERE entry.node = dn]).old  // This gets the ID of the deleted node. dn.id won't work because the node is deleted
                        ]

                    ", {phase: "before"})
                `);
            });
        },
        backward: async (dbWrite) => {
            await dbWrite(`CALL apoc.trigger.remove("trackActionDeletes")`);
        },
    },
});
