import { C } from "../layer2/cypher-sugar";
import { UUID } from "../lib/uuid";
import { WrappedTransaction } from "../transaction";
import { VNodeRelationship, BaseVNodeType } from "../layer2/vnode-base";

/**
 * Designed for use in an "Update"-type Action, this helper method will update a relationship from the current VNode,
 * pointing to either another VNode or null. (an "x:1" relationship, e.g. "1:1" or "many:1")
 */
export async function updateToOneRelationship<VNT extends BaseVNodeType>({from, rel, tx, toKey, allowNull}: {
    from: [vnt: VNT, uuid: UUID],
    rel: VNodeRelationship,
    tx: WrappedTransaction,
    toKey: string|null,
    allowNull: boolean,
}): Promise<{previousUuid: UUID|null}> {
    const [fromType, fromUuid] = from;
    if (fromType.rel[rel.label] !== rel) {
        throw new Error(`Mismatch between relationship ${rel.label} and VNodeType ${fromType.label} which doesn't declare that exact relationship.`);
    }
    const targetLabels = rel.to?.map(tn => tn.label) || ["VNode"];

    if (toKey === null) {
        // We want to clear this x:1 relationship (set it to null)
        if (!allowNull) {
            throw new Error(`The x:1 relationship ${fromType.name}.${rel.label} is not allowed to be null.`);
        }
        // Simply delete any existing relationship, returning the ID of the target.
        const delResult = await tx.query(C`
            MATCH (:${fromType} {uuid: ${fromUuid}})-[rel:${rel}]->(target:VNode)
            DELETE rel
        `.RETURN({"target.uuid": "uuid"}));
        return {previousUuid: delResult.length ? delResult[0]["target.uuid"] : null};
    } else {
        // We want this x:1 relationship pointing to a specific node, identified by "toKey"
        const mergeResult = await tx.query(C`
            MATCH (self:${fromType} {uuid: ${fromUuid}})
            MATCH (target:VNode), target HAS KEY ${toKey}
            WHERE ${C(targetLabels.map(targetLabel => `target:${targetLabel}`).join(" OR "))}
            MERGE (self)-[rel:${rel}]->(target)

            WITH self, target
            OPTIONAL MATCH (self)-[oldRel:${rel}]->(oldTarget) WHERE oldTarget <> target
            DELETE oldRel

            WITH collect(oldTarget {.uuid}) AS oldTargets, target
        `.RETURN({"oldTargets": {list: {map: {uuid: "uuid"}}}}));
        if (mergeResult.length === 0) {
            throw new Error(`Cannot change ${fromType.name} relationship ${rel.label} to "${toKey}" - target not found.`);
        }
        // The preceding query will have updated the x:1 relationship; if any previous node was the target of this
        // relationship, that relationship(s) has been delete and its ID returned (for undo purposes).
        // If the MERGE succeeded, there will be one row in the result; otherwise zero (regardless of whether or not
        // an oldTarget(s) was found), so an error will be raised by queryOne() if this failed (e.g. toKey was invalid)
        return {
            previousUuid: mergeResult[0].oldTargets.length ? mergeResult[0].oldTargets[0]["uuid"] : null
        };
    }
}


interface RelationshipSpec {
    key: string|UUID;
    [relPropName: string]: any;
}
