import { Transaction } from "neo4j-driver";
import { CypherQuery, QueryResponse } from "./layer2/cypher-sugar";
import { pull, PullNoTx, pullOne, PullOneNoTx } from "./pull";
import { query, queryOne } from "./layer2/query";

/** A Neo4j Transaction with some Vertex Framework convenience methods */
export interface WrappedTransaction extends Transaction {

    query<CQ extends CypherQuery>(cypherQuery: CQ): Promise<QueryResponse<CQ>[]>

    queryOne<CQ extends CypherQuery>(cypherQuery: CQ): Promise<QueryResponse<CQ>>

    pull: PullNoTx;
    
    pullOne: PullOneNoTx;
}

/** Wrap a Neo4j Transaction with some convenience methods. */
export function wrapTransaction(tx: Transaction): WrappedTransaction {
    const mutableTx: any = tx;
    mutableTx.query = (q: any) => query(q, tx);
    mutableTx.queryOne = (q: any) => queryOne(q, tx);
    mutableTx.pull = (a: any, b: any, c: any) => pull(tx as any, a, b, c);
    mutableTx.pullOne = (a: any, b: any, c: any) => pullOne(tx as any, a, b, c);
    return mutableTx;
}
