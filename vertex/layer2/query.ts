import { Transaction } from "neo4j-driver";
import { convertNeo4jRecord } from "./cypher-return-shape";
import { CypherQuery, CypherQueryWithReturnShape, QueryResponse } from "./cypher-sugar";

/**
 * Run a query on the Neo4j graph database and return its result.
 * Unlike tx.run(), this method will return a typed result set
 * @param cypherQuery The cypher query to run
 * @param tx The transaction to run the query in
 */
export async function query<CQ extends CypherQuery>(cypherQuery: CQ, tx: Transaction): Promise<QueryResponse<CQ>[]> {
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
export async function queryOne<CQ extends CypherQuery>(cypherQuery: CQ, tx: Transaction): Promise<QueryResponse<CQ>> {
    const result = await query(cypherQuery, tx);
    if (result.length !== 1) {
        throw new Error(`Expected a single result, got ${result.length}`);
    }
    return result[0] as any;
}
