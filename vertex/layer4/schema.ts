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
            //
            // The purpose of this trigger is to automatically create a record of the exact changes that an action makes
            // to the database, although it doesn't save actual property values.
            //
            // Note that actions are still required to explicitly/manually specify the IDs of all VNodes that they
            // modify, for two reasons:
            // (1) in case they want to mark a node as modified that this trigger wouldn't normally mark, such as the
            //     "to" end of a relationship (especially in case of a symmetrical relationship)
            // (2) so that we can run validation on every modified node _before_ committing the transaction. It's not
            //     currently possible to get the "list of nodes the transaction will modify" without also attempting to
            //     commit the transaction, and we need to run the validation before we attempt to commit.
            //
            // Actions specify the VNIDs of all VNodes that they modify, and the action runner code then creates a
            // -[:MODIFIED]-> relationship to every node that it modified (created, updated, soft deleted, deleted, or
            // created a relationship from).
            //
            // Important: Creating a relationship (a)-[:REL]->(b) only counts as modifying (a), not (b)
            // However, actions can also include (b) in their list of modified nodes if they think it's useful.
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

                            // Record the IDs of any VNodes deleted by this action
                            SET action.deletedNodeIds = [
                                dn IN $deletedNodes WHERE dn IN $removedLabels['VNode']
                                // | dn.id won't work because the node is deleted
                                | head([entry IN $removedNodeProperties['id'] WHERE entry.node = dn]).old  // This gets the ID of the deleted node.
                            ]

                        WITH
                            action,


                            // Add details to the [:MODIFIED] relationship for every created nodes:
                            // $createdNodes is a list of nodes
                            [
                                n IN $createdNodes WHERE NOT n:Action AND NOT n:SlugId
                                | {modifiedNode: n, changeDetails: {created: labels(n)}}
                            ] AS createdNodes,


                            // Add details to the [:MODIFIED] relationship for every label added (but ignore newly
                            // created nodes).
                            // $assignedLabels is a map of label to list of nodes
                            // The horrible apoc expressions below are necessary to convert
                            //    {foo: [1, 2], bar: [4]}
                            // to
                            //    [['foo', 1], ['foo', 2], ['bar', 4]]
                            // then to
                            //    [{label: 'foo', node: 1}, {label: 'foo', node: 2}, {label: 'bar', node: 4}]
                            [
                                pair IN [
                                    pair IN apoc.coll.flatten([k in keys($assignedLabels) | apoc.coll.zip(apoc.coll.fill(k, size($assignedLabels[k])), $assignedLabels[k])])
                                    | {label: pair[0], node: pair[1]}
                                ]
                                WHERE pair.node:VNode AND NOT pair.node in $createdNodes
                                | {modifiedNode: pair.node, changeDetails: apoc.map.fromValues([
                                    'addedLabel:' + pair.label, true
                                ])}
                            ] as newLabels,


                            // Add details to the [:MODIFIED] relationship for every label removed.
                            [
                                pair IN [
                                    pair IN apoc.coll.flatten([k in keys($removedLabels) | apoc.coll.zip(apoc.coll.fill(k, size($removedLabels[k])), $removedLabels[k])])
                                    | {label: pair[0], node: pair[1]}
                                ]
                                WHERE pair.node:VNode AND NOT pair.node IN $deletedNodes
                                | {modifiedNode: pair.node, changeDetails: apoc.map.fromValues([
                                    'removedLabel:' + pair.label, true
                                ])}
                            ] as removedLabels,


                            // Add details to the [:MODIFIED] relationship for every changed property value.
                            // We exclude recently created nodes, because their current values are just stored in the
                            // database, and rolling back the change is as simple as deleting the new node.
                            // $assignedNodeProperties is map of {key: [list of {key,old,new,node}]}
                            // $removedNodeProperties is map of {key: [list of {key,old,node}]}
                            [
                                changedPropData IN apoc.coll.flatten(
                                    apoc.map.values($assignedNodeProperties, keys($assignedNodeProperties)) +
                                    apoc.map.values($removedNodeProperties, keys($removedNodeProperties))
                                )
                                WHERE changedPropData.node:VNode AND changedPropData.node<>action AND NOT changedPropData.node IN $deletedNodes
                                | {modifiedNode: changedPropData.node, changeDetails: apoc.map.fromValues([
                                    'newProp:' + changedPropData.key, changedPropData.new,
                                    'oldProp:' + changedPropData.key, changedPropData.old
                                ])}
                            ] as newPropertyNodes,


                            // Add details to the [:MODIFIED] relationship for every created relationship
                            // $createdRelationships is a list of relationships
                            [
                                // Given [rel1, rel2, rel3], enumerate over [{idx: 0, rel: rel1}, {idx: 1, rel: rel2}, ...]
                                entry IN [v IN apoc.coll.zip(range(0, size($createdRelationships)-1), $createdRelationships) | {idx: v[0], rel: v[1]}]
                                WHERE startNode(entry.rel):VNode AND startNode(entry.rel)<>action AND endNode(entry.rel)<>action
                                | {
                                    modifiedNode: startNode(entry.rel),
                                    changeDetails: apoc.map.fromValues([
                                        'newRel:' + entry.idx, [type(entry.rel), endNode(entry.rel).id]
                                    ] + apoc.coll.flatten([
                                        p IN keys(entry.rel) | ['newRelProp:' + entry.idx + ':' + p, entry.rel[p]]
                                    ]))
                                }
                            ] as newRelationships,


                            // Add details to the [:MODIFIED] relationship for every deleted relationship
                            // $deletedRelationships is a list of relationships
                            [
                                // Given [rel1, rel2, rel3], enumerate over [{idx: 0, rel: rel1}, {idx: 1, rel: rel2}, ...]
                                entry IN [v IN apoc.coll.zip(range(0, size($deletedRelationships)-1), $deletedRelationships) | {idx: v[0], rel: v[1]}]
                                WHERE startNode(entry.rel):VNode AND startNode(entry.rel)<>action AND endNode(entry.rel)<>action AND NOT startNode(entry.rel) IN $deletedNodes AND NOT endNode(entry.rel) IN $deletedNodes
                                | {
                                    modifiedNode: startNode(entry.rel),
                                    changeDetails: apoc.map.fromValues(
                                        ['deletedRel:' + entry.idx, [type(entry.rel), endNode(entry.rel).id]]
                                        // Plus we need the removed relationship properties - they're not available on 'rel'
                                        // but we can get them from $removedRelationshipProperties
                                        + apoc.coll.flatten([
                                            chg IN apoc.coll.flatten(apoc.map.values($removedRelationshipProperties, keys($removedRelationshipProperties)))
                                            WHERE id(chg.relationship) = id(entry.rel)
                                            | ['deletedRelProp:' + entry.idx + ':' + chg.key, chg.old]
                                        ])
                                    )
                                }
                            ] as deletedRelationships,


                            // Check if any relationship properties were modified.
                            // We prohibit this because relationships don't have permanent identifiers (like VNIDs),
                            // as relationship properties cannot be indexed/unique, so there's no good way to record
                            // change history for them (if we referenced a internal ID for a relationship that was
                            // deleted and re-created, the ID may point to a totally different relationship now).
                            [
                                changedRelPropData IN apoc.coll.flatten(
                                    apoc.map.values($assignedRelationshipProperties, keys($assignedRelationshipProperties)) +
                                    apoc.map.values($removedRelationshipProperties, keys($removedRelationshipProperties))
                                )
                                WHERE 
                                    startNode(changedRelPropData.relationship):VNode AND 
                                    NOT changedRelPropData.relationship IN $createdRelationships AND
                                    NOT changedRelPropData.relationship IN $deletedRelationships AND
                                    apoc.util.validatePredicate(
                                        true,
                                        'Changing relationship properties is not supported by Vertex Framework. Delete and re-create it instead.',
                                        []
                                    )
                                | {}
                            ] as preventRelChanges


                        UNWIND (createdNodes + newLabels + removedLabels + newPropertyNodes + newRelationships + deletedRelationships + preventRelChanges) AS change
                            WITH action, change.modifiedNode AS modifiedNode, change.changeDetails AS changeDetails
                                OPTIONAL MATCH (action)-[modRel:MODIFIED]->(modifiedNode)
                                    CALL apoc.util.validate(
                                        modRel IS NULL,
                                        'A :%s node was modified by this %s action (%s) but not explicitly marked as modified by the Action.',
                                        [last(labels(modifiedNode)), action.type, head(keys(changeDetails))]
                                    )
                                    SET modRel += changeDetails

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
