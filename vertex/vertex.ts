import neo4j, { Transaction, Driver } from "neo4j-driver";
import { ActionData, ActionResult } from "./action";
import { runAction } from "./action-runner";
import { UUID } from "./lib/uuid";
import { DataRequest, DataRequestFilter, DataResult, pull } from "./pull";
import { migrations as coreMigrations, SYSTEM_UUID } from "./schema";
import { WrappedTransaction, wrapTransaction } from "./transaction";
import { Migration, VertexCore } from "./vertex-interface";
import { VNodeType } from "./vnode";

export interface InitArgs {
    neo4jUrl: string; // e.g. "bolt://neo4j"
    neo4jUser: string; // e.g. "neo4j",
    neo4jPassword: string;
    debugLogging?: boolean;
    extraMigrations: {[name: string]: Migration};
}

export class Vertex implements VertexCore {
    private readonly driver: Driver;
    public readonly migrations: {[name: string]: Migration};

    constructor(config: InitArgs) {
        this.driver = neo4j.driver(
            config.neo4jUrl,
            neo4j.auth.basic(config.neo4jUser, config.neo4jPassword),
            { disableLosslessIntegers: true },
        );
        this.migrations = {...coreMigrations, ...config.extraMigrations};
    }

    /** Await this when your application prepares to shut down */
    public async shutdown(): Promise<void> {
        return this.driver.close();
    }

    /**
     * Create a database read transaction, for reading data from the graph DB.
     */
    public async read<T>(code: (tx: WrappedTransaction) => Promise<T>): Promise<T> {
        const session = this.driver.session({defaultAccessMode: "READ"});
        let result: T;
        try {
            result = await session.readTransaction(tx => code(wrapTransaction(tx)));
        } finally {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            session.close();
        }
        return result;
    }

    /**
     * Read data from the graph, outside of a transaction
     */
    public async pull<Request extends DataRequest<any, any>>(
        request: Request,
        filter: DataRequestFilter = {}
    ): Promise<DataResult<Request>[]> {
        return this.read(tx => tx.pull<Request>(request, filter));
    }

    /**
     * Read data from the graph, outside of a transaction
     */
    public async pullOne<Request extends DataRequest<any, any>>(
        request: Request,
        filter: DataRequestFilter = {}
    ): Promise<DataResult<Request>> {
        return this.read(tx => tx.pullOne<Request>(request, filter));
    }

    /**
     * Run an action (or multiple actions) as the specified user.
     * Returns the result of the last action specified.
     * @param userUuid The UUID of the user running the action
     * @param action The action to run
     * @param otherActions Additional actions to run, if desired.
     */
    public async runAs<T extends ActionData>(userUuid: UUID, action: T, ...otherActions: T[]): Promise<ActionResult<T>> {
        let result: ActionResult<T> = await runAction(this, action, userUuid);
        for (const action of otherActions) {
            result = await runAction(this, action, userUuid);
        }
        return result;
    }

    /**
     * Run an action (or multiple actions) as the "system user".
     * Returns the result of the last action specified.
     * @param action The action to run
     * @param otherActions Additional actions to run, if desired.
     */
    public async runAsSystem<T extends ActionData>(action: T, ...otherActions: T[]): Promise<ActionResult<T>> {
        return this.runAs(SYSTEM_UUID, action, ...otherActions);
    }

    /**
     * Create a database write transaction, for reading and/or writing
     * data to the graph DB. This should only be used from within a schema migration or by action-runner.ts, because
     * writes to the database should only happen via Actions.
     */
    public async _restrictedWrite<T>(code: (tx: WrappedTransaction) => Promise<T>): Promise<T> {
        const session = this.driver.session({defaultAccessMode: "WRITE"});
        let result: T;
        try {
            result = await session.writeTransaction(tx => code(wrapTransaction(tx)));
        } finally {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            session.close();
        }
        return result;
    }
}
