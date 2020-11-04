import { ActionData, getActionImplementation, ActionResult, Action } from "./action";
import { UUID } from "../lib/uuid";
import { SYSTEM_UUID } from "./schema";
import { log } from "../lib/log";
import { getVNodeType } from "../layer2/vnode";
import { VertexCore } from "../vertex-interface";
import { Node } from "neo4j-driver";
import { neoNodeToRawVNode } from "../layer2/cypher-return-shape";
import { C } from "../layer2/cypher-sugar";

/**
 * Run an action, storing it onto the global changelog so it can be reverted if needed.
 * @param actionData Structure representing the action and its parameters
 */
export async function runAction<T extends ActionData>(graph: VertexCore, actionData: T, userUuid?: UUID, isRevertOfAction?: UUID): Promise<ActionResult<T>> {
    const actionUuid = UUID();
    const startTime = new Date();
    const {type, ...otherData} = actionData;
    const actionImplementation = getActionImplementation(type);
    if (actionImplementation === undefined) {
        throw new Error(`Unknown Action type: "${type}"`);
    }
    if (userUuid === undefined) {
        userUuid = SYSTEM_UUID;
    }

    const [result, tookMs] = await graph._restrictedWrite(async (tx) => {
        if (isRevertOfAction) {
            // We're reverting a previously applied action. Make sure it exists and isn't already reverted:
            const prevAction = await tx.queryOne(C`
                MATCH (prevAction:${Action} {uuid: ${isRevertOfAction}})
                OPTIONAL MATCH (prevAction)<-[:${Action.rel.REVERTED}]-(existingRevert:${Action})
                WITH prevAction.uuid AS prevUuid, collect(existingRevert {.uuid}) AS existingRevert
            `.RETURN({"prevUuid" : "uuid", existingRevert: {list: {map: {uuid: "string"}}}}));
            //const prevAction = await tx.pullOne(Action, a => a.revertedBy(x => x.uuid), {key: isRevertOfAction});
            if (prevAction.existingRevert.length > 0) {
                throw new Error(`Action ${isRevertOfAction} has already been reverted, by Action ${prevAction.existingRevert[0].uuid}`);
            }
        }

        // First, apply the action:
        let modifiedNodeUUIDs: UUID[];
        let resultData: any;
        try {
            const x = await actionImplementation.apply(tx, actionData/*, context */);
            modifiedNodeUUIDs = x.modifiedNodes;
            resultData = x.resultData;
        } catch (err) {
            log.error(`${type} action failed during apply() method.`);
            throw err;
        }

        if (modifiedNodeUUIDs.length > 0) {
            // Mark the Action as having :MODIFIED any affects nodes, and also retrieve the current version of them.
            // (If a node was deleted, this will ignore it.)
            const result = await tx.query(C`
                MERGE (a:${Action} {uuid: ${actionUuid}})
                WITH a
                MATCH (n:VNode) WHERE n.uuid IN ${modifiedNodeUUIDs}
                MERGE (a)-[:${Action.rel.MODIFIED}]->(n)
            `.RETURN({n: "any"}));
            // Then, validate all nodes that had changes:
            for (const resultRow of result) {
                const node: Node<number> = resultRow.n;
                for (const label of node.labels) {
                    if (label === "VNode") {
                        continue;
                    }
                    const nodeType = getVNodeType(label);
                    try {
                        await nodeType.validate(neoNodeToRawVNode(node, "n"), tx);
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
            MERGE (a:Action:VNode {uuid: $actionUuid})
            SET a += {type: $type, timestamp: datetime(), tookMs: $tookMs, data: $dataJson}

            ${isRevertOfAction ? `
                WITH a
                MATCH (oldAction:Action:VNode {uuid: $isRevertOfAction})
                MERGE (a)-[:REVERTED]->(oldAction)
            `: ""}

            WITH a
            MATCH (u:User:VNode {uuid: $userUuid})
            CREATE (u)-[:PERFORMED]->(a)

            RETURN u
        `, {
            type: type,
            actionUuid,
            userUuid,
            tookMs,
            dataJson: JSON.stringify({...otherData, result: resultData}),
            isRevertOfAction,
        });

        // This user ID validation happens very late but saves us a separate query.
        if (actionUpdate.records.length === 0) {
            throw new Error("Invalid user ID - unable to apply action.");
        }

        return [resultData, tookMs];
    });

    log(`${type} (${tookMs} ms)`); // TODO: a way for actions to describe themselves verbosely
    log.debug(`${type}: ${JSON.stringify({...otherData, result, actionUuid})}`);

    result.actionUuid = actionUuid;

    return result;
}
