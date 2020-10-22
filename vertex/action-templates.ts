import { ActionImplementation, defineAction, ActionData } from "./action";
import { UUID } from "./lib/uuid";
import { WrappedTransaction } from "./transaction";
import { RawVNode, VNodeType } from "./vnode";


// Useful action generators to reduce boilerplate

type UpdateImplementationDetails<UpdateArgs extends {[K: string]: any}, TNT extends VNodeType> = {
    mutableProperties: Array<keyof TNT["properties"] & keyof UpdateArgs>,
    /** If there is a need to clean any properties, this function can mutate "changes" and "previousValues" */
    clean?: (args: {
        data: {key: string} & UpdateArgs,
        nodeSnapshot: RawVNode<TNT>,
        changes: Partial<UpdateArgs>,
        previousValues: Partial<UpdateArgs>,
    }) => void,
    /** If there is a need to update relationships or complex properties, this method can do so */
    otherUpdates?: (args: {
        tx: WrappedTransaction,
        data: {key: string} & UpdateArgs,
        nodeSnapshot: RawVNode<TNT>,
    }) => Promise<{previousValues: Partial<UpdateArgs>, additionalModifiedNodes?: RawVNode<any>[]}>,
};

/**
 * Build a useful "Update" action that can apply updates to basic property values of a VNode.
 * For example, if the VNode type is "User", a default update action could be used to change
 * the username, real name, birth date, etc.
 * @param type The VNode Type that this update is for.
 * @param details Implementation details: specify which properties can be changed by the update action,
 *                and optionally provide functions to clean the property data before saving, or to
 *                do additional changes on update, such as updating relationships to other nodes.
 */
export function defaultUpdateActionFor<UpdateArgs extends {[K: string]: any}>(
    type: VNodeType,
    {mutableProperties, clean, otherUpdates}: UpdateImplementationDetails<UpdateArgs, typeof type>,
): ActionImplementation<{key: string} & UpdateArgs, {prevValues: UpdateArgs}> 
{
    const label = type.label;

    const UpdateAction = defineAction<{key: string} & UpdateArgs, {prevValues: UpdateArgs}>({
        type: `Update${label}`,
        apply: async (tx, data) => {
            // Load the current value of the VNode from the graph
            const nodeSnapshot = (await tx.queryOne(`MATCH (node:${label})::{$key}`, {key: data.key}, {node: type})).node;
            // Prepare to store the previous values of any changed properties/relationships
            let previousValues: Partial<UpdateArgs> = {};
            // Store the new values (properties that are being changed):
            const changes: any = {};
    
            // Simple Property Updates
            for (const propertyName of mutableProperties) {
                if (propertyName in data) {
                    // Do a poor man's deep comparison to see if this value is different, in case it's an array value or similar:
                    const isChanged = JSON.stringify(data[propertyName]) !== JSON.stringify(nodeSnapshot[propertyName]);
                    if (isChanged) {
                        changes[propertyName] = data[propertyName];
                        previousValues[propertyName] = nodeSnapshot[propertyName];
                    }
                }
            }
            // If there is a need to clean any properties, this function can mutate "changes" and "previousValues"
            if (clean) {
                clean({data, nodeSnapshot, changes, previousValues});
            }
            const result = await tx.queryOne(`
                MATCH (t:${label})::{$key}
                SET t += $changes
            `, {key: data.key, changes}, {t: type});
            let modifiedNodes: RawVNode<any>[] = [result.t];

            if (otherUpdates) {
                // Update relationships etc.
                const result = await otherUpdates({tx, data, nodeSnapshot});
                previousValues = {...previousValues, ...result.previousValues};
                if (result.additionalModifiedNodes) {
                    modifiedNodes = [...modifiedNodes, ...result.additionalModifiedNodes];
                }
            }
    
            return {
                resultData: {prevValues: previousValues as any},
                modifiedNodes: [result.t],
            };
        },
        invert: (data, resultData): ActionData => {
            return UpdateAction({key: data.key, ...resultData.prevValues});
        },
    });

    return UpdateAction;
}

/**
 * Build a useful "Create" action, which creates a new VNode of the specified type, along with its required
 * properties. Use <RequiredArgs> to specify the types of all required properties.
 * @param type The VNode Type to create
 * @param updateAction The Update Action, used to set any non-required properties that get specified during creation;
 *             this is just a convenience to avoid having to do a Create followed by an Update.
 */
export function defaultCreateFor<RequiredArgs, UpdateArgs>(
    VNodeType: VNodeType,
    updateAction: ActionImplementation<{key: string}&Omit<UpdateArgs, keyof RequiredArgs>, {prevValues: any}>
): ActionImplementation<RequiredArgs&{props: Omit<UpdateArgs, keyof RequiredArgs>}, {uuid: string, updateResult: any}> {
    const label = VNodeType.label;

    const CreateAction = defineAction<RequiredArgs&{props: Omit<UpdateArgs, keyof RequiredArgs>}, {uuid: UUID, updateResult: any}>({
        type: `Create${label}`,
        apply: async (tx, data) => {
            const uuid = UUID();
            const {props, type, ...requiredProps} = data;
            const result = await tx.queryOne(`CREATE (tn:${label} {uuid: $uuid}) SET tn += $requiredProps`, {uuid, requiredProps, }, {tn: VNodeType});
            const updateResult = await updateAction.apply(tx, {type: updateAction.type, key: uuid, ...props});
            return {
                resultData: { uuid, updateResult: updateResult.resultData },
                modifiedNodes: [result.tn, ...updateResult.modifiedNodes],
            };
        },
        invert: (data, resultData) => {
            return UndoCreateAction({uuid: resultData.uuid, updateResult: resultData.updateResult});
        },
    });

    const UndoCreateAction = defineAction<{uuid: string, updateResult: any}, Record<string, unknown>>({
        type: `UndoCreate${label}`,
        apply: async (tx, data) => {
            // First undo the update that may have been part of the create, since it may have created relationships
            // Or updated external systems, etc.
            const updateResult = await updateAction.apply(tx, {type: updateAction.type, key: data.uuid, ...data.updateResult.prevValues});
            // Delete the node and its expected relationships. We don't use DETACH DELETE because that would hide errors
            // such as relationships that we should have undone but didn't.
            await tx.run(`
                MATCH (tn:${label} {uuid: $uuid})
                WITH tn
                OPTIONAL MATCH (s:ShortId)-[rel:IDENTIFIES]->(tn)
                DELETE rel, s
                WITH tn
                OPTIONAL MATCH (a:Action)-[rel:MODIFIED]->(tn)
                DELETE rel
                WITH tn
                DELETE tn
            `, {uuid: data.uuid });
            return {
                resultData: {},
                modifiedNodes: updateResult.modifiedNodes,
            };
        },
        invert: (data, resultData) => null,
    });

    return CreateAction;
}

// eslint-disable-next-line @typescript-eslint/ban-types
export function defaultDeleteAndUnDeleteFor(type: VNodeType): [ActionImplementation<{key: string}, {}>, ActionImplementation<{key: string}, {}>] {
    const label = type.label;

    const DeleteAction = defineAction<{key: string}, any>({
        type: `Delete${label}`,
        apply: async (tx, data) => {
            const result = await tx.queryOne(`
                MATCH (tn:${label})::{$key}
                SET tn:Deleted${label}
                REMOVE tn:${label}
                RETURN tn
            `, {key: data.key}, {tn: type});
            const modifiedNodes = [result.tn];
            return {resultData: {}, modifiedNodes};
        },
        invert: (data, resultData) => {
            return UnDeleteAction({key: data.key});
        },
    });

    const UnDeleteAction = defineAction<{key: string}, any>({
        type: `UnDelete${label}`,
        apply: async (tx, data) => {
            const result = await tx.queryOne(`
                MATCH (tn:Deleted${label})::{$key}
                SET tn:${label}
                REMOVE tn:Deleted${label}
                RETURN tn
            `, {key: data.key}, {tn: type});
            const modifiedNodes = [result.tn];
            return {resultData: {}, modifiedNodes};
        },
        invert: (data): ActionData => {
            return DeleteAction({key: data.key});
        },
    });

    return [DeleteAction, UnDeleteAction];
}


/**
 * Designed for use in an "Update"-type Action, this helper method will update relationships from a node to other nodes.
 * It expects data of the form [[shortId/UUID, weight], ...] where each [shortId/UUID, weight] pair represents a
 * relationship from the current TechNode (of type "tn") to another node, such as a parent of the same type.
 * 
 * "newRelationshipsList" must be a complete list of all the target nodes for this relationship, as any existing target
 * nodes with that relationship will not be related anymore if they aren't in the list.
 */
export async function updateOneToOneRelationship<VNT extends VNodeType>({fromType, uuid, tx, relName, newId, allowNull}: {
    fromType: VNT,
    relName: keyof VNT["relationshipsFrom"],
    uuid: UUID,
    tx: WrappedTransaction,
    newId: string|null,
    allowNull: boolean,
}): Promise<{previousUuid: UUID|null}> {
    const label = fromType.label;
    if (fromType.relationshipsFrom[relName as any]?.toLabels?.length !== 1) {
        throw new Error("Unsupported: updateOneToOneRelationship doesn't yet work on relationships to multiple labels");
    }
    const targetLabel = fromType.relationshipsFrom[relName as any].toLabels[0];

    if (newId === null) {
        // We want to clear this 1:1 relationship (set it to null)
        if (!allowNull) {
            throw new Error(`The 1:1 relationship ${fromType.name}.${relName} is not allowed to be null.`);
        }
        // Simply delete any existing relationship, returning the ID of the target.
        const delResult = await tx.query(`
            MATCH (:${label} {uuid: $uuid})-[rel:${relName}]->(target:${targetLabel})
            DELETE rel
        `, {uuid, }, {"target.uuid": "uuid"});
        return {previousUuid: delResult.length ? delResult[0]["target.uuid"] : null};
    } else {
        // We want this 1:1 relationship pointing to a specific node, identified by "newId"
        const mergeResult = await tx.queryOne(`
            MATCH (self:${label} {uuid: $uuid})
            MATCH (target:${targetLabel})::{$newId}
            MERGE (self)-[rel:${relName}]->(target)

            WITH self, target
            OPTIONAL MATCH (self)-[oldRel:${relName}]->(oldTarget) WHERE oldTarget <> target
            DELETE oldRel

            WITH collect(oldTarget {.uuid}) AS oldTargets
        `, {uuid, newId}, {"oldTargets": "any"});
        // The preceding query will have updated the 1:1 relationship; if any previous node was the target of this
        // relationship, that relationship(s) has been delete and its ID returned (for undo purposes).
        // If the MERGE succeeded, there will be one row in the result; otherwise zero (regardless of whether or not
        // an oldTarget(s) was found), so an error will be raised by queryOne() if this failed (e.g. newId was invalid)
        return {
            previousUuid: mergeResult.oldTargets.length ? mergeResult.oldTargets[0]["uuid"] : null
        };
    }
}
