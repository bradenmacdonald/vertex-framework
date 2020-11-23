import { C } from "../layer2/cypher-sugar";
import { UUID } from "../lib/uuid";
import { WrappedTransaction } from "../transaction";
import { VNodeRelationship, BaseVNodeType } from "../layer2/vnode-base";

/**
 * Designed for use in an "Update"-type Action, this helper method will update a relationship from the current VNode,
 * pointing to either another VNode or null. (an "x:1" relationship, e.g. "1:1" or "many:1")
 */
export async function updateToOneRelationship<VNT extends BaseVNodeType>({from, rel, tx, newId, allowNull}: {
    from: [vnt: VNT, uuid: UUID],
    rel: VNodeRelationship,
    tx: WrappedTransaction,
    newId: string|null,
    allowNull: boolean,
}): Promise<{previousUuid: UUID|null}> {
    const [fromType, fromUuid] = from;
    if (fromType.rel[rel.label] !== rel) {
        throw new Error(`Mismatch between relationship ${rel.label} and VNodeType ${fromType.label} which doesn't declare that exact relationship.`);
    }
    if (rel.to === undefined || rel.to.length !== 1) {
        throw new Error("Unsupported: updateToOneRelationship doesn't yet work on relationships to multiple labels");
    }
    const targetLabel = rel.to[0].label;

    if (newId === null) {
        // We want to clear this x:1 relationship (set it to null)
        if (!allowNull) {
            throw new Error(`The x:1 relationship ${fromType.name}.${rel.label} is not allowed to be null.`);
        }
        // Simply delete any existing relationship, returning the ID of the target.
        const delResult = await tx.query(C`
            MATCH (:${fromType} {uuid: ${fromUuid}})-[rel:${rel}]->(target:${C(targetLabel)}:VNode)
            DELETE rel
        `.RETURN({"target.uuid": "uuid"}));
        return {previousUuid: delResult.length ? delResult[0]["target.uuid"] : null};
    } else {
        // We want this x:1 relationship pointing to a specific node, identified by "newId"
        const mergeResult = await tx.queryOne(C`
            MATCH (self:${fromType} {uuid: ${fromUuid}})
            MATCH (target:${C(targetLabel)}), target HAS KEY ${newId}
            MERGE (self)-[rel:${rel}]->(target)

            WITH self, target
            OPTIONAL MATCH (self)-[oldRel:${rel}]->(oldTarget) WHERE oldTarget <> target
            DELETE oldRel

            WITH collect(oldTarget {.uuid}) AS oldTargets
        `.RETURN({"oldTargets": {list: {map: {uuid: "uuid"}}}}));
        // The preceding query will have updated the x:1 relationship; if any previous node was the target of this
        // relationship, that relationship(s) has been delete and its ID returned (for undo purposes).
        // If the MERGE succeeded, there will be one row in the result; otherwise zero (regardless of whether or not
        // an oldTarget(s) was found), so an error will be raised by queryOne() if this failed (e.g. newId was invalid)
        return {
            previousUuid: mergeResult.oldTargets.length ? mergeResult.oldTargets[0]["uuid"] : null
        };
    }
}


interface RelationshipSpec {
    key: string|UUID;
    [relPropName: string]: any;
}
