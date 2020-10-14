import { Transaction } from "neo4j-driver";
import { VNodeType, isVNodeType, RawVNode } from "./vnode";

type FieldType = VNodeType | "string" | "number" | "any";
type ReturnTypeFor<DT extends FieldType> = (
    DT extends VNodeType ? RawVNode<DT> :
    DT extends "string" ? string :
    DT extends "number" ? number :
    DT extends "any" ? any :
    never
);
type ReturnShapeType = {[key: string]: FieldType};
type TypedRecord<ReturnShape extends ReturnShapeType> = {
    [key in keyof ReturnShape]: ReturnTypeFor<ReturnShape[key]>;
};
type TypedRecords<ReturnShape extends ReturnShapeType> = TypedRecord<ReturnShape>[];

/**
 * Run a query on the Neo4j graph database and return its result.
 * Unlike tx.run(), this method is aware of VNode models and will return a typed result set.
 * @param cypherQuery The cypher query to run
 * @param args The parameters to pass into the query
 * @param returnShape The expected shape of the result (e.g. {u: User, "count(*)": number})
 * @param tx The transaction to run the query in, if any
 */
export async function query<ReturnShape extends ReturnShapeType>(
    cypherQuery: string,
    args: {[key: string]: any},
    returnShape: ReturnShape,
    tx: Transaction
): Promise<TypedRecords<ReturnShape>> {
    // Syntactic sugar: (tn:VNode)::{$key} or {$key}::(tn:VNode) will get the VNode of the specified type
    // (label) having the UUID or shortId specified, even if the shortId is not the "current" shortId (it was changed).
    // Note that you must not connect any relationship to the "::{$key}" part!
    // i.e. never do "(:Node)::{$key}-[:REL]->(:Foo)" as that sometimes is making a relationship to the :ShortId node.
    cypherQuery = cypherQuery.replace(/:(\w+)\)::\{\$(\w+)\}/g, (_, label, paramName) => {
        if (typeof args[paramName] !== "string") {
            throw new Error(`Expected a "${paramName}" parameter in the query for the ::{$${paramName}} key lookup.`);
        }
        if (args[paramName].length === 36) {
            // Look up by UUID.
            return `:${label} {uuid: $${paramName}})`;
            // Alternative: return `)<-[*0]-({uuid: $${paramName}})`;
        } else {
            return `:${label})<-[:IDENTIFIES]-(:ShortId {path: "${label}/" + $${paramName}})`;
        }
    });
    // Check that the RETURN statement matches "returnShape", and auto-generate it if needed.
    const returnStatement = `RETURN ${Object.keys(returnShape).join(", ")}`;
    if (cypherQuery.indexOf(returnStatement) === -1) {
        if (/\w+RETURN\w+/.test(cypherQuery)) {
            throw new Error(
                `The cypher query seems to contain a RETURN statement that differs from the expected one.\n` +
                `Expected: ${returnStatement}\bQuery:\n${cypherQuery}`
            );
        }
        cypherQuery = cypherQuery + " " + returnStatement;
    }
    const result = await tx.run(cypherQuery, args);
    return result.records.map(record => {
        const newRecord: any = {};
        for (const key of Object.keys(returnShape)) {
            const fieldValue = record.get(key);
            if (isVNodeType(returnShape[key])) { // This is a node (VNode)
                if (!fieldValue.__isNode__) { // would be nice if isNode() were exported from neo4j-driver
                    throw new Error(`Field ${key} in record is of type ${typeof fieldValue}, not a Node.`);
                }
                const node: RawVNode<any> = {
                    ...fieldValue.properties,
                    _identity: fieldValue.identity,
                    _labels: fieldValue.labels,
                };
                newRecord[key] = node;
            } else {
                // This is some plain value like "MATCH (u:User) RETURN u.name"
                // e.g. newRecord["u.name"] = fieldValue
                newRecord[key] = fieldValue;
            }
        }
        return newRecord;
    });
}

/**
 * Run a query on the Neo4j graph and return its result. Throw an exception if there is not exactly one result row.
 * @param cypherQuery The cypher query to run
 * @param args The parameters to pass into the query
 * @param returnShape The expected shape of the result (e.g. {u: User, "count(*)": number})
 * @param tx The transaction to run the query in, if any
 */
export async function queryOne<ReturnShape extends ReturnShapeType>(
    cypherQuery: string,
    args: {[key: string]: any},
    returnShape: ReturnShape,
    tx: Transaction
): Promise<TypedRecord<ReturnShape>> {
    const result = await query(cypherQuery, args, returnShape, tx);
    if (result.length !== 1) {
        throw new Error(`Expected a single result, got ${result.length}`);
    }
    return result[0];
}

/**
 * Get a single VNode from the Neo4j graph using its UUID or some set of properties that define a unique result.
 * Throws an error if the node was not found.
 * @param type the VNode type definition, created via defineVNodeType()
 * @param keyOrProps the node's UUID, shortId, or an object with filters like {email: "jamie@localhost"}
 * @param tx the current read/write transaction, if any
 */
export async function getOne<T extends VNodeType>(
    type: T,
    keyOrProps: string|{[key: string]: any},
    tx: Transaction,
): Promise<ReturnTypeFor<T>> {
    let result: TypedRecords<{node: T}>;
    if (typeof keyOrProps === "string") {
        // This is a UUID or shortId
        const cypherQuery = `MATCH (node:${type.label})::{$key}`;
        result = await query(cypherQuery, {key: keyOrProps}, {node: type}, tx);
    } else {
        // This is an object with properties+values to filter on, like {foo: true, bar: 15}
        const paramKeys = Object.keys(keyOrProps);
        const cypherQuery = `MATCH (node:${type.label} {${paramKeys.map(k => `${k}: $${k}`).join(", ")}})`;
        result = await query(cypherQuery, keyOrProps, {node: type}, tx);
    }
    if (result.length !== 1) {
        throw new Error(`Could not find ${type.label} uniquely identified by ${JSON.stringify(keyOrProps)} (matched ${result.length})`);
    }
    return result[0].node;
}

/** A Neo4j Transaction with some TechNotes-specific convenience methods */
export interface WrappedTransaction extends Transaction {
    query<ReturnShape extends ReturnShapeType>(
        cypherQuery: Parameters<typeof query>[0],
        args: Parameters<typeof query>[1],
        returnShape: ReturnShape,
    ): Promise<TypedRecords<ReturnShape>>;

    queryOne<ReturnShape extends ReturnShapeType>(
        cypherQuery: Parameters<typeof query>[0],
        args: Parameters<typeof query>[1],
        returnShape: ReturnShape,
    ): Promise<TypedRecord<ReturnShape>>;

    getOne<T extends VNodeType>(
        type: T,
        keyOrProps: string|{[key: string]: any},
    ): Promise<ReturnTypeFor<T>>;
}

/** Wrap a Neo4j Transaction with some convenience methods. */
export function wrapTransaction(tx: Transaction): WrappedTransaction {
    const mutableTx: any = tx;
    mutableTx.query = (a: any, b: any, c: any) => query(a, b, c, tx);
    mutableTx.queryOne = (a: any, b: any, c: any) => queryOne(a, b, c, tx);
    mutableTx.getOne = (a: any, b: any) => getOne(a, b, tx);
    return mutableTx;
}
