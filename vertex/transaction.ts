import type { Transaction } from "neo4j-driver";
import type { CypherQuery, QueryResponse } from "./layer2/cypher-sugar";
import type { PullNoTx, PullOneNoTx } from "./pull";

/** A Neo4j Transaction with some Vertex Framework convenience methods */
export interface WrappedTransaction extends Transaction {

    query<CQ extends CypherQuery>(cypherQuery: CQ): Promise<QueryResponse<CQ>[]>

    queryOne<CQ extends CypherQuery>(cypherQuery: CQ): Promise<QueryResponse<CQ>>

    pull: PullNoTx;
    
    pullOne: PullOneNoTx;
}
