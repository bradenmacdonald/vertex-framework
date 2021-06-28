// deno-lint-ignore-file no-explicit-any ban-types
import { ActionDefinition, defineAction } from "./action.ts";
import { C } from "../layer2/cypher-sugar.ts";
import { VNID, VNodeKey } from "../lib/key.ts";
import { WrappedTransaction } from "../transaction.ts";
import { RawVNode, getAllLabels } from "../layer2/vnode-base.ts";
import { getRequestedRawProperties, GetRequestedRawProperties, RequestVNodeRawProperties } from "../layer2/data-request.ts";
import { Field, FieldType, GetDataType } from "../lib/types/field.ts";
import { VNodeType } from "../layer3/vnode.ts";
import { stringify } from "../lib/log.ts";


// Useful action generators to reduce boilerplate

/** Helper to type the parameters in an auto-generated Update action */
type PropertyValuesForUpdate<VNT extends VNodeType, keys extends keyof VNT["properties"]> = {
    [K in keys]?: GetDataType<VNT["properties"][K]>
}

type UpdateImplementationDetails<VNT extends VNodeType, MutableProps extends keyof VNT["properties"], OtherArgs extends Record<string, any> = {}> = {  // eslint-disable-line @typescript-eslint/ban-types
    // The data argument passed into this action contains:
    //   key: the VNID or slugId of this node
    //   zero or more of the raw property values for the properties specified in "mutableProperties" (MutPropsArrayType)
    //   zero or more of the OtherArgs used by otherUpdates
    clean?: (args: {
        data: {key: VNodeKey} & PropertyValuesForUpdate<VNT, MutableProps> & OtherArgs,
        nodeSnapshot: RawVNode<VNT>,
        changes: PropertyValuesForUpdate<VNT, MutableProps>,
    }) => void,
    /** If there is a need to update relationships or complex properties, this method can do so */
    otherUpdates?: (
        args: OtherArgs,
        tx: WrappedTransaction,
        nodeSnapshot: RawVNode<VNT>,
        changes: Readonly<PropertyValuesForUpdate<VNT, MutableProps>>,
    ) => Promise<{additionalModifiedNodes?: VNID[]}>,
};

/** Detailed type specification for an Update action created by the defaultUpdateFor() template */
export interface UpdateActionDefinition<
    // The VNode type that is being updated
    VNT extends VNodeType,
    // Which of the VNode's raw properties can be updated
    MutableProps extends keyof VNT["properties"],
    // Optional custom parameters that can (or must) be specified, which get used by the custom otherUpdates() method
    // (if any), to do things like update this VNode's relationships.
    OtherArgs extends Record<string, any>,
> extends ActionDefinition<
    `Update${VNT["label"]}`,
    // The parameters that can/must be passed to this action to run it:
    {key: VNodeKey} & PropertyValuesForUpdate<VNT, MutableProps> & OtherArgs,
    Record<string, never>
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
export function defaultUpdateFor<VNT extends VNodeType, MutableProps extends RequestVNodeRawProperties<VNT>, OtherArgs extends Record<string, any> = {}>(  // eslint-disable-line @typescript-eslint/ban-types
    type: VNT,
    mutableProperties: MutableProps,
    {clean, otherUpdates}: UpdateImplementationDetails<VNT, GetRequestedRawProperties<MutableProps>, OtherArgs> = {},
): UpdateActionDefinition<VNT, GetRequestedRawProperties<MutableProps>, OtherArgs>
{
    const mutablePropertyKeys = getRequestedRawProperties(type, mutableProperties);
    type PropertyArgs = PropertyValuesForUpdate<VNT, GetRequestedRawProperties<MutableProps>>;
    type Args = PropertyArgs & OtherArgs;

    const UpdateAction = defineAction({
        type: `Update${type.label}` as `Update${VNT["label"]}`,
        parameters: {} as {key: string} & Args,
        resultData: {} as {prevValues: Args},
        apply: async function applyUpdateAction(tx, data) {
            // Load the current value of the VNode from the graph
            const nodeSnapshot: RawVNode<VNT> = (await tx.queryOne(C`MATCH (node:${type}), node HAS KEY ${data.key}`.RETURN({node: Field.VNode(type)}))).node;
            // Store the new values (properties that are being changed):
            const changes: any = {};
    
            // Simple Property Updates
            for (const propertyName of mutablePropertyKeys) {
                if (propertyName in data) {
                    let value = data[propertyName];
                    // Do a poor man's deep comparison to see if this value is different, in case it's an array value or similar:
                    const isChanged = stringify(value) !== stringify(nodeSnapshot[propertyName]);
                    if (isChanged) {
                        // Save the new value.
                        // Ensure that Number values assigned to Field.Int fields get saved into the database as Integers, not Floats:
                        if (type.properties[propertyName].type === FieldType.Int && typeof value === "number") {
                            value = BigInt(value);  // Using BigInt will ensure Neo4j stores it as int, not float. It will be read out as a Number because of our typing system.
                        }
                        changes[propertyName] = value;
                    }
                }
            }
            // If there is a need to clean any properties, this function can mutate "changes"
            if (clean) {
                clean({data, nodeSnapshot, changes});
            }
            await tx.queryOne(C`
                MATCH (t:${type}), t HAS KEY ${data.key}
                SET t += ${changes}
            `.RETURN({}));
            let modifiedNodes: VNID[] = [nodeSnapshot.id as any];  // TODO: why is this "as any" needed?

            if (otherUpdates) {
                // Update relationships etc.
                const result = await otherUpdates(data, tx, nodeSnapshot, changes);
                if (result.additionalModifiedNodes) {
                    modifiedNodes = [...modifiedNodes, ...result.additionalModifiedNodes];
                }
            }
    
            return {
                resultData: {},
                modifiedNodes,
                description: `Updated ${type.withId(nodeSnapshot.id as any)} (${Object.keys(data).filter(k => k !== "key").join(", ")})`,
            };
        },
    });

    // Store the set of mutable properties on the update action, because the Create action needs to know what properties Update can mutate.
    (UpdateAction as any).mutableProperties = mutablePropertyKeys;

    return UpdateAction as any;
}

/** Helper to type the parameters in an auto-generated Create action */
type RequiredArgsForCreate<VNT extends VNodeType, keys extends keyof VNT["properties"]> = {
    [K in keys]: GetDataType<VNT["properties"][K]>
}

/** Helper to get the (optional) arguments that can be used for an Update action */
type ArgsForUpdateAction<UAI extends UpdateActionDefinition<VNodeType, any, any>|undefined> = (
    UAI extends UpdateActionDefinition<infer VNT, infer SelectedProps, infer OtherArgs> ?
        PropertyValuesForUpdate<VNT, SelectedProps> & OtherArgs
    : {/* If there's no update action, we don't accept any additional arguments */}
);

/**
 * Build a useful "Create" action, which creates a new VNode of the specified type, along with its required
 * properties. If an updateAction is specified (recommended), it will be used during the creation process, so that it
 * can clean values and also do things like create relationships at the same time.
 * @param type The VNode Type to create
 * @param updateAction The Update Action, created by defaultUpdateFor() (optional)
 */
export function defaultCreateFor<VNT extends VNodeType, RequiredProps extends RequestVNodeRawProperties<VNT>, UAI extends UpdateActionDefinition<VNT, any, any>|undefined = undefined>(  // eslint-disable-line @typescript-eslint/ban-types
    type: VNT,
    requiredProperties: RequiredProps,
    updateAction?: UAI
): ActionDefinition<
    `Create${VNT["label"]}`,
    // This Create action _requires_ the following properties:
    RequiredArgsForCreate<VNT, GetRequestedRawProperties<RequiredProps>>
    // And accepts any _optional_ properties that the Update action understands:
    & ArgsForUpdateAction<UAI>
    // And it returns the VNID of the newly created node, and whatever the Update action returned, if any
, {id: VNID}> {

    const requiredPropertyKeys = getRequestedRawProperties(type, requiredProperties);

    type Args = RequiredArgsForCreate<VNT, GetRequestedRawProperties<RequiredProps>> & ArgsForUpdateAction<UAI>;

    const CreateAction = defineAction({
        type: `Create${type.label}` as `Create${VNT["label"]}`,
        parameters: {} as Args,
        resultData: {} as {id: VNID},
        apply: async function applyCreateAction(tx, data) {
            const id = VNID();
            // This Create Action also runs an Update at the same time (if configured that way).
            // If there is a linked Update Action, we want _it_ to set the props, so that its "clean" and "otherUpdates"
            // methods can be used. However, there may be some properties that can be set on create but never changed;
            // if so, we need to handle those now.
            const propsToSetOnCreate: any = {};
            const propsToSetViaUpdate: any = {};
            for (const [propName, value] of Object.entries(data)) {
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
            for (const propertyName in propsToSetOnCreate) {
                // Ensure that Number values assigned to Field.Int fields get saved into the database as Integers, not Floats:
                if (type.properties[propertyName].type === FieldType.Int && typeof propsToSetOnCreate[propertyName] === "number") {
                    propsToSetOnCreate[propertyName] = BigInt(propsToSetOnCreate[propertyName]);  // Using BigInt will ensure Neo4j stores it as int, not float. It will be read out as a Number because of our typing system.
                }
            }
            // Create the new node, assigning its VNID, as well as setting any props that the upcoming Update can't handle
            const labels = getAllLabels(type);
            await tx.query(C`
                CREATE (node:${C(labels.join(":"))} {id: ${id}})
                SET node += ${propsToSetOnCreate}
            `);
            const description = `Created ${type.withId(id)}`;
            if (updateAction && Object.keys(propsToSetViaUpdate).length > 0) {
                const updateResult = await updateAction.apply(tx, {type: updateAction.type, key: id, ...propsToSetViaUpdate});
                return {
                    resultData: { id },
                    modifiedNodes: [id, ...updateResult.modifiedNodes],
                    description,
                };
            } else {
                return {
                    resultData: { id, updateResult: null },
                    modifiedNodes: [id],
                    description,
                };
            }
        },
    });

    return CreateAction;
}

export function defaultDeleteFor<VNT extends VNodeType>(type: VNT): ActionDefinition<`Delete${VNT["label"]}`, {key: VNodeKey}, {}> {

    const DeleteAction = defineAction({
        type: `Delete${type.label}` as `Delete${VNT["label"]}`,
        parameters: {} as {key: VNodeKey},
        resultData: {} as {id: VNID},
        apply: async (tx, data) => {
            const result = await tx.queryOne(C`
                MATCH (node:${type}), node HAS KEY ${data.key}
                SET node:DeletedVNode
                REMOVE node:VNode
            `.RETURN({"node.id": Field.VNID}));
            const modifiedNodes = [result["node.id"]];
            return {resultData: {id: result["node.id"]}, modifiedNodes, description: `Deleted ${type.withId(result["node.id"])}`};
        },
    });

    return DeleteAction;
}
