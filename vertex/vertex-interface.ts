import { WrappedTransaction } from "./transaction.ts";
import type { VNodeType } from "./layer3/vnode.ts";

/**
 * Definition of the core methods of the Vertex class, so that we can avoid circular imports.
 * This isn't for use outside of the Vertex Framework implementation.
 */
export interface VertexCore {
    read<T>(code: (tx: WrappedTransaction) => Promise<T>): Promise<T>;
    isTriggerInstalled(name: string): Promise<boolean>;
    _restrictedWrite<T>(code: (tx: WrappedTransaction) => Promise<T>): Promise<T>;
    _restrictedWrite(query: string | { text: string; parameters?: Record<string, unknown> }): Promise<void>;
    _restrictedAllowWritesWithoutAction<T>(someCode: () => Promise<T>): Promise<T>;

    registerVNodeType(vnt: VNodeType): void;
    registerVNodeTypes(vnts: VNodeType[]): void;
    unregisterVNodeType(vnt: VNodeType): void;
    getVNodeType(label: string): VNodeType;

    snapshotDataForTesting(): Promise<VertexTestDataSnapshot>;
    resetDBToSnapshot(snapshot: VertexTestDataSnapshot): Promise<void>;

    // Migration related code:
    readonly migrations: {[name: string]: Migration};
    getAppliedMigrationIds(): Promise<string[]>;
    runMigrations(): Promise<void>;
    reverseMigration(id: string): Promise<void>;
    reverseAllMigrations(): Promise<void>;
}

type dbWriteType = VertexCore["_restrictedWrite"];

export interface Migration {
    forward: (tx: dbWriteType) => Promise<unknown>;
    backward: (dbWrite: dbWriteType) => Promise<unknown>;
    dependsOn: string[];
}

export interface VertexTestDataSnapshot {
    cypherSnapshot: string;
}
