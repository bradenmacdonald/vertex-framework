import { VNID, VNodeKey } from "./lib/key.ts";
import { WrappedTransaction } from "./transaction.ts";

/**
 * Definition of the core methods of the Vertex class, so that we can avoid circular imports.
 * This isn't for use outside of the Vertex Framework implementation.
 */
export interface VertexCore {
    read<T>(code: (tx: WrappedTransaction) => Promise<T>): Promise<T>;
    isTriggerInstalled(name: string): Promise<boolean>;
    _restrictedWrite<T>(code: (tx: WrappedTransaction) => Promise<T>): Promise<T>;
    _restrictedAllowWritesWithoutAction(someCode: () => Promise<any>): Promise<void>;
    vnidForKey(key: VNodeKey): Promise<VNID>;

    snapshotDataForTesting(): Promise<VertexTestDataSnapshot>;
    resetDBToSnapshot(snapshot: VertexTestDataSnapshot): Promise<void>;

    // Migration related code:
    readonly migrations: {[name: string]: Migration};
    getAppliedMigrationIds(): Promise<string[]>;
    runMigrations(): Promise<void>;
    reverseMigration(id: string): Promise<void>;
    reverseAllMigrations(): Promise<void>;
}

type dbWriteType = <T>(code: (tx: WrappedTransaction) => Promise<T>) => Promise<T>;

export interface Migration {
    forward: (dbWrite: dbWriteType) => Promise<any>;
    backward: (dbWrite: dbWriteType) => Promise<any>;
    dependsOn: string[];
}

export interface VertexTestDataSnapshot {
    cypherSnapshot: string;
}
