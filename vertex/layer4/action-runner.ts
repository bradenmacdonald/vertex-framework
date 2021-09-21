import { ActionRequest, getActionDefinition, ActionResult, Action } from "./action.ts";
import { VNID } from "../lib/types/vnid.ts";
import { SYSTEM_VNID } from "./schema.ts";
import { log } from "../lib/log.ts";
import { VertexCore } from "../vertex-interface.ts";
import { neoNodeToRawVNode } from "../layer2/cypher-return-shape.ts";
import { C } from "../layer2/cypher-sugar.ts";
import { Field, Node } from "../lib/types/field.ts";
import { UndoAction } from "./action-generic.ts";

/**
 * Run an action, storing it onto the global changelog so it can be reverted if needed.
 * @param actionRequest Structure representing the action and its parameters
 */
export async function runAction<T extends ActionRequest>(graph: VertexCore, actionRequest: T, userId?: VNID): Promise<ActionResult<T>> {
    const actionId = VNID();
    const startTime = new Date();
    const {type, parameters} = actionRequest;
    const ActionDefinition = getActionDefinition(type);
    if (ActionDefinition === undefined) {
        throw new Error(`Unknown Action type: "${type}"`);
    }
    if (userId === undefined) {
        userId = SYSTEM_VNID;
    }

    const [result, tookMs, description] = await graph._restrictedWrite(async (tx) => {

        // First, apply the action:
        let modifiedNodeIds: VNID[];
        // deno-lint-ignore no-explicit-any
        let resultData: any;
        let description: string;
        try {
            const x = await ActionDefinition.apply(tx, parameters);
            modifiedNodeIds = x.modifiedNodes;
            resultData = x.resultData;
            description = x.description;
        } catch (err) {
            log.error(`${type} action failed during apply() method.`);
            throw err;
        }

        if (modifiedNodeIds.length > 0) {
            // Mark the Action as having :MODIFIED any affects nodes, and also retrieve the current version of them.
            // (If a node was deleted, this will ignore it.)
            const result = await tx.query(C`
                MERGE (a:${Action} {id: ${actionId}})
                WITH a
                // Most efficient way to MATCH either a :VNode or a :DeletedVNode by ID:
                CALL {
                    MATCH (n:VNode) WHERE n.id IN ${modifiedNodeIds} RETURN n
                    UNION
                    MATCH (n:DeletedVNode) WHERE n.id IN ${modifiedNodeIds} RETURN n
                }
                MERGE (a)-[:${Action.rel.MODIFIED}]->(n)
            `.RETURN({n: Field.Node}));
            // Then, validate all nodes that had changes:
            for (const resultRow of result) {
                const node: Node = resultRow.n;
                if (node.labels.length < 2) {
                    // This is not a problem of bad data, it's a problem with the Action implementation
                    throw new Error(`Tried saving a VNode without additional labels. Every VNode must have the :VNode label and at least one other label.`);
                }
                if (node.labels.includes("DeletedVNode")) {
                    if (node.labels.includes("VNode")) {
                        throw new Error("Nodes must not have :VNode and :DeletedVNode");
                    }
                    continue;  // Don't validate deleted nodes
                }
                for (const label of node.labels) {
                    if (label === "VNode") {
                        continue;
                    }
                    const nodeType = graph.getVNodeType(label);
                    // Make sure all required labels are applied:
                    for (let parentType = Object.getPrototypeOf(nodeType); parentType.label; parentType = Object.getPrototypeOf(parentType)) {
                        if (!node.labels.includes(parentType.label)) {
                            throw new Error(`VNode with label :${label} is missing required inherited label :${parentType.label}`);
                        }
                    }
                    // Validate this VNodeType:
                    try {
                        await nodeType.validate(neoNodeToRawVNode(node, nodeType, "n"), tx);
                    } catch (err) {
                        log.error(`${type} action failed during transaction validation: ${err}`);
                        throw err;
                    }
                }
            }
        }

        // Is this action a revert of a previous action?
        const isRevertOfAction: VNID|null = (type === UndoAction.type) ? parameters.actionId : null;

        // Then record the entry into the global action log, since the action succeeded.
        const tookMs = (new Date()).getTime() - startTime.getTime();

        const actionUpdate = await tx.run(`
            MERGE (a:Action:VNode {id: $actionId})
            SET a += {type: $type, timestamp: datetime(), tookMs: $tookMs, description: $description, deletedNodesCount: 0}
            // Note: set deletedNodesCount=0 for now, the trigger will update it later if any nodes were deleted.

            ${isRevertOfAction ? `
                WITH a
                MATCH (oldAction:Action:VNode {id: $isRevertOfAction})
                MERGE (a)-[:REVERTED]->(oldAction)
            `: ""}

            WITH a
            MATCH (u:User:VNode {id: $userId})
            CREATE (u)-[:PERFORMED]->(a)

            RETURN u
        `, {
            type: type,
            actionId,
            userId,
            tookMs,
            description,
            isRevertOfAction,
        });

        // This user ID validation happens very late but saves us a separate query.
        if (actionUpdate.records.length === 0) {
            throw new Error(`Invalid user ID (${userId}) or action revert ID (${isRevertOfAction}) - unable to apply action.`);
        }

        return [resultData, tookMs, description];
    });

    // Calculate how long it took to commit the transaction too
    const commitMs = (new Date()).getTime() - startTime.getTime() - tookMs;

    log.info(`${description} (${type} took ${tookMs} ms + ${commitMs} ms)`); // TODO: a way for actions to describe themselves verbosely

    result.actionId = actionId;
    result.actionDescription = description;

    return result;
}
