import { Transaction } from "neo4j-driver";
import { UUID } from "./lib/uuid";
import { VNodeType, isVNodeType, RawVNode } from "./vnode";

export type FieldType = VNodeType | ReturnShape | "uuid" | "string" | "number" | "boolean" | "any";
export type ReturnTypeFor<DT extends FieldType> = (
    DT extends VNodeType ? RawVNode<DT> :
    DT extends ReturnShape ? TypedRecord<DT> :
    DT extends "uuid" ? UUID :
    DT extends "string" ? string :
    DT extends "number" ? number :
    DT extends "boolean" ? boolean :
    DT extends "any" ? any :
    never
);
export type ReturnShape = {[key: string]: FieldType};
export type TypedRecord<RS extends ReturnShape> = {
    [key in keyof RS]: ReturnTypeFor<RS[key]>;
};

/**
 * Run a query on the Neo4j graph database and return its result.
 * Unlike tx.run(), this method will return a typed result set, according to returnShape
 * @param cypherQuery The cypher query to run
 * @param args The parameters to pass into the query
 * @param returnShape The expected shape of the result (e.g. {u: User, "count(*)": number})
 * @param tx The transaction to run the query in, if any
 */
export async function query<RS extends ReturnShape>(
    cypherQuery: string,
    args: {[key: string]: any},
    returnShape: RS,
    tx: Transaction
): Promise<TypedRecord<RS>[]> {
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
export async function queryOne<RS extends ReturnShape>(
    cypherQuery: string,
    args: {[key: string]: any},
    returnShape: RS,
    tx: Transaction
): Promise<TypedRecord<RS>> {
    const result = await query(cypherQuery, args, returnShape, tx);
    if (result.length !== 1) {
        throw new Error(`Expected a single result, got ${result.length}`);
    }
    return result[0];
}
