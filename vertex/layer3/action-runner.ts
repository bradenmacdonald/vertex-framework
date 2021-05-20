import { ActionData, getActionImplementation, ActionResult, Action } from "./action";
import { VNID } from "../lib/types/vnid";
import { SYSTEM_VNID } from "./schema";
import { log } from "../lib/log";
import { getVNodeType } from "../layer2/vnode-base";
import { VertexCore } from "../vertex-interface";
import { neoNodeToRawVNode } from "../layer2/cypher-return-shape";
import { C } from "../layer2/cypher-sugar";
import { Field, Node } from "../lib/types/field";

/**
 * Run an action, storing it onto the global changelog so it can be reverted if needed.
 * @param actionData Structure representing the action and its parameters
 */
export async function runAction<T extends ActionData>(graph: VertexCore, actionData: T, userId?: VNID, isRevertOfAction?: VNID): Promise<ActionResult<T>> {
    const actionId = VNID();
    const startTime = new Date();
    const {type, ...otherData} = actionData;
    const actionImplementation = getActionImplementation(type);
    if (actionImplementation === undefined) {
        throw new Error(`Unknown Action type: "${type}"`);
    }
    if (userId === undefined) {
        userId = SYSTEM_VNID;
    }

    const [result, tookMs] = await graph._restrictedWrite(async (tx) => {
        if (isRevertOfAction) {
            // We're reverting a previously applied action. Make sure it exists and isn't already reverted:
            const prevAction = await tx.queryOne(C`
                MATCH (prevAction:${Action} {id: ${isRevertOfAction}})
                OPTIONAL MATCH (prevAction)<-[:${Action.rel.REVERTED}]-(existingRevert:${Action})
                WITH prevAction.id AS prevId, collect(existingRevert {.id}) AS existingRevert
            `.RETURN({"prevId" : Field.VNID, existingRevert: Field.List(Field.Record({id: Field.String}))}));
            //const prevAction = await tx.pullOne(Action, a => a.revertedBy(x => x.id), {key: isRevertOfAction});
            if (prevAction.existingRevert.length > 0) {
                throw new Error(`Action ${isRevertOfAction} has already been reverted, by Action ${prevAction.existingRevert[0].id}`);
            }
        }

        // First, apply the action:
        let modifiedNodeIds: VNID[];
        let resultData: any;
        try {
            const x = await actionImplementation.apply(tx, actionData/*, context */);
            modifiedNodeIds = x.modifiedNodes;
            resultData = x.resultData;
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
                    const nodeType = getVNodeType(label);
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

        // Then record the entry into the global action log, since the action succeeded.
        const tookMs = (new Date()).getTime() - startTime.getTime();

        const actionUpdate = await tx.run(`
            MERGE (a:Action:VNode {id: $actionId})
            SET a += {type: $type, timestamp: datetime(), tookMs: $tookMs, deletedNodesCount: 0}
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
            isRevertOfAction,
        });

        // This user ID validation happens very late but saves us a separate query.
        if (actionUpdate.records.length === 0) {
            throw new Error("Invalid user ID - unable to apply action.");
        }

        return [resultData, tookMs];
    });

    log(`${type} (${tookMs} ms)`); // TODO: a way for actions to describe themselves verbosely

    result.actionId = actionId;

    return result;
}
