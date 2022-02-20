import { ActionRequest, getActionDefinition, ActionResult, Action } from "./action.ts";
import { VNID } from "../lib/types/vnid.ts";
import { SYSTEM_VNID } from "./schema.ts";
import { log } from "../lib/log.ts";
import { VertexCore } from "../vertex-interface.ts";
import { neoNodeToRawVNode } from "../layer2/cypher-return-shape.ts";
import { C } from "../layer2/cypher-sugar.ts";
import { Field, Node } from "../lib/types/field.ts";
import { baseValidateVNode } from "./validation.ts";

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
        const modifiedNodeIds = new Set<VNID>();

        const actionCreate = await tx.query(C`
            MATCH (u:User:VNode {id: ${userId}})
            CREATE (a:${Action} {id: ${actionId}})
            CREATE (u)-[:PERFORMED]->(a)
            SET a.type = ${type}
            SET a.timestamp = datetime()
            // .tookMs and .description will be set below
            // .deletedNodeIds will be set automatically by the trackActionChanges trigger
            RETURN null
        `);

        if (actionCreate.length === 0) {
            throw new Error(`Invalid user ID (${userId}) - unable to apply action.`);
        }

        // deno-lint-ignore no-explicit-any
        let resultData: any;
        let description: string;
        try {
            const x = await ActionDefinition.apply(tx, parameters);
            x.modifiedNodes.forEach(id => modifiedNodeIds.add(id));
            resultData = x.resultData;
            description = x.description;
        } catch (err) {
            throw new Error(`${type} action failed during apply() method (${err.message}).`, {cause: err});
        }

        if (modifiedNodeIds.size > 0) {
            // Mark the Action as having :MODIFIED any affects nodes, and also retrieve the current version of them.
            // (If a node was deleted, this will ignore it.)
            const modifiedNodeIdsArray = Array.from(modifiedNodeIds);
            const result = await tx.query(C`
                MATCH (a:${Action} {id: ${actionId}})
                MATCH (n:VNode) WHERE n.id IN ${modifiedNodeIdsArray}
                MERGE (a)-[:${Action.rel.MODIFIED}]->(n)
            `.RETURN({n: Field.Node}));

            // Load relationship data for validation.
            // Storing large amounts of data on relationship properties is not recommended so it should be safe to pull
            // down all the relationships and their properties at once.
            const relationshipsData = await tx.query(C`
                UNWIND ${modifiedNodeIdsArray} as id
                MATCH (node:VNode {id: id})-[rel]->(target:VNode)
                WITH id, {
                    relType: type(rel),
                    relProps: properties(rel),
                    targetLabels: labels(target),
                    targetId: id(target)
                } AS rel
                RETURN id, collect(rel) AS rels
                `.givesShape({
                    id: Field.VNID,
                    rels: Field.List(Field.Record({
                        relType: Field.String,
                        relProps: Field.Any,
                        targetLabels: Field.List(Field.String),
                        targetId: Field.Int,
                    })),
                })
            );

            // Then, validate all nodes that had changes:
            for (const resultRow of result) {
                const node: Node = resultRow.n;
                if (node.labels.length < 2) {
                    // This is not a problem of bad data, it's a problem with the Action implementation
                    throw new Error(`Tried saving a VNode without additional labels. Every VNode must have the :VNode label and at least one other label.`);
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
                    const rawNode = neoNodeToRawVNode(node, nodeType, "n");
                    const relData = relationshipsData.find(rd => rd.id === rawNode.id)?.rels || [];
                    try {
                        await baseValidateVNode(nodeType, rawNode, relData, tx);
                        await nodeType.validate(rawNode, tx);
                    } catch (err) {
                        throw new Error(`${type} action failed during transaction validation (${err.message}).`, {cause: err});
                    }
                }
            }
        }

        // Then record the entry into the global action log, since the action succeeded.
        const tookMs = (new Date()).getTime() - startTime.getTime();

        await tx.queryOne(C`
            MATCH (a:${Action} {id: ${actionId}})
            SET a.tookMs = ${tookMs}
            SET a.description = ${description}
            RETURN null
        `);

        return [resultData, tookMs, description];
    });

    // Calculate how long it took to commit the transaction too
    const commitMs = (new Date()).getTime() - startTime.getTime() - tookMs;

    log.info(`${description} (${type} took ${tookMs} ms + ${commitMs} ms)`); // TODO: a way for actions to describe themselves verbosely

    result.actionId = actionId;
    result.actionDescription = description;

    return result;
}
