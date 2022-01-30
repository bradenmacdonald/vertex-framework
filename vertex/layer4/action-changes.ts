import { Neo4j } from "../deps.ts";
import { C } from "../layer2/cypher-sugar.ts";
import { VNID } from "../lib/key.ts";
import { Field } from "../lib/types/field.ts";
import { WrappedTransaction } from "../transaction.ts";
import { Action } from "./action.ts";

type RawPropertyValue = string|bigint|number|boolean|Neo4j.Date|Neo4j.DateTime;

export interface ActionChangeSet {
    createdNodes: {
        id: VNID;
        labels: Set<string>;
        properties: Record<string, RawPropertyValue>;
    }[];
    modifiedNodes: {
        id: VNID;
        properties: Record<string, {old: null|RawPropertyValue; new: null|RawPropertyValue}>;
    }[];
    createdRelationships: {
        type: string;
        from: VNID;
        to: VNID;
        properties: Record<string, RawPropertyValue>;
    }[];
    deletedRelationships: {
        type: string;
        from: VNID;
        to: VNID;
        properties: Record<string, RawPropertyValue>;
    }[];
    softDeletedNodes: VNID[];
    unDeletedNodes: VNID[];
    // The ID of nodes that were permanently deleted.
    deletedNodeIds: VNID[];
}

// Change Types - see "nodeChanges" comment in getActionChanges
const enum chg {
    created = "created",
    addedLabel = "addedLabel",
    removedLabel = "removedLabel",
    newProp = "newProp",
    oldProp = "oldProp",
    newRel = "newRel",
    newRelProp = "newRelProp",
    deletedRel = "deletedRel",
    deletedRelProp = "deletedRelProp",
}

/**
 * Get the details of the changes made by a previously-successful Action.
 * 
 * This returns changes at the database level and returns properties as basic Neo4j data types, not Vertex Framework
 * types. The reason for this is that converting to Vertex types requires the VNode schema, and the VNode schema may
 * have changed since the action was run.
 * @param tx The read transaction to use
 * @param actionId The VNID of the action in question
 * @returns an ActionChangeSet
 */
export async function getActionChanges(tx: WrappedTransaction, actionId: VNID): Promise<ActionChangeSet> {
    const changes: ActionChangeSet = {
        createdNodes: [],
        modifiedNodes: [],
        createdRelationships: [],
        deletedRelationships: [],
        softDeletedNodes: [],
        unDeletedNodes: [],
        deletedNodeIds: [],
    };

    const result = await tx.query(C`
        MATCH (a:Action {id: ${actionId}})
        OPTIONAL MATCH (a)-[modRel:${Action.rel.MODIFIED}]->(node)
        WHERE node:VNode OR node:DeletedVNode
    `.RETURN({"a.deletedNodeIds": Field.List(Field.VNID), modRel: Field.NullOr.Relationship, node: Field.NullOr.Node}));

    if (result.length === 0) {
        throw new Error("Action not found.");
    }

    changes.deletedNodeIds = result[0]["a.deletedNodeIds"];

    for (const {modRel, node} of result) {
        if (node === null || modRel === null) {
            continue;  // This action didn't modify any nodes, but the query above still returned one result row because we used OPTIONAL MATCH
        }
        const nodeChanges = modRel.properties;
        // nodeChanges contains key-value pairs set by the trackActionChanges trigger.
        // > "created": [Label1, Label2]          if the node was created by this action
        // > "addedLabel:Label"                   if a label was added to an existing node
        // > "removedLabel:Label"                 if a label was removed from an existing node
        // > "newProp:PropName": propValue        if a property was set to a non-null value
        // > "oldProp:PropName": prevValue        if a property was changed or deleted, this was the previous value
        // > "newRel:<#>": [REL_TYPE, toVNID]     if a new relationship was created (# is the temporary relationship index, not to be used outside of this [trans]action)
        // > "newRelProp:<#>:propName": propValue if properties were set on the new relationship
        // > "deletedRel:<#>": [REL_TYPE, toVNID] if a relationship was deleted
        // > "deletedRelProp:<#>:propName": val   if properties existed on the deleted relationship
        if (nodeChanges.created) {
            // This is a newly-created VNode
            const createdNode = {
                labels: new Set((nodeChanges.created as string[])),
                id: VNID(nodeChanges["newProp:id"] ?? "error: missing ID"),
                properties: {} as Record<string, RawPropertyValue>,
            };
            if (createdNode.id !== node.properties.id) {
                throw new Error(`VNode ID unexpectedly changed?`);
            }
            for (const changeKey in nodeChanges) {
                const changeType = changeKey.split(":")[0];  // changeType is "addedLabel", "newProp", etc.
                if (changeType === chg.created) {
                    continue;
                } else if (changeType === chg.newProp) {
                    // Properties that were set on this newly created VNode:
                    const propName = changeKey.substring(chg.newProp.length + 1);  // we allow property names to include ":" so don't use split() here.
                    createdNode.properties[propName] = nodeChanges[changeKey];
                } else if (changeType === chg.newRel) {
                    const relId = changeKey.split(":")[1];  // This is a non-permanent numeric relationship ID, as a string
                    const [relType, toVNID] = nodeChanges[changeKey];
                    const propPrefix = `${chg.newRelProp}:${relId}:`;
                    changes.createdRelationships.push({
                        type: relType,
                        from: node.properties.id,
                        to: toVNID,
                        properties: Object.fromEntries(
                            Object.keys(nodeChanges).filter(ck => ck.startsWith(propPrefix)).map(ck =>
                                // For each relationship property, this is the [propName, raw prop value]
                                [ck.substring(propPrefix.length), nodeChanges[ck]],
                            )
                        ),
                    });
                } else if (changeType === chg.newRelProp) {
                    continue;  // Handled in newRel, above
                } else if (changeType === chg.addedLabel || changeType === chg.removedLabel || changeType === chg.oldProp || changeType === chg.deletedRel) {
                    throw new Error(`Newly created nodes cannot have changes of type "${changeType}" (${changeKey}).`);
                } else {
                    throw new Error(`Unknown change on created VNode: ${changeKey}`);
                }
            }
            changes.createdNodes.push(createdNode);
        } else {
            // This existing node was modified in some way:
            const nodeId = VNID(node.properties.id ?? "error: missing VNID");

            // First handle any changes to labels:
            if (`${chg.addedLabel}:DeletedVNode` in nodeChanges && `${chg.removedLabel}:VNode` in nodeChanges) {
                changes.softDeletedNodes.push(nodeId);
                delete nodeChanges[`${chg.addedLabel}:DeletedVNode`];
                delete nodeChanges[`${chg.removedLabel}:VNode`];
            } else if (`${chg.addedLabel}:VNode` in nodeChanges && `${chg.removedLabel}:DeletedVNode` in nodeChanges) {
                changes.unDeletedNodes.push(nodeId);
                delete nodeChanges[`${chg.addedLabel}:VNode`];
                delete nodeChanges[`${chg.removedLabel}:DeletedVNode`];
            }
            const remainingLabelChanges = Object.keys(nodeChanges).filter(chgKey => chgKey.startsWith(chg.addedLabel) || chgKey.startsWith(chg.removedLabel));
            if (remainingLabelChanges.length > 0) {
                throw new Error(`Unsupported changes to VNode labels (${remainingLabelChanges.join(", ")}).`);
            }

            // Now handle the remaining changes:
            const result = {
                id: nodeId,
                properties: {} as Record<string, {old: null|RawPropertyValue; new: null|RawPropertyValue}>,
            }
            for (const changeKey in nodeChanges) {
                const changeType = changeKey.split(":")[0];  // changeType is "addedLabel", "newProp", etc.
                if (changeType === chg.newProp) {
                    // A new property value:
                    const propName = changeKey.substr(chg.newProp.length + 1);  // we allow property names to include ":" so don't use split() here.
                    if (!result.properties[propName]) {
                        result.properties[propName] = {old: null, new: nodeChanges[changeKey]};  // old will be set later if non-null, see beow
                    } else {
                        result.properties[propName].new = nodeChanges[changeKey];
                    }
                } else if (changeType === chg.oldProp) {
                    // Keep track of old property values and/or removed properties:
                    const propName = changeKey.substr(chg.oldProp.length + 1);  // we allow property names to include ":" so don't use split() here.
                    if (!result.properties[propName]) {
                        result.properties[propName] = {old: nodeChanges[changeKey], new: null};
                    } else {
                        result.properties[propName].old = nodeChanges[changeKey];
                    }
                } else if (changeType === chg.newRel) {
                    const relId = changeKey.split(":")[1];  // This is a non-permanent numeric relationship ID, as a string
                    const [relType, toVNID] = nodeChanges[changeKey];
                    const propPrefix = `${chg.newRelProp}:${relId}:`;
                    changes.createdRelationships.push({
                        type: relType,
                        from: node.properties.id,
                        to: toVNID,
                        properties: Object.fromEntries(
                            Object.keys(nodeChanges).filter(ck => ck.startsWith(propPrefix)).map(ck =>
                                // For each relationship property, this is the [propName, raw prop value]
                                [ck.substring(propPrefix.length), nodeChanges[ck]],
                            )
                        ),
                    });
                } else if (changeType === chg.deletedRel) {
                    const relId = changeKey.split(":")[1];  // This is a non-permanent numeric relationship ID, as a string
                    const [relType, toVNID] = nodeChanges[changeKey];
                    const propPrefix = `${chg.deletedRelProp}:${relId}:`;
                    changes.deletedRelationships.push({
                        type: relType,
                        from: node.properties.id,
                        to: toVNID,
                        properties: Object.fromEntries(
                            Object.keys(nodeChanges).filter(ck => ck.startsWith(propPrefix)).map(ck =>
                                // For each relationship property, this is the [propName, raw prop value]
                                [ck.substring(propPrefix.length), nodeChanges[ck]],
                            )
                        ),
                    });
                } else if (changeType === chg.newRelProp || changeType === chg.deletedRelProp) {
                    continue;  // Handled in newRel and deletedRel, above
                } else {
                    throw new Error(`Unknown/unexpected change on modified VNode: ${changeKey}`);
                }
            }

            // Include this in the list of modified nodes, but only if some property values were actually changed
            if (Object.keys(result.properties).length > 0) {
                changes.modifiedNodes.push(result);
            }
        }
    }

    return changes;
}