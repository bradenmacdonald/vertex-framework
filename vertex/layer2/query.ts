// deno-lint-ignore-file no-explicit-any
import type { WrappedTransaction } from "../transaction.ts";
import { convertNeo4jRecord } from "./cypher-return-shape.ts";
import { CypherQuery, CypherQueryWithReturnShape, QueryResponse } from "./cypher-sugar.ts";

/**
 * When used with pullOne() or queryOne(), this exception will be raised if there are zero results returned.
 */
 export class EmptyResultError extends Error {
    constructor() { super("Expected a single result, but got none."); }
}
/**
 * When used with pullOne() or queryOne(), this exception will be raised if there are more than one result(s) returned.
 */
export class TooManyResultsError extends Error {}

/**
 * Run a query on the Neo4j graph database and return its result.
 * Unlike tx.run(), this method will return a typed result set
 * @param cypherQuery The cypher query to run
 * @param tx The transaction to run the query in
 */
export async function query<CQ extends CypherQuery>(cypherQuery: CQ, tx: WrappedTransaction): Promise<QueryResponse<CQ>[]> {
    const result = await tx.run(cypherQuery.queryString, cypherQuery.params);

    if (cypherQuery instanceof CypherQueryWithReturnShape) {
        return result.records.map(record => convertNeo4jRecord(record, cypherQuery.returnShape)) as any[];
    } else {
        return result.records as any[];
    }
}

/**
 * Run a query on the Neo4j graph and return its result. Throw an exception if there is not exactly one result row.
 * @param cypherQuery The cypher query to run
 * @param tx The transaction to run the query in, if any
 */
export async function queryOne<CQ extends CypherQuery>(cypherQuery: CQ, tx: WrappedTransaction): Promise<QueryResponse<CQ>> {
    const result = await query(cypherQuery, tx);
    if (result.length === 0) {
        throw new EmptyResultError();
    } else if (result.length !== 1) {
        throw new TooManyResultsError(`Expected a single result, got ${result.length}`);
    }
    return result[0] as any;
}
