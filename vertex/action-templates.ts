import { UUID } from "./lib/uuid";
import { WrappedTransaction } from "./transaction";
import { VNodeType } from "./vnode";

/**
 * Designed for use in an "Update"-type Action, this helper method will update relationships from a node to other nodes.
 * It expects data of the form [[shortId/UUID, weight], ...] where each [shortId/UUID, weight] pair represents a
 * relationship from the current TechNode (of type "tn") to another node, such as a parent of the same type.
 * 
 * "newRelationshipsList" must be a complete list of all the target nodes for this relationship, as any existing target
 * nodes with that relationship will not be related anymore if they aren't in the list.
 */
export async function updateOneToOneRelationship<VNT extends VNodeType>({fromType, uuid, tx, relName, newId, allowUndefined}: {
    fromType: VNT,
    relName: keyof VNT["relationshipsFrom"],
    uuid: UUID,
    tx: WrappedTransaction,
    newId: string|undefined,
    allowUndefined: boolean,
}): Promise<{previousUuid: UUID|undefined}> {
    const label = fromType.label;
    if (fromType.relationshipsFrom[relName as any]?.toLabels?.length !== 1) {
        throw new Error("Unsupported: updateOneToOneRelationship doesn't yet work on relationships to multiple labels");
    }
    const targetLabel = fromType.relationshipsFrom[relName as any].toLabels[0];

    if (newId === undefined) {
        // We want to clear this 1:1 relationship (set it to undefined)
        if (!allowUndefined) {
            throw new Error(`The 1:1 relationship ${fromType.name}.${relName} is not allowed to be undefined.`);
        }
        // Simply delete any existing relationship, returning the ID of the target.
        const delResult = await tx.query(`
            MATCH (:${label} {uuid: $uuid})-[rel:${relName}]->(target:${targetLabel})
            DELETE rel
        `, {uuid, }, {"target.uuid": "uuid"});
        return {previousUuid: delResult.length ? delResult[0]["target.uuid"] : undefined};
    } else {
        // We want this 1:1 relationship pointing to a specific node, identified by "newId"
        const mergeResult = await tx.queryOne(`
            MATCH (self:${label} {uuid: $uuid})
            MATCH (target:${targetLabel})::{$newId}
            MERGE (self)-[rel:${relName}]->(target)

            WITH self, target
            OPTIONAL MATCH (self)-[oldRel:${relName}]->(oldTarget:${targetLabel}) WHERE oldTarget <> target
            DELETE oldRel

            WITH collect(oldTarget {.uuid}) AS oldTargets
        `, {uuid, newId}, {"oldTargets": "any"});
        // The preceding query will have updated the 1:1 relationship; if any previous node was the target of this
        // relationship, that relationship(s) has been delete and its ID returned (for undo purposes).
        // If the MERGE succeeded, there will be one row in the result; otherwise zero (regardless of whether or not
        // an oldTarget(s) was found), so an error will be raised by queryOne() if this failed (e.g. newId was invalid)
        return {
            previousUuid: mergeResult.oldTargets.length ? mergeResult.oldTargets[0]["uuid"] : undefined
        };
    }
}
