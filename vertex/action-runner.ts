import { ActionData, getActionImplementation, ActionResult } from "./action";
import { UUID } from "./lib/uuid";
import { SYSTEM_UUID } from "./schema";
import { log } from "./lib/log";
import { getVNodeType, RawVNode } from "./vnode";
import { VertexCore } from "./vertex-interface";

/**
 * Run an action, storing it onto the global changelog so it can be reverted if needed.
 * @param actionData Structure representing the action and its parameters
 */
export async function runAction<T extends ActionData>(graph: VertexCore, actionData: T, userUuid?: UUID): Promise<ActionResult<T>> {
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
    // const context = {
    //     // TBD what data is available via this mechanism.
    //     actionUuid,
    // };

    const [result, tookMs] = await graph._restrictedWrite(async (tx) => {
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

            WITH a
            MATCH (u:User {uuid: $userUuid})
            CREATE (u)-[:PERFORMED]->(a)

            // Mark the Action as having :MODIFIED certain nodes. This requires a strange construction, because we
            // don't want to end the query here if the list of modified nodes is empty
            ${modifiedNodes.length ? "WITH a, u MATCH (n) WHERE id(n) IN $modifiedIds MERGE (a)-[:MODIFIED]->(n)" : ""}

            RETURN u
        `, {
            type: type,
            actionUuid,
            userUuid,
            tookMs,
            dataJson: JSON.stringify({...otherData, result: resultData}),
            modifiedIds: modifiedNodes.map(n => n._identity),
        });

        // This user ID validation happens very late but saves us a separate query.
        if (actionUpdate.records.length === 0) {
            throw new Error("Invalid user ID - unable to apply action.");
        }

        return [resultData, tookMs];
    });

    log(`${type} (${tookMs} ms)`); // TODO: a way for actions to describe themselves verbosely
    log.debug(`${type}: ${JSON.stringify({...otherData, result})}`);

    return result;
}
