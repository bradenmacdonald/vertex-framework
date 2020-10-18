import { Transaction } from "neo4j-driver";
import { pull, PullNoTx, pullOne, PullOneNoTx } from "./pull";
import { ReturnShape, query, TypedRecord, queryOne } from "./query";

/** A Neo4j Transaction with some TechNotes-specific convenience methods */
export interface WrappedTransaction extends Transaction {
    query<RS extends ReturnShape>(
        cypherQuery: Parameters<typeof query>[0],
        args: Parameters<typeof query>[1],
        returnShape: RS,
    ): Promise<TypedRecord<RS>[]>;

    queryOne<RS extends ReturnShape>(
        cypherQuery: Parameters<typeof query>[0],
        args: Parameters<typeof query>[1],
        returnShape: RS,
    ): Promise<TypedRecord<RS>>;

    pull: PullNoTx;
    
    pullOne: PullOneNoTx;
}

/** Wrap a Neo4j Transaction with some convenience methods. */
export function wrapTransaction(tx: Transaction): WrappedTransaction {
    const mutableTx: any = tx;
    mutableTx.query = (a: any, b: any, c: any) => query(a, b, c, tx);
    mutableTx.queryOne = (a: any, b: any, c: any) => queryOne(a, b, c, tx);
    mutableTx.pull = (a: any, b: any, c: any) => pull(tx as any, a, b, c);
    mutableTx.pullOne = (a: any, b: any, c: any) => pullOne(tx as any, a, b, c);
    return mutableTx;
}
