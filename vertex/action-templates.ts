import { ActionImplementation, defineAction, ActionData } from "./action";
import { UUID } from "./lib/uuid";
import { WrappedTransaction } from "./transaction";
import { PropertyDataType, RawVNode, VNodeType } from "./vnode";


// Useful action generators to reduce boilerplate

/** Helper to type the parameters in an auto-generated Update action */
type PropertyValuesForUpdate<VNT extends VNodeType, keys extends keyof VNT["properties"]> = {
    [K in keys]?: PropertyDataType<VNT["properties"], K>
}
/** Helper to get a union of the value types of an array, if known at compile time */
type ElementType < T extends ReadonlyArray < unknown > > = (
    T extends ReadonlyArray<infer ElementType> ? ElementType
    : never
);

type UpdateImplementationDetails<VNT extends VNodeType, MutPropsArrayType extends ReadonlyArray<keyof VNT["properties"]>, OtherArgs extends Record<string, any> = {}> = {  // eslint-disable-line @typescript-eslint/ban-types
    // The data argument passed into this action contains:
    //   key: the UUID or shortId of this node
    //   zero or more of the raw property values for the properties specified in "mutableProperties" (MutPropsArrayType)
    //   zero or more of the OtherArgs used by otherUpdates
    clean?: (args: {
        data: {key: string} & PropertyValuesForUpdate<VNT, ElementType<MutPropsArrayType>> & OtherArgs,
        nodeSnapshot: RawVNode<VNT>,
        changes: PropertyValuesForUpdate<VNT, ElementType<MutPropsArrayType>>,
        previousValues: PropertyValuesForUpdate<VNT, ElementType<MutPropsArrayType>>,
    }) => void,
    /** If there is a need to update relationships or complex properties, this method can do so */
    otherUpdates?: (
        args: OtherArgs,
        tx: WrappedTransaction,
        nodeSnapshot: RawVNode<VNT>,
        changes: Readonly<PropertyValuesForUpdate<VNT, ElementType<MutPropsArrayType>>>,
    ) => Promise<{previousValues: Partial<PropertyValuesForUpdate<VNT, ElementType<MutPropsArrayType>> & OtherArgs>, additionalModifiedNodes?: UUID[]}>,
};

/** Detailed type specification for an Update action created by the defaultUpdateActionFor() template */
interface UpdateActionImplementation<
    // The VNode type that is being updated
    VNT extends VNodeType,
    // Which of the VNode's raw properties can be updated
    SelectedProps extends keyof VNT["properties"],
    // Optional custom parameters that can (or must) be specified, which get used by the custom otherUpdates() method
    // (if any), to do things like update this VNode's relationships.
    OtherArgs extends Record<string, any>,
> extends ActionImplementation<
    // The parameters that can/must be passed to this action to run it:
    {key: string} & PropertyValuesForUpdate<VNT, SelectedProps> & OtherArgs,
    // The result of running this action will be "prevValues" which stores the previous values so the action can be
    // undone.
    {prevValues: PropertyValuesForUpdate<VNT, SelectedProps> & OtherArgs}
> {
    // Because Update actions are designed to work together with the Create action template, we need to store the list
    // of what properties the Update action can mutate:
    mutableProperties: ReadonlyArray<SelectedProps>;
}

/**
 * Build a useful "Update" action that can apply updates to basic property values of a VNode.
 * For example, if the VNode type is "User", a default update action could be used to change
 * the username, real name, birth date, etc.
 * @param type The VNode Type that this update is for.
 * @param mutableProperties Specify which properties can be changed by the update action.
 * @param clean Optionally provide a function to clean the property data before saving
 * @param otherUpdates Optionally provide a function to do additional changes on update, such as updating relationships
 *                     to other nodes.
 */
export function defaultUpdateActionFor<VNT extends VNodeType, SelectedProps extends keyof VNT["properties"], OtherArgs extends Record<string, any> = {}>(  // eslint-disable-line @typescript-eslint/ban-types
    type: VNT,
    mutableProperties: ReadonlyArray<SelectedProps>,
    {clean, otherUpdates}: UpdateImplementationDetails<VNT, typeof mutableProperties, OtherArgs> = {},
): UpdateActionImplementation<VNT, ElementType<typeof mutableProperties>, OtherArgs>
{
    type PropertyArgs = PropertyValuesForUpdate<VNT, ElementType<typeof mutableProperties>>;
    type Args = PropertyArgs & OtherArgs;

    const label = type.label;

    const UpdateAction = defineAction<{key: string} & Args, {prevValues: Args}>({
        type: `Update${label}`,
        apply: async (tx, data) => {
            // Load the current value of the VNode from the graph
            // TODO: why is "as RawVNode<VNT>" required on the next line here?
            const nodeSnapshot: RawVNode<VNT> = (await tx.queryOne(`MATCH (node:${label}:VNode)::{$key}`, {key: data.key}, {node: type})).node as RawVNode<VNT>;
            // Prepare to store the previous values of any changed properties/relationships (so we can undo this update)
            let previousValues: PropertyArgs = {};
            // Store the new values (properties that are being changed):
            const changes: any = {};
    
            // Simple Property Updates
            for (const propertyName of mutableProperties) {
                if (propertyName in data) {
                    // Do a poor man's deep comparison to see if this value is different, in case it's an array value or similar:
                    const isChanged = JSON.stringify(data[propertyName]) !== JSON.stringify(nodeSnapshot[propertyName]);
                    if (isChanged) {
                        changes[propertyName] = data[propertyName];
                        (previousValues as any)[propertyName] = nodeSnapshot[propertyName];
                    }
                }
            }
            // If there is a need to clean any properties, this function can mutate "changes" and "previousValues"
            if (clean) {
                clean({data, nodeSnapshot, changes, previousValues});
            }
            const result = await tx.queryOne(`
                MATCH (t:${label}:VNode)::{$key}
                SET t += $changes
            `, {key: data.key, changes}, {"null": "any"});
            let modifiedNodes: UUID[] = [nodeSnapshot.uuid];

            if (otherUpdates) {
                // Update relationships etc.
                const result = await otherUpdates(data, tx, nodeSnapshot, changes);
                previousValues = {...previousValues, ...result.previousValues};
                if (result.additionalModifiedNodes) {
                    modifiedNodes = [...modifiedNodes, ...result.additionalModifiedNodes];
                }
            }
    
            return {
                resultData: {prevValues: previousValues as any},
                modifiedNodes,
            };
        },
        invert: (data, resultData): ActionData => {
            return UpdateAction({key: data.key, ...resultData.prevValues});
        },
    });

    (UpdateAction as any).mutableProperties = mutableProperties;

    return UpdateAction as any;
}

/** Helper to type the parameters in an auto-generated Create action */
type RequiredArgsForCreate<VNT extends VNodeType, keys extends keyof VNT["properties"]> = {
    [K in keys]: PropertyDataType<VNT["properties"], K>
}

/** Helper to get the (optional) arguments that can be used for an Update action */
type ArgsForUpdateAction<UAI extends UpdateActionImplementation<VNodeType, any, any>|undefined> = (
    UAI extends UpdateActionImplementation<infer VNT, infer SelectedProps, infer OtherArgs> ?
        PropertyValuesForUpdate<VNT, SelectedProps> & OtherArgs
    : {/* If there's no update action, we don't accept any additional arguments */}
);

/**
 * Build a useful "Create" action, which creates a new VNode of the specified type, along with its required
 * properties. If an updateAction is specified (recommended), it will be used during the creation process, so that it
 * can clean values and also do things like create relationships at the same time.
 * @param type The VNode Type to create
 * @param updateAction The Update Action, created by defaultUpdateActionFor() (optional)
 */
export function defaultCreateFor<VNT extends VNodeType, RequiredProps extends keyof VNT["properties"], UAI extends UpdateActionImplementation<VNT, any, any>|undefined = undefined>(  // eslint-disable-line @typescript-eslint/ban-types
    VNodeType: VNT,
    requiredProperties: ReadonlyArray<RequiredProps>,
    updateAction?: UAI
): ActionImplementation<
    // This Create action _requires_ the following properties:
    RequiredArgsForCreate<VNT, RequiredProps>
    // And accepts any _optional_ properties that the Update action understands:
    & ArgsForUpdateAction<UAI>
    // And it returns the UUID of the newly created node, and whatever the Update action returned, if any
, {uuid: string, updateResult: null|{prevValues: any}}> {

    type Args = RequiredArgsForCreate<VNT, RequiredProps> & ArgsForUpdateAction<UAI>;
    const label = VNodeType.label;

    const CreateAction = defineAction<Args, {uuid: UUID, updateResult: null|{prevValues: any}}>({
        type: `Create${label}`,
        apply: async (tx, data) => {
            const uuid = UUID();
            // This Create Action also runs an Update at the same time (if configured that way).
            // If there is a linked Update Action, we want _it_ to set the props, so that its "clean" and "otherUpdates"
            // methods can be used. However, there may be some properties that can be set on create but never changed;
            // if so, we need to handle those now.
            const propsToSetOnCreate: any = {};
            const propsToSetViaUpdate: any = {};
            for (const [propName, value] of Object.entries(data)) {
                if (propName === "type") {
                    continue;
                }
                if (updateAction) {
                    if (requiredProperties.includes(propName as any) && !updateAction.mutableProperties.includes(propName)) {
                        // This is a raw property but updateAction doesn't accept it as a parameter; we'll have to set it now.
                        propsToSetOnCreate[propName] = value;
                    } else {
                        // This is a property or argument that updateAction can handle:
                        propsToSetViaUpdate[propName] = value;
                    }
                } else {
                    propsToSetOnCreate[propName] = value;
                }
            }
            // Create the new node, assigning its UUID, as well as setting any props that the upcoming Update can't handle
            const result = await tx.queryOne(
                `CREATE (node:${label}:VNode {uuid: $uuid}) SET node += $propsToSetOnCreate`,
                {uuid, propsToSetOnCreate, },
                {"null": "any"},
            );
            if (updateAction && Object.keys(propsToSetViaUpdate).length > 0) {
                const updateResult = await updateAction.apply(tx, {type: updateAction.type, key: uuid, ...propsToSetViaUpdate});
                return {
                    resultData: { uuid, updateResult: updateResult.resultData },
                    modifiedNodes: [uuid, ...updateResult.modifiedNodes],
                };
            } else {
                return {
                    resultData: { uuid, updateResult: null },
                    modifiedNodes: [uuid],
                };
            }
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
            let modifiedNodes: UUID[] = [];
            if (updateAction && data.updateResult !== null) {
                const updateResult = await updateAction.apply(tx, {type: updateAction.type, key: data.uuid, ...data.updateResult.prevValues});
                modifiedNodes = updateResult.modifiedNodes;
            }
            // Delete the node and its expected relationships. We don't use DETACH DELETE because that would hide errors
            // such as relationships that we should have undone but didn't.
            await tx.run(`
                MATCH (tn:${label}:VNode {uuid: $uuid})
                WITH tn
                OPTIONAL MATCH (s:ShortId)-[rel:IDENTIFIES]->(tn)
                DELETE rel, s
                WITH tn
                OPTIONAL MATCH (a:Action:VNode)-[rel:MODIFIED]->(tn)
                DELETE rel
                WITH tn
                DELETE tn
            `, {uuid: data.uuid });
            return {
                resultData: {},
                modifiedNodes,
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
                MATCH (tn:${label}:VNode)::{$key}
                SET tn:DeletedVNode
                REMOVE tn:VNode
            `, {key: data.key}, {"tn.uuid": "uuid"});
            const modifiedNodes = [result["tn.uuid"]];
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
                MATCH (tn:${label}:DeletedVNode)::{$key}
                SET tn:VNode
                REMOVE tn:DeletedVNode
            `, {key: data.key}, {"tn.uuid": "uuid"});
            const modifiedNodes = [result["tn.uuid"]];
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
            MATCH (:${label}:VNode {uuid: $uuid})-[rel:${relName}]->(target:${targetLabel}:VNode)
            DELETE rel
        `, {uuid, }, {"target.uuid": "uuid"});
        return {previousUuid: delResult.length ? delResult[0]["target.uuid"] : null};
    } else {
        // We want this 1:1 relationship pointing to a specific node, identified by "newId"
        const mergeResult = await tx.queryOne(`
            MATCH (self:${label}:VNode {uuid: $uuid})
            MATCH (target:${targetLabel}:VNode)::{$newId}
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
