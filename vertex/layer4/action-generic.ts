import { VNID } from "../lib/types/vnid.ts";
import { C, CypherQuery } from "../layer2/cypher-sugar.ts";
import { Action, defineAction } from "./action.ts";
import { getActionChanges } from "./action-changes.ts";

/**
 * A generic action that can run arbitrary cypher, meant only for use in tests.
 */
export const GenericCypherAction = defineAction({
    type: `GenericCypherAction`,
    parameters: {} as {
        cypher: CypherQuery,
        modifiedNodes?: VNID[],
        description?: string,
    },
    apply: async (tx, data) => {
        await tx.query(data.cypher);
        return {
            resultData: {},
            modifiedNodes: data.modifiedNodes ?? [],
            description: data.description || `Generic action modified ${(data.modifiedNodes ?? []).length} VNode(s)`,
        };
    },
});

export class UndoConflictError extends Error {}

/**
 * A generic action that can run undo almost any action, except those with side effects or that permanently deleted
 * data.
 */
 export const UndoAction = defineAction({
    type: `UndoAction`,
    parameters: {} as {
        actionId: VNID,
    },
    apply: async (tx, data) => {
        // Make sure the actionId to undo exists, and that it hasn't already been undone.
        // Note that code in the action-runner will set the REVERTED relationship once this undo action succeeds.
        const prevAction = await tx.pullOne(Action, a => a.description.revertedBy(ra => ra.id), {key: data.actionId});
        if (prevAction.revertedBy !== null) {
            throw new UndoConflictError("That action was already undone.");
        }
        const changes = await getActionChanges(tx, data.actionId);

        if (changes.deletedNodeIds.length > 0) {
            throw new UndoConflictError("Cannot undo an Action that permanently deleted data.");
        }

        // Restore any deleted relationships
        if (changes.deletedRelationships.length > 0) {
            const relsCreated = await tx.query(C`
                UNWIND ${changes.deletedRelationships} AS deletedRelationship
                MATCH (from:VNode {id: deletedRelationship.from})
                MATCH (to:VNode {id: deletedRelationship.to})
                CALL apoc.create.relationship(from, deletedRelationship.type, deletedRelationship.properties, to) YIELD rel
                RETURN rel
            `);
            if (relsCreated.length !== changes.deletedRelationships.length) {
                throw new UndoConflictError("One of the nodes relationships deleted by that action cannot be re-created; cannot undo.");
            }
        }

        // Change any modified properties
        if (changes.modifiedNodes.length > 0) {
            const nodesWithModifiedProperties = await tx.query(C`
                UNWIND ${changes.modifiedNodes} AS change
                MATCH (node:VNode {id: change.id})
                WITH node, change
                    UNWIND keys(change.properties) as changedPropName
                    WITH node, change.properties[changedPropName].old AS oldValue, change.properties[changedPropName].new AS newValue, changedPropName
                    WHERE (newValue IS NULL AND node[changedPropName] IS NULL) OR (node[changedPropName] = newValue)
                        CALL apoc.create.setProperty(node, changedPropName, oldValue) YIELD node AS node2
                        RETURN NULL AS x
            `);
            if (nodesWithModifiedProperties.length !== changes.modifiedNodes.length) {
                throw new UndoConflictError("One of the node properties changed by that action has since been changed; cannot undo.");
            }
        }

        // Delete any created relationships
        if (changes.createdRelationships.length > 0) {
            const relsDeleted = await tx.query(C`
                UNWIND ${changes.createdRelationships} AS createdRelationship
                MATCH (from:VNode {id: createdRelationship.from})-[rel]->(to:VNode {id: createdRelationship.to})
                WHERE type(rel) = createdRelationship.type AND properties(rel) = createdRelationship.properties
                WITH createdRelationship, head(collect(rel)) AS rel  // This ensures we only delete one relationship per "createdRelationship", in case multiple identical relationships exist.
                DELETE rel
                RETURN NULL
            `);
            if (relsDeleted.length !== changes.createdRelationships.length) {
                throw new UndoConflictError("One of the relationships created by that action cannot be deleted; cannot undo.");
            }
        }

        // Delete any created nodes, but also verify that they haven't been modified since they were created.
        if (changes.createdNodes.length > 0) {
            const result = await tx.query(C`
                UNWIND ${changes.createdNodes} as createdNode
                MATCH (n:VNode) WHERE n.id = createdNode.id AND properties(n) = createdNode.properties
                DETACH DELETE n
                RETURN NULL
            `);
            if (result.length !== changes.createdNodes.length) {
                throw new UndoConflictError("One of the nodes created by that action has since been modified or deleted; cannot undo.");
            }
        }

        const modifiedNodes = new Set<VNID>();
        changes.createdNodes.forEach(cn => modifiedNodes.add(cn.id));
        changes.createdRelationships.forEach(cr => modifiedNodes.add(cr.from));
        changes.deletedRelationships.forEach(dr => modifiedNodes.add(dr.from));
        changes.modifiedNodes.forEach(mn => modifiedNodes.add(mn.id));

        return {
            resultData: {},
            modifiedNodes: Array.from(modifiedNodes),
            description: `Reverted ${Action.withId(data.actionId)}`
        };
    },
});
