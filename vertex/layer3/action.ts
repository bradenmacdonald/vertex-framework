/**
 * Vertex Framework uses the command pattern, where all operations that can change the site's content in any way
 * (other than data/schema migrations) are described as "actions" (a.k.a. mutations) that take the current state and
 * transform it to another state. Many actions are invertable, making it easy to revert edits, undo changes, etc.
 */
import Joi from "@hapi/joi";

import { NominalType } from "../lib/ts-utils";
import { UUID } from "../lib/uuid";
import { BaseVNodeType, RawVNode, ValidationError } from "../layer2/vnode-base";
import { WrappedTransaction } from "../transaction";


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
export type ActionData<Parameters extends Record<string, any> = {}, ResultData extends Record<string, any> = {}> = {  // eslint-disable-line @typescript-eslint/ban-types
    type: ActionType;
} & Parameters;

/**
 * The data returned by an action implementation's apply() method.
 * For example, when creating a new user, this returns the user's UUID.
 */
interface ApplyResult<ResultData extends Record<string, any> = {}> {  // eslint-disable-line @typescript-eslint/ban-types
    /**
     * Any result data that the action wants to pass back. Importantly, this must also include enough information to
     * reverse the action, if it's a reversable action (e.g. if this was a "Delete" action, this should contain enough
     * data to reconstruct the deleted object.)
     */
    resultData: ResultData;
    /**
     * A list of node UUIDs for any nodes that were modified by this action, so that the nodes can be validated, and
     * the (:Action)-[:MODIFIED]-> relationship can be created, giving us a change history for every node in the graph.
     */
    modifiedNodes: UUID[];
}

/** TypeScript helper: given an ActionData type, this gets the action's apply() return value, if known */
export type ActionResult<T extends ActionData> = (
    T extends ActionData<infer Parameters, infer ResultData> ? ResultData : any
)&{actionUuid: UUID};


/** Base class for an Action, defining the interface that all actions must adhere to. */
export interface ActionImplementation<Parameters extends Record<string, any> = any, ResultData extends Record<string, any> = {}> {  // eslint-disable-line @typescript-eslint/ban-types
    readonly type: ActionType;

    // Generate the ActionData for this action:
    (args: Parameters): ActionData<Parameters, ResultData>;

    apply(tx: WrappedTransaction, data: ActionData<Parameters, ResultData>): Promise<ApplyResult<ResultData>>;

    /**
     * "Invert" an applied action, creating a new undo action that will exactly undo the original.
     * Return null if the action does not support undo.
     **/
    invert(data: ActionData<Parameters, ResultData>, resultData: ResultData): ActionData|null;
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
export function defineAction<Parameters extends Record<string, any>, ResultData>(
    {type, apply, invert}: {
        type: string|ActionType;
        apply: (tx: WrappedTransaction, data: ActionData<Parameters, ResultData>) => Promise<ApplyResult<ResultData>>;
        invert: (data: ActionData & Parameters, resultData: ResultData) => ActionData|null;
    }
): ActionImplementation<Parameters, ResultData> {
    const actionType = type as ActionType;
    if (actions.get(actionType) !== undefined) {
        throw new Error(`Action ${actionType} already registered.`)
    }
    const impl = function(args: Parameters): ActionData<Parameters, ResultData> { return {type: actionType, ...args}; }
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


// @VNodeType.declare is not called, on purpose.
// In layer 4, this class is extended to include some virtual properties, and it is "declared" there.
// ActionWithVirtualProperties is used in place of this class at runtime.
export class Action extends BaseVNodeType {
    static label = "Action";
    static readonly properties = {
        ...BaseVNodeType.properties,
        // The action type, e.g. "Create Article", "Delete User", etc.
        type: Joi.string().required(),
        // The JSON data that defines the action, and contains enough data to undo it.
        data: Joi.string(),
        // The time at which the action was completed.
        timestamp: Joi.date(),
        // How many milliseconds it took to run this action.
        tookMs: Joi.number(),
    };
    static async validate(dbObject: RawVNode<typeof Action>, tx: WrappedTransaction): Promise<void> {
        await super.validate(dbObject, tx);
        try {
            JSON.parse(dbObject.data);
        } catch {
            throw new ValidationError("Invalid JSON in Action data.");
        }
    }
    static readonly rel = {
        /** What VNodes were modified by this action */
        MODIFIED: { to: [BaseVNodeType] },
        /** This Action reverted another one */
        REVERTED: {
            to: [Action],
        },
    };
}
