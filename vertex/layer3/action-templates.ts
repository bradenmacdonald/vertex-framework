import { ActionImplementation, defineAction, ActionData, Action } from "./action";
import { C } from "../layer2/cypher-sugar";
import { VNID, VNodeKey } from "../lib/key";
import { WrappedTransaction } from "../transaction";
import { PropertyDataType, RawVNode, BaseVNodeType, getAllLabels } from "../layer2/vnode-base";
import { getRequestedRawProperties, GetRequestedRawProperties, RequestVNodeRawProperties } from "./data-request";


// Useful action generators to reduce boilerplate

/** Helper to type the parameters in an auto-generated Update action */
type PropertyValuesForUpdate<VNT extends BaseVNodeType, keys extends keyof VNT["properties"]> = {
    [K in keys]?: PropertyDataType<VNT["properties"], K>
}

type UpdateImplementationDetails<VNT extends BaseVNodeType, MutableProps extends keyof VNT["properties"], OtherArgs extends Record<string, any> = {}> = {  // eslint-disable-line @typescript-eslint/ban-types
    // The data argument passed into this action contains:
    //   key: the VNID or slugId of this node
    //   zero or more of the raw property values for the properties specified in "mutableProperties" (MutPropsArrayType)
    //   zero or more of the OtherArgs used by otherUpdates
    clean?: (args: {
        data: {key: VNodeKey} & PropertyValuesForUpdate<VNT, MutableProps> & OtherArgs,
        nodeSnapshot: RawVNode<VNT>,
        changes: PropertyValuesForUpdate<VNT, MutableProps>,
        previousValues: PropertyValuesForUpdate<VNT, MutableProps>,
    }) => void,
    /** If there is a need to update relationships or complex properties, this method can do so */
    otherUpdates?: (
        args: OtherArgs,
        tx: WrappedTransaction,
        nodeSnapshot: RawVNode<VNT>,
        changes: Readonly<PropertyValuesForUpdate<VNT, MutableProps>>,
    ) => Promise<{previousValues: Partial<PropertyValuesForUpdate<VNT, MutableProps> & OtherArgs>, additionalModifiedNodes?: VNID[]}>,
};

/** Detailed type specification for an Update action created by the defaultUpdateActionFor() template */
export interface UpdateActionImplementation<
    // The VNode type that is being updated
    VNT extends BaseVNodeType,
    // Which of the VNode's raw properties can be updated
    MutableProps extends keyof VNT["properties"],
    // Optional custom parameters that can (or must) be specified, which get used by the custom otherUpdates() method
    // (if any), to do things like update this VNode's relationships.
    OtherArgs extends Record<string, any>,
> extends ActionImplementation<
    `Update${VNT["label"]}`,
    // The parameters that can/must be passed to this action to run it:
    {key: VNodeKey} & PropertyValuesForUpdate<VNT, MutableProps> & OtherArgs,
    // The result of running this action will be "prevValues" which stores the previous values so the action can be
    // undone.
    {prevValues: PropertyValuesForUpdate<VNT, MutableProps> & OtherArgs}
> {
    // Because Update actions are designed to work together with the Create action template, we need to store the list
    // of what properties the Update action can mutate:
    mutableProperties: ReadonlyArray<MutableProps>;
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
export function defaultUpdateActionFor<VNT extends BaseVNodeType, MutableProps extends RequestVNodeRawProperties<VNT>, OtherArgs extends Record<string, any> = {}>(  // eslint-disable-line @typescript-eslint/ban-types
    type: VNT,
    mutableProperties: MutableProps,
    {clean, otherUpdates}: UpdateImplementationDetails<VNT, GetRequestedRawProperties<MutableProps>, OtherArgs> = {},
): UpdateActionImplementation<VNT, GetRequestedRawProperties<MutableProps>, OtherArgs>
{
    const mutablePropertyKeys = getRequestedRawProperties(type, mutableProperties);
    type PropertyArgs = PropertyValuesForUpdate<VNT, GetRequestedRawProperties<MutableProps>>;
    type Args = PropertyArgs & OtherArgs;

    const UpdateAction = defineAction({
        type: `Update${type.label}` as `Update${VNT["label"]}`,
        parameters: {} as {key: string} & Args,
        resultData: {} as {prevValues: Args},
        apply: async (tx, data) => {
            // Load the current value of the VNode from the graph
            // TODO: why is "as RawVNode<VNT>" required on the next line here?
            const nodeSnapshot: RawVNode<VNT> = (await tx.queryOne(C`MATCH (node:${type}), node HAS KEY ${data.key}`.RETURN({node: type}))).node as RawVNode<VNT>;
            // Prepare to store the previous values of any changed properties/relationships (so we can undo this update)
            let previousValues: PropertyArgs = {};
            // Store the new values (properties that are being changed):
            const changes: any = {};
    
            // Simple Property Updates
            for (const propertyName of mutablePropertyKeys) {
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
            forceIntegers(changes);  // Store whole numbers as ints, not floats
            await tx.queryOne(C`
                MATCH (t:${type}), t HAS KEY ${data.key}
                SET t += ${changes}
            `.RETURN({}));
            let modifiedNodes: VNID[] = [nodeSnapshot.id];

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

    // Store the set of mutable properties on the update action, because the Create action needs to know what properties Update can mutate.
    (UpdateAction as any).mutableProperties = mutablePropertyKeys;

    return UpdateAction as any;
}

/** Helper to type the parameters in an auto-generated Create action */
type RequiredArgsForCreate<VNT extends BaseVNodeType, keys extends keyof VNT["properties"]> = {
    [K in keys]: PropertyDataType<VNT["properties"], K>
}

/** Helper to get the (optional) arguments that can be used for an Update action */
type ArgsForUpdateAction<UAI extends UpdateActionImplementation<BaseVNodeType, any, any>|undefined> = (
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
export function defaultCreateFor<VNT extends BaseVNodeType, RequiredProps extends RequestVNodeRawProperties<VNT>, UAI extends UpdateActionImplementation<VNT, any, any>|undefined = undefined>(  // eslint-disable-line @typescript-eslint/ban-types
    type: VNT,
    requiredProperties: RequiredProps,
    updateAction?: UAI
): ActionImplementation<
    `Create${VNT["label"]}`,
    // This Create action _requires_ the following properties:
    RequiredArgsForCreate<VNT, GetRequestedRawProperties<RequiredProps>>
    // And accepts any _optional_ properties that the Update action understands:
    & ArgsForUpdateAction<UAI>
    // And it returns the VNID of the newly created node, and whatever the Update action returned, if any
, {id: VNID, updateResult: null|{prevValues: any}}> {

    const requiredPropertyKeys = getRequestedRawProperties(type, requiredProperties);

    type Args = RequiredArgsForCreate<VNT, GetRequestedRawProperties<RequiredProps>> & ArgsForUpdateAction<UAI>;

    const CreateAction = defineAction({
        type: `Create${type.label}` as `Create${VNT["label"]}`,
        parameters: {} as Args,
        resultData: {} as {id: VNID, updateResult: null|{prevValues: any}},
        apply: async (tx, data) => {
            const id = VNID();
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
                    if (requiredPropertyKeys.includes(propName as any) && !updateAction.mutableProperties.includes(propName)) {
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
            // Create the new node, assigning its VNID, as well as setting any props that the upcoming Update can't handle
            forceIntegers(propsToSetOnCreate);
            const labels = getAllLabels(type);
            await tx.query(C`
                CREATE (node:${C(labels.join(":"))} {id: ${id}})
                SET node += ${propsToSetOnCreate}
            `);
            if (updateAction && Object.keys(propsToSetViaUpdate).length > 0) {
                const updateResult = await updateAction.apply(tx, {type: updateAction.type, key: id, ...propsToSetViaUpdate});
                return {
                    resultData: { id, updateResult: updateResult.resultData },
                    modifiedNodes: [id, ...updateResult.modifiedNodes],
                };
            } else {
                return {
                    resultData: { id, updateResult: null },
                    modifiedNodes: [id],
                };
            }
        },
        invert: (data, resultData) => {
            return UndoCreateAction({id: resultData.id, updateResult: resultData.updateResult});
        },
    });

    const UndoCreateAction = defineAction({
        type: `UndoCreate${type.label}`,
        parameters: {} as {id: string, updateResult: any},
        apply: async (tx, data) => {
            // First undo the update that may have been part of the create, since it may have created relationships
            // Or updated external systems, etc.
            let modifiedNodes: VNID[] = [];
            if (updateAction && data.updateResult !== null) {
                const updateResult = await updateAction.apply(tx, {type: updateAction.type, key: data.id, ...data.updateResult.prevValues});
                modifiedNodes = updateResult.modifiedNodes;
            }
            // Delete the node and its expected relationships. We don't use DETACH DELETE because that would hide errors
            // such as relationships that we should have undone but didn't.
            await tx.query(C`
                MATCH (node:${type} {id: ${data.id}})
                WITH node
                OPTIONAL MATCH (s:SlugId)-[rel:IDENTIFIES]->(node)
                DELETE rel, s
                WITH node
                OPTIONAL MATCH (a:${Action})-[rel:${Action.rel.MODIFIED}]->(node)
                DELETE rel
                WITH node
                DELETE node
            `);
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
export function defaultDeleteAndUnDeleteFor<VNT extends BaseVNodeType>(type: VNT): [ActionImplementation<`Delete${VNT["label"]}`, {key: VNodeKey}, {}>, ActionImplementation<`UnDelete${VNT["label"]}`, {id: VNID}, {}>] {

    const DeleteAction = defineAction({
        type: `Delete${type.label}` as `Delete${VNT["label"]}`,
        parameters: {} as {key: VNodeKey},
        resultData: {} as {id: VNID},
        apply: async (tx, data) => {
            const result = await tx.queryOne(C`
                MATCH (node:${type}), node HAS KEY ${data.key}
                SET node:DeletedVNode
                REMOVE node:VNode
            `.RETURN({"node.id": "vnid"}));
            const modifiedNodes = [result["node.id"]];
            return {resultData: {id: result["node.id"]}, modifiedNodes};
        },
        invert: (data, resultData) => {
            return UnDeleteAction({id: resultData.id});
        },
    });

    const UnDeleteAction = defineAction({
        type: `UnDelete${type.label}` as `UnDelete${VNT["label"]}`,
        parameters: {} as {id: VNID},
        apply: async (tx, data) => {
            // We cannot use the HAS KEY lookup since it deliberately ignores :DeletedVNodes
            const result = await tx.queryOne(C`
                MATCH (node:${C(type.label)}:DeletedVNode {id: ${data.id}})
                SET node:VNode
                REMOVE node:DeletedVNode
            `);
            const modifiedNodes = [data.id];
            return {resultData: {}, modifiedNodes};
        },
        invert: (data): ActionData => {
            return DeleteAction({key: data.id});
        },
    });

    return [DeleteAction, UnDeleteAction];
}


// Little hack: JS doesn't distinguish between ints and floats, but Neo4j does.
// This function will force floats to ints where it seems useful, before saving a bunch of properties into the database.
// Without this, integers would always get stored as floats.
// Note that this doesn't matter too much since we read all numbers back from the database as "number" types anyways,
// but it does produce nicer data if people read the graph in other ways (not from JavaScript)
function forceIntegers(propertiesMap: Record<string, any>): void {
    for (const propName in propertiesMap) {
        if (typeof propertiesMap[propName] === "number" && Number.isInteger(propertiesMap[propName])) {
            // Store this value into Neo4j as an INT not a FLOAT
            propertiesMap[propName] = C.int(propertiesMap[propName]);
        }
    }
}
