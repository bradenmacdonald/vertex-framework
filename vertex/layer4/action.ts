// deno-lint-ignore-file no-explicit-any ban-types
/**
 * Vertex Framework uses the command pattern, where all operations that can change the site's content in any way
 * (other than data/schema migrations) are described as "actions" (a.k.a. mutations) that take the current state and
 * transform it to another state. A generic UndoAction is provided which can be used to undo any action, making it easy
 * to revert edits, undo changes, etc.
 */
import { VNID } from "../lib/types/vnid.ts";
import { BaseVNodeType, RawVNode } from "../layer2/vnode-base.ts";
import { WrappedTransaction } from "../transaction.ts";
import { C } from "../layer2/cypher-sugar.ts";
import { VNodeType } from "../layer3/vnode.ts";
import { Field } from "../lib/types/field.ts";


/**
 * Base interface that holds all the data to run a specific action.
 * An action might be "rename article", so in that case the ActionData would look like:
 *     {
 *         type: "renameArticle",
 *         parameters: {
 *             articleId: "foo",
 *             newTitle: "This is the new title",
 *         },
 *     }
 */
export type ActionRequest<Parameters extends Record<string, any> = any, ResultData extends Record<string, any> = any> = {
    type: string;
    parameters: Parameters;
};

/**
 * The data returned by an action implementation's apply() method.
 * For example, when creating a new user, this returns the user's VNID.
 */
interface ApplyResult<ResultData extends Record<string, any> = {}> {
    /**
     * Any result data that the action wants to pass back.
     */
    resultData: ResultData;
    /**
     * A list of node VNIDs for any nodes that were modified by this action, so that the nodes can be validated, and
     * the (:Action)-[:MODIFIED]-> relationship can be created, giving us a change history for every node in the graph.
     */
    modifiedNodes: VNID[];
    /**
     * A textual description (in past tense) of what this action did, in English, with Node IDs inline.
     * e.g. `Created ${Person.withId(newPersonVNID)}`
     */
    description: string;
}

/** TypeScript helper: given an ActionRequest type, this gets the shape of the return value from runAction(), if known */
export type ActionResult<T extends ActionRequest> = (
    T extends ActionRequest<infer Parameters, infer ResultData> ? ResultData : any
)&{actionId: VNID, actionDescription: string};


/** Base class for an Action, defining the interface that all actions must adhere to. */
export interface ActionDefinition<ActionType extends string = string, Parameters extends Record<string, any> = any, ResultData extends Record<string, any> = {}> {
    readonly type: ActionType;

    // Generate the ActionData for this action:
    (args: Parameters): ActionRequest<Parameters, ResultData>;

    apply(tx: WrappedTransaction, parameters: Parameters): Promise<ApplyResult<ResultData>>;
}

/**
 * The global list of actions that have been defined by defineAction()
 */
const actions: Map<string, ActionDefinition> = new Map();

/**
 * Define a new Action.
 *
 * Returns an ActionDefinition which can be used to run actions of this type, and which
 * can be called to generate a data structure which represents a specific action of this type.
 */
export function defineAction<ActionTypeString extends string, Parameters extends Record<string, any>, ResultData = Record<string, never>>(
    {type, apply}: {
        type: ActionTypeString;
        parameters: Parameters;
        resultData?: ResultData;
        apply: (tx: WrappedTransaction, parameters: Parameters) => Promise<ApplyResult<ResultData>>;
    }
): ActionDefinition<ActionTypeString, Parameters, ResultData> {
    if (actions.get(type) !== undefined) {
        throw new Error(`Action ${type} already registered.`)
    }
    const defn = function(parameters: Parameters): ActionRequest<Parameters, ResultData> { return {type, parameters}; }
    defn.type = type;
    defn.apply = apply;
    actions.set(type, defn);
    return defn;
}

/**
 * Get an Action Definition, given an ActionType
 * @param type 
 */
export function getActionDefinition(type: string): ActionDefinition|undefined {
    return actions.get(type);
}


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
        // What this action did, in English, with Node IDs inline like `Created ${Person.withId(newPersonVNID)}`
        description: Field.String,
        // Did this action (permanently) delete any nodes? (Set by the trackActionChanges trigger), used by the
        // getActionChanges() function. If this is > 0, this action cannot be undone/reversed.
        deletedNodesCount: Field.Int,
    };
    static async validate(_dbObject: RawVNode<typeof this>, _tx: WrappedTransaction): Promise<void> {
        // No specific validation
    }
    static readonly rel = this.hasRelationshipsFromThisTo({
        /** What VNodes were modified by this action */
        MODIFIED: {
            to: [BaseVNodeType],
            cardinality: VNodeType.Rel.ToManyUnique,
        },
        /** This Action reverted another one */
        REVERTED: {
            to: [this],
            cardinality: VNodeType.Rel.ToOneOrNone,
        },
    });

    static readonly virtualProperties = this.hasVirtualProperties({
        revertedBy: {
            type: "one-relationship",
            query: C`(@target:${this})-[:${this.rel.REVERTED}]->(@this)`,
            target: this,
        },
        revertedAction: {
            type: "one-relationship",
            query: C`(@this)-[:${this.rel.REVERTED}]->(@target:${this})`,
            target: this,
        },
    });
    static readonly derivedProperties = {};
}
