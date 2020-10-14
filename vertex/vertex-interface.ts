import { Transaction } from "neo4j-driver";
import { WrappedTransaction } from "./transaction";

/**
 * Definition of the core methods of the Vertex class, so that we can avoid circular imports.
 * This isn't for use outside of the Vertex Framework implementation.
 */
export interface VertexCore {
    read<T>(code: (tx: WrappedTransaction) => Promise<T>): Promise<T>;
    _restrictedWrite<T>(code: (tx: WrappedTransaction) => Promise<T>): Promise<T>;

    readonly migrations: {[name: string]: Migration};
}

type dbWriteType = <T>(code: (tx: Transaction) => Promise<T>) => Promise<T>;
type declareModelType = (modelName: string, opts?: {shortId?: boolean}) => Promise<void>;

export interface Migration {
    forward: (dbWrite: dbWriteType, declareModel: declareModelType, removeModel: declareModelType) => Promise<any>;
    backward: (dbWrite: dbWriteType, declareModel: declareModelType, removeModel: declareModelType) => Promise<any>;
    dependsOn: string[];
}
