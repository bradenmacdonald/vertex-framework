/**
 * The core database Schema for Actions in a Vertex Framework Application
 */
import { Migration } from "../vertex-interface";
import { VNID } from "../lib/types/vnid";

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
            // to the database. This makes it easy to undo the action by reverting the changes.
            //
            // Note that actions are still required to explicitly/manually specify the IDs of all VNodes that they
            // modify, for two reasons:
            // (1) in case they want to mark a node as modified that this trigger wouldn't normally mark, such as the
            //     "to" end of a relationship (especially in case of a symmetrical relationship)
            // (2) so that we can run validation on every modified node _before_ committing the transaction. It's not
            //     currently possible to get the "list of nodes the transaction will modify" without also attempting to
            //     commit the transaction, and we need to run the validation before we attempt to commit.

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


                            // Add details to the [:MODIFIED] relationship for every created nodes:
                            // $createdNodes is a list of nodes
                            [
                                n IN $createdNodes WHERE NOT n:Action AND NOT n:SlugId
                                | {modifiedNode: n, changeDetails: {created: apoc.text.join(labels(n), ',')}}
                            ] AS createdNodes,


                            // Add details to the [:MODIFIED] relationship for every label added (but ignore newly
                            // created nodes). Changing labels is most commonly going to happen as a way of 'soft
                            // deleting' VNodes.
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
                                WHERE (pair.node:VNode OR pair.node:DeletedVNode) AND NOT pair.node in $createdNodes
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
                                WHERE (pair.node:VNode OR pair.node:DeletedVNode) AND NOT pair.node in $deletedNodes
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
                                WHERE changedPropData.node:VNode AND changedPropData.node<>action
                                | {modifiedNode: changedPropData.node, changeDetails: apoc.map.fromValues([
                                    'newProp:' + changedPropData.key, changedPropData.new,
                                    'oldProp:' + changedPropData.key, changedPropData.old
                                ])}
                            ] as newPropertyNodes,


                            // Add details to the [:MODIFIED] relationship for every created relationship
                            // $createdRelationships is a list of relationships
                            [
                                rel IN $createdRelationships
                                WHERE startNode(rel):VNode AND startNode(rel)<>action AND endNode(rel)<>action
                                | {
                                    modifiedNode: startNode(rel),
                                    changeDetails: apoc.map.fromValues([
                                        'newRel:' + id(rel) + ':' + type(rel), endNode(rel).id
                                    ] + apoc.coll.flatten([
                                        p IN keys(rel) | ['newRelProp:' + id(rel) + ':' + p, rel[p]]
                                    ]))
                                }
                            ] as newRelationships,


                            // Add details to the [:MODIFIED] relationship for every created relationship
                            // $deletedRelationships is a list of relationships
                            [
                                rel IN $deletedRelationships
                                WHERE startNode(rel):VNode AND startNode(rel)<>action AND endNode(rel)<>action
                                | {
                                    modifiedNode: startNode(rel),
                                    changeDetails: apoc.map.fromValues([
                                        'deletedRel:' + id(rel) + ':' + type(rel), endNode(rel).id
                                    ] + apoc.coll.flatten([
                                        p IN keys(rel) | ['deletedRelProp:' + id(rel) + ':' + p, rel[p]]
                                    ]))
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
                                    NOT changedRelPropData.relationship IN $deletedRelationships
                                | {modifiedNode: null, errorReason: 'Changing relationship properties is not supported by Vertex Framework. Delete and re-create it instead.'}
                                // ^ We can't raise an error here, but adding an entry with {modifiedNode: null} will raise an exception later.
                            ] as preventRelChanges


                        UNWIND (createdNodes + newLabels + removedLabels + newPropertyNodes + newRelationships + deletedRelationships + preventRelChanges) AS change
                            WITH action, change.modifiedNode AS modifiedNode, change.changeDetails AS changeDetails, change.errorReason AS errorReason
                                OPTIONAL MATCH (action)-[modRel:MODIFIED]->(modifiedNode)
                                    CALL apoc.util.validate(modifiedNode IS NULL, errorReason, [])
                                    CALL apoc.util.validate(
                                        modRel IS NULL,
                                        'A :%s node was modified by this %s action (%s) but not explicitly marked as modified by the Action.',
                                        [last(labels(modifiedNode)), action.type, head(keys(changeDetails))]
                                    )
                                    SET modRel += changeDetails

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
