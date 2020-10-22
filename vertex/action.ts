/**
 * TechNotes uses the command pattern extensively, where all operations that can change the site's content in any way
 * (other than data/schema migrations) are described as "actions" (a.k.a. mutations) that take the current state and
 * transform it to another state. Many actions are invertable, making it easy to revert edits, undo changes, etc.
 */
import Joi from "@hapi/joi";

import { NominalType } from "./lib/ts-utils";
import { VNodeType, RawVNode, ValidationError, registerVNodeType, VirtualPropType } from "./vnode";
import { WrappedTransaction } from "./transaction";
import { UUID } from "./lib/uuid";
import { Transaction } from "neo4j-driver";
import { log } from "./lib/log";


// A type of action, e.g. 'createUser'
export type ActionType = NominalType<string, "ActionType">;
type ActionSubType<T extends string> = NominalType<T, "ActionType">
export function ActionType<T extends string>(value: T): ActionSubType<T> { return value as ActionSubType<T>; }

/**
 * Base interface that holds all the data to run a specific action.
 * An action might be "rename article", so in that case the ActionData would look like:
 *     {
 *         type: "renameArticle",
 *         articleId: "foo",
 *         newTitle: "This is the new title",
 *     }
 */
export interface ActionData {
    type: ActionType;
}

/**
 * The data returned by an action implementation's apply() method.
 * For example, when creating a new user, this returns the user's UUID.
 */
interface ApplyResult<T = any> {
    /**
     * Any result data that the action wants to pass back. Importantly, this must also include enough information to
     * reverse the action, if it's a reversable action (e.g. if this was a "Delete" action, this should contain enough
     * data to reconstruct the deleted object.)
     */
    resultData: T;
    /**
     * A list of Neo4j node objects for any nodes that were modified by this action, so that the (:Action)-[:MODIFIED]->
     * relationship can be created, giving us a change history for every node in the graph.
     */
    modifiedNodes: RawVNode<any>[];
}

/**
 * Internal extension of ActionData that also includes related types
 * like ReturnType.
 * This TypeScript magic allows
 *     const result = await runAction(
 *         CreateDevice({name, shortId}),
 *     );
 * to have fully typed return information (in result)
 */
interface TypedActionData<ExtraArgsType, ReturnType> extends ActionData {}  // eslint-disable-line @typescript-eslint/no-empty-interface

/** TypeScript helper: given an ActionData type, this gets the action's apply() return value, if known */
export type ActionResult<T extends ActionData> = (
    T extends TypedActionData<infer ExtraArgsType, infer ReturnType> ? ReturnType : any
)&{actionUuid: UUID};


/** Base class for an Action, defining the interface that all actions must adhere to. */
export interface ActionImplementation {
    readonly type: ActionType;

    apply(tx: WrappedTransaction, data: ActionData): Promise<ApplyResult>;

    /**
     * "Invert" an applied action, creating a new undo action that will exactly undo the original.
     * Return null if the action does not support undo.
     **/
    invert(data: ActionData, resultData: any): ActionData|null;
}
/**
 * Internal extension of ActionImplementation
 */
interface ActionImplementationFull<Args, ReturnType> extends ActionImplementation {
    // Given arguments, create an ActionData structure defining this action as data
    (args: Args): TypedActionData<Args, ReturnType>;
    apply: (tx: WrappedTransaction, data: ActionData & Args) => Promise<ApplyResult<ReturnType>>;
}

/**
 * The global list of actions that have been defined by defineAction()
 */
const actions: Map<ActionType, ActionImplementation> = new Map();

/**
 * Define a new Action.
 *
 * Returns an ActionImplementation which can be used to run actions of this type, and which
 * can be called to generate a data structure which represents a specific action of this type.
 */
export function defineAction<ExtraArgsType, ReturnType = undefined>(
    {type, apply, invert}: {
        type: string|ActionType;
        apply: (tx: WrappedTransaction, data: ActionData & ExtraArgsType) => Promise<ApplyResult<ReturnType>>;
        invert: (data: ActionData & ExtraArgsType, resultData: ReturnType) => ActionData|null;
    }
): ActionImplementationFull<ExtraArgsType, ReturnType> {
    const actionType = type as ActionType;
    if (actions.get(actionType) !== undefined) {
        throw new Error(`Action ${actionType} already registered.`)
    }
    const impl = function(args: ExtraArgsType): TypedActionData<ExtraArgsType, ReturnType> { return {type: actionType, ...args}; }
    impl.type = actionType;
    impl.apply = apply;
    impl.invert = invert;
    actions.set(actionType, impl);
    return impl;
}

/**
 * Get an Action Implementation, given an ActionType
 * @param type 
 */
export function getActionImplementation(type: ActionType): ActionImplementation|undefined {
    return actions.get(type);
}


export class Action extends VNodeType {
    static label = "Action";
    static readonly properties = {
        ...VNodeType.properties,
        // The action type, e.g. "Create Article", "Delete User", etc.
        type: Joi.string().required(),
        // The JSON data that defines the action, and contains enough data to undo it.
        data: Joi.string(),
        // The time at which the action was completed.
        timestamp: Joi.date(),
        // How many milliseconds it took to run this action.
        tookMs: Joi.number(),
    };
    static async validate(dbObject: RawVNode<typeof Action>, tx: Transaction): Promise<void> {
        await super.validate(dbObject, tx);
        try {
            JSON.parse(dbObject.data);
        } catch {
            throw new ValidationError("Invalid JSON in Action data.");
        }
    }
    static readonly relationshipsFrom = {
        /** What VNodes were modified by this action */
        MODIFIED: {
            toLabels: ["*"],
            properties: {},
        },
        /** This Action reverted another one */
        REVERTED: {
            toLabels: ["Action"],
            properties: {},
        },
    };
    static readonly virtualProperties = {
        revertedBy: {
            type: VirtualPropType.OneRelationship,
            query: `(@target:Action)-[:REVERTED]->(@this)`,
            target: Action,
        },
        revertedAction: {
            type: VirtualPropType.OneRelationship,
            query: `(@this)-[:REVERTED]->(@target:Action)`,
            target: Action,
        },
    };
}
registerVNodeType(Action);

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
): ActionImplementationFull<{key: string} & UpdateArgs, {prevValues: UpdateArgs}> 
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
    updateAction: ActionImplementationFull<{key: string}&Omit<UpdateArgs, keyof RequiredArgs>, {prevValues: any}>
): ActionImplementationFull<RequiredArgs&{props: Omit<UpdateArgs, keyof RequiredArgs>}, {uuid: string, updateResult: any}> {
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

export function defaultDeleteAndUnDeleteFor(type: VNodeType): [ActionImplementationFull<{key: string}, undefined>, ActionImplementationFull<{key: string}, undefined>] {
    const label = type.label;

    const DeleteAction = defineAction<{key: string}, undefined>({
        type: `Delete${label}`,
        apply: async (tx, data) => {
            const result = await tx.queryOne(`
                MATCH (tn:${label})::{$key}
                SET tn:Deleted${label}
                REMOVE tn:${label}
                RETURN tn
            `, {key: data.key}, {tn: type});
            const modifiedNodes = [result.tn];
            return {resultData: undefined, modifiedNodes};
        },
        invert: (data, resultData) => {
            return UnDeleteAction({key: data.key});
        },
    });

    const UnDeleteAction = defineAction<{key: string}, undefined>({
        type: `UnDelete${label}`,
        apply: async (tx, data) => {
            const result = await tx.queryOne(`
                MATCH (tn:Deleted${label})::{$key}
                SET tn:${label}
                REMOVE tn:Deleted${label}
                RETURN tn
            `, {key: data.key}, {tn: type});
            const modifiedNodes = [result.tn];
            return {resultData: undefined, modifiedNodes};
        },
        invert: (data): ActionData => {
            return DeleteAction({key: data.key});
        },
    });

    return [DeleteAction, UnDeleteAction];
}
