/**
 * Vertex Framework uses the command pattern, where all operations that can change the site's content in any way
 * (other than data/schema migrations) are described as "actions" (a.k.a. mutations) that take the current state and
 * transform it to another state. Many actions are invertable, making it easy to revert edits, undo changes, etc.
 */
import { VNID } from "../lib/types/vnid";
import { BaseVNodeType, RawVNode, ValidationError } from "../layer2/vnode-base";
import { WrappedTransaction } from "../transaction";
import { C } from "../layer2/cypher-sugar";
// Unfortunately we have to "cheat" a bit and use VNodeType from layer 4 here instead of BaseVNodeType:
import { VNodeType } from "../layer4/vnode";
import { Field } from "../lib/types/field";


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
    type: string;
} & Parameters;

/**
 * The data returned by an action implementation's apply() method.
 * For example, when creating a new user, this returns the user's VNID.
 */
interface ApplyResult<ResultData extends Record<string, any> = {}> {  // eslint-disable-line @typescript-eslint/ban-types
    /**
     * Any result data that the action wants to pass back. Importantly, this must also include enough information to
     * reverse the action, if it's a reversable action (e.g. if this was a "Delete" action, this should contain enough
     * data to reconstruct the deleted object.)
     */
    resultData: ResultData;
    /**
     * A list of node VNIDs for any nodes that were modified by this action, so that the nodes can be validated, and
     * the (:Action)-[:MODIFIED]-> relationship can be created, giving us a change history for every node in the graph.
     */
    modifiedNodes: VNID[];
}

/** TypeScript helper: given an ActionData type, this gets the action's apply() return value, if known */
export type ActionResult<T extends ActionData> = (
    T extends ActionData<infer Parameters, infer ResultData> ? ResultData : any
)&{actionId: VNID};


/** Base class for an Action, defining the interface that all actions must adhere to. */
export interface ActionImplementation<ActionType extends string = string, Parameters extends Record<string, any> = any, ResultData extends Record<string, any> = {}> {  // eslint-disable-line @typescript-eslint/ban-types
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
const actions: Map<string, ActionImplementation> = new Map();

/**
 * Define a new Action.
 *
 * Returns an ActionImplementation which can be used to run actions of this type, and which
 * can be called to generate a data structure which represents a specific action of this type.
 */
export function defineAction<ActionTypeString extends string, Parameters extends Record<string, any>, ResultData = Record<string, never>>(
    {type, apply, invert}: {
        type: ActionTypeString;
        parameters: Parameters;
        resultData?: ResultData;
        apply: (tx: WrappedTransaction, data: ActionData<Parameters, ResultData>) => Promise<ApplyResult<ResultData>>;
        invert: (data: ActionData & Parameters, resultData: ResultData) => ActionData|null;
    }
): ActionImplementation<ActionTypeString, Parameters, ResultData> {
    if (actions.get(type) !== undefined) {
        throw new Error(`Action ${type} already registered.`)
    }
    const impl = function(args: Parameters): ActionData<Parameters, ResultData> { return {type, ...args}; }
    impl.type = type;
    impl.apply = apply;
    impl.invert = invert;
    actions.set(type, impl);
    return impl;
}

/**
 * Get an Action Implementation, given an ActionType
 * @param type 
 */
export function getActionImplementation(type: string): ActionImplementation|undefined {
    return actions.get(type);
}


@VNodeType.declare
export class Action extends VNodeType {
    static label = "Action";
    static readonly properties = {
        ...VNodeType.properties,
        // The action type, e.g. "Create Article", "Delete User", etc.
        type: Field.String,
        // The time at which the action was completed.
        timestamp: Field.DateTime,
        // How many milliseconds it took to run this action.
        tookMs: Field.Int,
        // Did this action (permanently) delete any nodes? (Set by the trackActionChanges trigger), used by the
        // getActionChanges() function. If this is > 0, this action cannot be undone/reversed.
        deletedNodesCount: Field.Int,
    };
    static async validate(dbObject: RawVNode<typeof Action>, tx: WrappedTransaction): Promise<void> {
        await super.validate(dbObject, tx);
    }
    static readonly rel = {
        /** What VNodes were modified by this action */
        MODIFIED: { to: [BaseVNodeType] },
        /** This Action reverted another one */
        REVERTED: {
            to: [Action],
        },
    };

    /////// The following is "forwards compatible" with functionality introduced in layer 4, but explicitly doesn't
    /////// import any layer 4 functionality:
    static readonly virtualProperties = {
        revertedBy: {
            type: "one-relationship" as const,
            query: C`(@target:${Action})-[:${Action.rel.REVERTED}]->(@this)`,
            target: Action,
        },
        revertedAction: {
            type: "one-relationship" as const,
            query: C`(@this)-[:${Action.rel.REVERTED}]->(@target:${Action})`,
            target: Action,
        },
    };
    static readonly derivedProperties = {};
    /////// End layer 4 compatiblity
}
