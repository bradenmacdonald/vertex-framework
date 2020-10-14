import { Transaction } from "neo4j-driver";
import { DataRequest, DataRequestFilter, DataResult, pull, pullOne } from "./pull";
import { ReturnShapeType, query, TypedRecords, TypedRecord, queryOne } from "./query";

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

    pull<Request extends DataRequest<any, any>>(
        request: Request,
        filter?: DataRequestFilter,
    ): Promise<DataResult<Request>[]>;
    
    pullOne<Request extends DataRequest<any, any>>(
        request: Request,
        filter?: DataRequestFilter,
    ): Promise<DataResult<Request>>;
}

/** Wrap a Neo4j Transaction with some convenience methods. */
export function wrapTransaction(tx: Transaction): WrappedTransaction {
    const mutableTx: any = tx;
    mutableTx.query = (a: any, b: any, c: any) => query(a, b, c, tx);
    mutableTx.queryOne = (a: any, b: any, c: any) => queryOne(a, b, c, tx);
    mutableTx.pull = (a: any, b: any) => pull(tx as any, a, b);
    mutableTx.pullOne = (a: any, b: any) => pullOne(tx as any, a, b);
    return mutableTx;
}