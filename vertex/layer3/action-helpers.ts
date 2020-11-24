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

/**
 * Designed for use in an "Update"-type Action, this helper method will update a relationship from the current VNode,
 * pointing to many other another VNodes (a "1:many" or "many:many" relationship).
 * 
 * This method will always "overwrite" the relationship, replacing any existing relationships of the specified type from
 * the "from" node, and resetting their properties to the newly specified ones.
 * 
 * This method does allow multiple relationships of the same type between the same from/to nodes, so for example you
 * cannot use this method to say both
 *     (Bob)-[:ATE {on: tuesday}]->(Hamburger) and
 *     (Bob)-[:ATE {on: wednesday}]->(Hamburger)
 * 
 * TODO: optionally allow enforcing uniqueness of targets
 */
export async function updateToManyRelationship<VNT extends BaseVNodeType>({from, rel, tx, newTargets}: {
    from: [vnt: VNT, uuid: UUID],
    rel: VNodeRelationship,
    tx: WrappedTransaction,
    newTargets: RelationshipSpec[],
}): Promise<{previousRelationshipsList: RelationshipSpec[]}> {
    const [fromType, fromUuid] = from;
    if (fromType.rel[rel.label] !== rel) {
        throw new Error(`Mismatch between relationship ${rel.label} and VNodeType ${fromType.label} which doesn't declare that exact relationship.`);
    }

    const targetLabels = rel.to?.map(tn => tn.label) || ["VNode"];

    // Query the existing target node(s). (In an "IS_A" relationship, "target" means "parent")
    const relResult = await tx.query(C`
        MATCH (:${fromType} {uuid: ${fromUuid}})-[rel:${rel}]->(target:VNode)
        RETURN properties(rel) as oldProps, id(rel) as oldRelId, target.uuid, target.shortId
    `.givesShape({"oldProps": "any", "oldRelId": "number", "target.uuid": "string", "target.shortId": "string"}));
    const previousRelationshipsList: RelationshipSpec[] = relResult.map(r => ({key: r["target.uuid"], ...r["oldProps"]}));

    // We'll build a list of all existing relationships, and remove entries from it as we find that they're supposed to be kept
    const existingRelationshipIdsToDelete = new Set<number>(relResult.map(e => e.oldRelId));

    // Create relationships to new target nodes(s):
    for (const {key, ...newProps} of newTargets) {
        // TODO: proper deep comparison instead of JSON.stringify() here.
        const identicallExistingRelationship = relResult.find(el => (
            (el["target.uuid"] === key || el["target.shortId"] === key)
            && JSON.stringify(el["oldProps"]) === JSON.stringify(newProps)
        ));
        if (identicallExistingRelationship) {
            // This relationship already exists. Remove this relationship from our list of relationships to delete:
            existingRelationshipIdsToDelete.delete(identicallExistingRelationship.oldRelId);
        } else {
            // Create this relationship, with the specified properties:
            const result = await tx.query(C`
                MATCH (self:${fromType} {uuid: ${fromUuid}})
                MATCH (target), target HAS KEY ${key}
                WHERE ${C(targetLabels.map(targetLabel => `target:${targetLabel}`).join(" OR "))}
                CREATE (self)-[rel:${rel}]->(target)
                SET rel = ${newProps}
            `.RETURN({}));  // Return null, and ensure the query changed one record exactly
            if (result.length !== 1) {
                // The query above will only not return a single row if one of the MATCH clauses failed to match.
                // Which one? Let's give a helpful error message.
                const self = await tx.query(C`MATCH (self:${fromType} {uuid: ${fromUuid}})`.RETURN({"self.uuid": "uuid"}));
                if (self.length !== 1) {
                    throw new Error(`Cannot set ${rel.label} relationship from non-existent ${fromType.name} node with UUID ${fromUuid}`);
                } else {
                    throw new Error(`Cannot set ${rel.label} relationship to VNode with key "${key}" which doesn't exist or is the wrong type.`);
                }
            }
        }
    }
    if (existingRelationshipIdsToDelete.size > 0) {
        // Delete relationships that we no longer want:
        await tx.query(C`
            MATCH (:${fromType} {uuid: ${fromUuid}})-[rel:${rel}]->(:VNode)
            WHERE id(rel) in ${Array.from(existingRelationshipIdsToDelete)}
            DELETE rel
        `);
    }
    return {previousRelationshipsList};
}
