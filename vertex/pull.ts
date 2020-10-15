import { VertexCore } from "./vertex-interface";
import { log } from "./lib/log";
import {
    PropertyDataType,
    VNodeType,
    VirtualManyRelationshipProperty,
    VirtualOneRelationshipProperty,
    VirtualPropertyDefinition,
} from "./vnode";
import { WrappedTransaction } from "./transaction";

////////////////////////////// VNode Data Request format ////////////////////////////////////////////////////////////

const vnodeType = Symbol("vnodeType");

type FieldNameFor<T extends VNodeType> = keyof T["properties"] | keyof T["virtualProperties"];

export type DataRequestFields<T extends VNodeType> = (
    {[K in keyof T["properties"]]?: DataRequestValue<T, K>} |
    {[K2 in keyof T["virtualProperties"]]?: DataRequestValue<T, K2>}
);

export type DataRequest<T extends VNodeType, Fields extends DataRequestFields<T>> = {
    [K2 in (keyof Fields)&FieldNameFor<T>]: DataRequestValue<T, K2, Fields[K2]>
}&{[vnodeType]: T}

    type DataRequestValue<T extends VNodeType, FieldName extends FieldNameFor<T>, boolType = true|false|boolean|undefined> = (
        FieldName extends keyof T["properties"] ? boolType :
        FieldName extends keyof T["virtualProperties"] ? DataRequestValueForVirtualProp<T["virtualProperties"][FieldName]> :
        {invalidKey: FieldName}
    );

        type DataRequestValueForVirtualProp<VP extends VirtualPropertyDefinition> = (
            VP extends VirtualManyRelationshipProperty ? {
                [K in keyof VP["gives"]]?: FieldRequestValueForVirtualManyPropResult<VP, K>;
            } :
            VP extends VirtualOneRelationshipProperty ? {b: boolean} :
            {notAVirtualProp: VP}
        );

            type FieldRequestValueForVirtualManyPropResult<VP extends VirtualManyRelationshipProperty, K extends keyof VP["gives"]> = (
                VP["gives"][K] extends VNodeType ? DataRequest<VP["gives"][K], any> :
                never
            );

export interface DataRequestFilter {
    /** Key: If specified, the main node must have a UUID or shortId that is equal to this. */
    key?: string;
    /**
     * Filter the main node(s) of this data request to only those that match this predicate.
     * 
     * Examples:
     *     @.name = $name
     *     @.dateOfbirth < date("2002-01-01")
     *     EXISTS { MATCH (@)-->(m) WHERE @.age = m.age }
     */
    where?: string;
    /** Params: Values that are referenced in the "where" predicate, if any. */
    params?: {[key: string]: any};
    /** Order the results by one of the fields (e.g. "name" or "name DESC") */
    orderBy?: string;
}

////////////////////////////// VNode Data Result format /////////////////////////////////////////////////////////////



export type DataResult<Request extends DataRequest<any, any>> = (
    Request extends DataRequest<infer T, infer Fields> ?
        {[K in keyof Request]: ResultFieldFor<T, Fields, Request, K>}
    :
        {"error": "DataResult<> Couldn't infer DataRequest type parameters"}
);

    type ResultFieldFor<T extends VNodeType, Fields extends DataRequestFields<T>, Request extends DataRequest<T, Fields>, K extends keyof Request> = (
        K extends keyof T["properties"] ? 
            (
                boolean extends Request[K] ? PropertyDataType<T["properties"], K>|undefined :
                true extends Request[K] ? PropertyDataType<T["properties"], K> :
                undefined
            ) :
        K extends keyof T["virtualProperties"] ? VirtualPropertyDataType<T["virtualProperties"][K], Request[K]> :
        never
    );

        type VirtualPropertyDataType<VP extends VirtualPropertyDefinition, Request> = (
            Request extends DataRequestValueForVirtualProp<VP> ? {[K in keyof Request]: any} :
            never
        );

////////////////////////////// Load VNode data from the graph ///////////////////////////////////////////////////////

/** Helper convenience function to create a fully typed DataRequest, which can be assigned to a variable */
export function DataRequest<T extends VNodeType, Fields extends DataRequestFields<T>>(tn: T, rq: Fields): DataRequest<T, Fields> {
    return {...rq, [vnodeType]: tn} as DataRequest<T, Fields>;
}

/**
 * Build a cypher query to load some data from the Neo4j graph database
 * @param request DataRequest, which determines the details and shape of the data being requested
 * @param args Arguments such as pimrary keys to filter by
 */
export function buildCypherQuery<Request extends DataRequest<VNodeType, any>>(request: Request, filter: DataRequestFilter = {}): {query: string, params: {[key: string]: any}} {
    const nodeType = request[vnodeType];
    const label = nodeType.label;
    let query: string;
    const params: {[key: string]: any} = filter.params || {};
    const workingVars = ["_node"];

    if (filter.key === undefined) {
        query = `MATCH (_node:${label})\n`;
    } else {
        const key = filter.key;
        if (key.length === 36) {
            // Look up by UUID.
            query = `MATCH (_node:${label} {uuid: $_nodeUuid})\n`;
            params._nodeUuid = key;
        } else if (key.length < 36) {
            if (nodeType.properties.shortId === undefined) {
                throw new Error(`The requested ${nodeType.name} VNode type doesn't use shortId.`);
            }
            query = `MATCH (_node:${label})<-[:IDENTIFIES]-(:ShortId {path: "${label}/" + $_nodeShortid})\n`;
            params._nodeShortid = key;
        } else {
            throw new Error("shortId must be shorter than 36 characters; UUID must be exactly 36 characters.");
        }
    }
    if (filter.where) {
        query += `WHERE ${filter.where.replace("@", "_node")}\n`;
    }

    // TODO: Build a query like:
    // MATCH (_node:Device)::{$key}

    // OPTIONAL MATCH (child:Device)-[rel:IS_A]->(_node)
    // WITH _node, child {.shortId, .name, .description, .readinessLevel, weight: rel.weight}
    // ORDER BY child.weight DESC
    // WITH _node, collect(child) as children

    // OPTIONAL MATCH (_node)-[rel:IS_A]->(parent:Device)
    // WITH _node, children, parent {.shortId, .name, .description, .readinessLevel, weight: rel.weight}
    // ORDER BY parent.weight DESC
    // WITH _node, children, collect(parent) AS parents

    // OPTIONAL MATCH (_node)-[:HAS_HERO_IMAGE]->(heroImage:Image)-[:HAS_DATA]->(heroImageData:DataFile)
    // WITH _node, children, parents, heroImage {.shortId, .description, sha256Hash: heroImageData.sha256Hash}
    
    // Build the final RETURN statement
    const rawPropertiesIncluded = (
        Object.keys(nodeType.properties)
        .filter(propName => request[propName] === true)
        .map(propName => `_node.${propName} AS ${propName}`)
    );
    // Note re workingVars.slice(1): We remove _node (first one) from the workingVars because we never return _node
    // directly, only the subset of its properties actually requested. But we've kept it around this long because it's
    // used by virtual properties.
    query += `\nRETURN ${[...workingVars.slice(1), ...rawPropertiesIncluded].join(", ")}`;

    const orderBy = filter.orderBy || nodeType.defaultOrderBy;
    if (orderBy) {
        query += ` ORDER BY ${orderBy}`;
    }

    return {query, params};
}

export async function pull<Request extends DataRequest<any, any>>(
    tx: WrappedTransaction,
    request: Request,
    filter: DataRequestFilter = {},
): Promise<DataResult<Request>[]> {
    const requestFields = Object.keys(request);
    const query = buildCypherQuery(request, filter);
    log.debug(query.query);

    const result = await tx.run(query.query, query.params);

    return result.records.map(record => {
        const newRecord: any = {};
        for (const field of requestFields) {
            if (request[field]) {
                newRecord[field] = record.get(field);
            }
        }
        return newRecord;
    });
}

export async function pullOne<Request extends DataRequest<any, any>>(
    tx: WrappedTransaction,
    request: Request,
    filter: DataRequestFilter = {},
): Promise<DataResult<Request>> {
    
    const result = await pull<Request>(tx, request, filter);

    if (result.length !== 1) {
        throw new Error(`Expected a single result, got ${result.length}`);
    }

    return result[0];
}
