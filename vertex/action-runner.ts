import { ActionData, getActionImplementation, ActionResult, Action } from "./action";
import { UUID } from "./lib/uuid";
import { SYSTEM_UUID } from "./schema";
import { log } from "./lib/log";
import { getVNodeType, RawVNode } from "./vnode";
import { VertexCore } from "./vertex-interface";

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
            const prevAction = await tx.pullOne(Action, a => a.revertedBy(x => x.uuid), {key: isRevertOfAction});
            if (prevAction.revertedBy) {
                throw new Error(`Action ${isRevertOfAction} has already been reverted, by Action ${prevAction.revertedBy.uuid}`);
            }
        }

        // First, apply the action:
        let modifiedNodes: RawVNode<any>[];
        let resultData: any;
        try {
            const x = await actionImplementation.apply(tx, actionData/*, context */);
            modifiedNodes = x.modifiedNodes;
            resultData = x.resultData;
        } catch (err) {
            log.error(`${type} action failed during apply() method.`);
            throw err;
        }

        // Then, validate all nodes that had changes:
        // Prototype
        for (const node of modifiedNodes) {
            if (node._labels.length > 1) {
                log.warn(`node ${node.toString()} has multiple labels: ${node._labels.join(",")}`);
            }
            const nodeType = getVNodeType(node._labels[0]);
            try {
                await nodeType.validate(node, tx);
            } catch (err) {
                log.error(`${type} action failed during transaction validation: ${err}`);
                throw err;
            }
        }

        // Then record the entry into the global action log, since the action succeeded.
        const tookMs = (new Date()).getTime() - startTime.getTime();

        const actionUpdate = await tx.run(`
            MERGE (a:Action {uuid: $actionUuid})
            SET a += {type: $type, timestamp: datetime(), tookMs: $tookMs, data: $dataJson}

            ${isRevertOfAction ? `
                WITH a
                MATCH (oldAction:Action {uuid: $isRevertOfAction})
                MERGE (a)-[:REVERTED]->(oldAction)
            `: ""}

            WITH a
            MATCH (u:User {uuid: $userUuid})
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

        if (modifiedNodes) {
            // Mark the Action as having :MODIFIED certain nodes.
            await tx.run(`
                MATCH (a:Action {uuid: $actionUuid})
                MATCH (n) WHERE id(n) IN $modifiedIds
                MERGE (a)-[:MODIFIED]->(n)
            `, {
                actionUuid,
                modifiedIds: modifiedNodes.map(n => n._identity),
            });
            // If a node was deleted, this will ignore it.
        }

        return [resultData, tookMs];
    });

    log(`${type} (${tookMs} ms)`); // TODO: a way for actions to describe themselves verbosely
    log.debug(`${type}: ${JSON.stringify({...otherData, result, actionUuid})}`);

    result.actionUuid = actionUuid;

    return result;
}
