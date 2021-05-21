import neo4j, { Driver } from "neo4j-driver-lite";
import { ActionRequest, ActionResult } from "./layer4/action";
import { runAction } from "./layer4/action-runner";
import { log } from "./lib/log";
import { looksLikeVNID, VNID } from "./lib/types/vnid";
import { PullNoTx, PullOneNoTx } from "./layer3/pull";
import { migrations as coreMigrations } from "./layer2/schema";
import { migrations as actionMigrations, SYSTEM_VNID } from "./layer4/schema";
import { WrappedTransaction } from "./transaction";
import { Migration, VertexCore, VertexTestDataSnapshot } from "./vertex-interface";
import { VNodeKey } from "./lib/key";
import { C } from "./layer2/cypher-sugar";
import { Field } from "./lib/types/field";


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
            { useBigInt: true },
        );
        this.migrations = {...coreMigrations, ...actionMigrations, ...config.extraMigrations};
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
            result = await session.readTransaction(tx => code(new WrappedTransaction(tx)));
        } finally {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            session.close();
        }
        return result;
    }

    /**
     * Read data from the graph, outside of a transaction
     */
    pull: PullNoTx = (arg1: any, ...args: any[]) => this.read(tx => tx.pull(arg1, ...args)) as any;

    /**
     * Read data from the graph, outside of a transaction
     */
    pullOne: PullOneNoTx = (arg1: any, ...args: any[]) => this.read(tx => tx.pullOne(arg1, ...args)) as any;

    /**
     * Run an action (or multiple actions) as the specified user.
     * Returns the result of the first action specified.
     * @param userId The VNID of the user running the action
     * @param action The action to run
     * @param otherActions Additional actions to run, if desired.
     */
    public async runAs<T extends ActionRequest>(userId: VNID, action: T, ...otherActions: ActionRequest[]): Promise<ActionResult<T>> {
        const result: ActionResult<T> = await runAction(this, action, userId);
        for (const action of otherActions) {
            await runAction(this, action, userId);
        }
        return result;
    }

    /**
     * Run an action (or multiple actions) as the "system user".
     * Returns the result of the first action specified.
     * @param action The action to run
     * @param otherActions Additional actions to run, if desired.
     */
    public async runAsSystem<T extends ActionRequest>(action: T, ...otherActions: ActionRequest[]): Promise<ActionResult<T>> {
        return this.runAs(SYSTEM_VNID, action, ...otherActions);
    }

    /**
     * Given a VNode Key (either a VNID or a SlugId), convert it to a VNID.
     */
    public async vnidForKey(key: VNodeKey): Promise<VNID> {
        if (looksLikeVNID(key)) {
            return key;
        }
        return this.read(tx => tx.queryOne(C`MATCH (vn:VNode), vn HAS KEY ${key}`.RETURN({"vn.id": Field.VNID}))).then(result => result["vn.id"]);
    }

    /**
     * Create a database write transaction, for reading and/or writing
     * data to the graph DB. This should only be used from within a schema migration or by action-runner.ts, because
     * writes to the database should only happen via Actions.
     */
    public async _restrictedWrite<T>(code: (tx: WrappedTransaction) => Promise<T>): Promise<T> {
        // Normal flow: create a new write transaction
        const session = this.driver.session({defaultAccessMode: "WRITE"});
        let result: T;
        try {
            result = await session.writeTransaction(tx => code(new WrappedTransaction(tx)));
        } finally {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            session.close();
        }
        return result;
    }

    /**
     * Allow code to write to the database without the trackActionChanges trigger.
     *
     * Normally, for any write transaction, the trackActionChanges trigger will check that the
     * write was done alongside the creation of an "Action" node in the database; for schema migrations
     * we don't use Actions, so we need to pause the trigger during migrations or the trigger
     * will throw an exception and prevent the migration transactions from committing.
     */
    public async _restrictedAllowWritesWithoutAction(someCode: () => Promise<any>): Promise<void> {
        try {
            if (await this.isTriggerInstalled("trackActionChanges")) {
                await this._restrictedWrite(tx => tx.run(`CALL apoc.trigger.pause("trackActionChanges")`));
            }
            await someCode();
        } finally {
            // We must check again if the trigger is installed since someCode() may have changed it.
            if (await this.isTriggerInstalled("trackActionChanges")) {
                await this._restrictedWrite(tx => tx.run(`CALL apoc.trigger.resume("trackActionChanges")`));
            }
        }
    }

    /** Helper function to check if a trigger with the given name is installed in the Neo4j database */
    public async isTriggerInstalled(name: string): Promise<boolean> {
        // For some reason, this counts as a write operation?
        const triggers = await this._restrictedWrite(tx => tx.run(`CALL apoc.trigger.list() yield name`));
        return triggers.records.find(x => x.get("name") === name) !== undefined;
    }

    /**
     * Snapshot whatever data is in the graph database, so that after a test runs,
     * the database can be reset to this snapshot.
     * 
     * This is not very efficient and should only be used for testing, and only
     * to snapshot relatively small amounts of data (i.e. any data created by
     * your migrations and/or shared test fixtures.)
     *
     * This assumes that tests will not attempt any schema changes, which
     * should never be done outside of migrations anyways.
     */
    public async snapshotDataForTesting(): Promise<VertexTestDataSnapshot> {
        const result = await this.read(tx => tx.run(`CALL apoc.export.cypher.all(null, {format: "plain"}) YIELD cypherStatements`));
        let cypherSnapshot: string = result.records[0].get("cypherStatements");
        // We only want the data, not the schema, which is fixed:
        cypherSnapshot = cypherSnapshot.replace(/CREATE CONSTRAINT[^;]+;/g, "");
        cypherSnapshot = cypherSnapshot.replace(/CREATE INDEX[^;]+;/g, "");
        cypherSnapshot = cypherSnapshot.replace(/DROP CONSTRAINT[^;]+;/g, "");
        return {cypherSnapshot};
    }

    /**
     * Reset the graph database to the specified snapshot. This should only be used
     * for tests. This should be called after each test case, not before, or otherwise
     * the last test that runs will leave its data in the database.
     */
    public async resetDBToSnapshot(snapshot: VertexTestDataSnapshot): Promise<void> {
        await await this._restrictedAllowWritesWithoutAction(async () => {
            // Disable the slugId auto-creation trigger since it'll conflict with the SlugId nodes already in the data snapshot
            await this._restrictedWrite(async tx => {
                await tx.run(`CALL apoc.trigger.pause("createSlugIdRelation")`);
            });
            try {
                await this._restrictedWrite(async tx => {
                    await tx.run(`MATCH (n) DETACH DELETE n`);
                    // For some annoying reason, this silently fails:
                    //  await tx.run(`CALL apoc.cypher.runMany($cypher, {})`, {cypher: snapshot.cypherSnapshot});
                    // So we have to split up the statements ourselves and run each one via tx.run()
                    for (const statement of snapshot.cypherSnapshot.split(";\n")) {
                        if (statement.trim() === "") {
                            continue;
                        }
                        // log.warn(statement);
                        await tx.run(statement);
                    }
                });
            } finally {
                await this._restrictedWrite(async tx => {
                    await tx.run(`CALL apoc.trigger.resume("createSlugIdRelation")`);
                });
            }
        });
    }

    /**
     * Get an ordered list of the migration IDs that have been applied to this database already,
     * possibly including unknown migrations (from other git branches, etc.)
     */
    public async getAppliedMigrationIds(): Promise<string[]> {
        const dbResult = await this.read(tx => tx.run("MATCH (m:Migration) RETURN m.id"));
        // Get an un-ordered set of applied migrations, including some which may no longer exist in the "migrations" global
        const appliedIdSet = new Set(dbResult.records.map(record => record.get("m.id")));
        const result: string[] = [];
        // Build "result" by removing IDs from appliedIdSet in order:
        for (const migrationId in this.migrations) {
            if (appliedIdSet.delete(migrationId)) {
                result.push(migrationId);
            }
        }
        // Are there any migration IDs in the database but not in the 'migrations' global?
        appliedIdSet.forEach(unknonwId => { result.push(unknonwId); })
        return result;
    }

    public async runMigrations(): Promise<void> {
        const appliedMigrationIds = new Set(await this.getAppliedMigrationIds());
        const dbWrite = this._restrictedWrite.bind(this);
        for (const migrationId in this.migrations) {
            if (appliedMigrationIds.has(migrationId)) {
                log.debug(`"${migrationId}" is already applied.`);
            } else {
                const migration = this.migrations[migrationId];
                // Check dependencies
                migration.dependsOn.forEach(depId => {
                    if (!appliedMigrationIds.has(depId)) {
                        throw new Error(`Unable to apply migration "${migrationId}": depends on "${depId}" which is not applied.`);
                    }
                });
                // Apply the migration
                log(`Applying migration "${migrationId}"`);
                await this._restrictedAllowWritesWithoutAction(async () => {
                    await migration.forward(dbWrite);
                    await dbWrite(tx =>
                        tx.run(`
                            CREATE (m:Migration {id: $migrationId})
                            WITH m as m2
                            MATCH (deps:Migration) WHERE deps.id IN $dependsOn
                            CREATE (m2)-[:DEPENDS_ON]->(deps)
                        `, {migrationId, dependsOn: migration.dependsOn})
                    );
                });
                appliedMigrationIds.add(migrationId);
            }
        }
        log.success("Migrations applied.");
    }

    public async reverseMigration(id: string): Promise<void> {
        const dbWrite = this._restrictedWrite.bind(this);
        const migration: Migration = this.migrations[id];
        if (migration === undefined) {
            throw new Error(`Unknown migration: "${id}"`);
        }
        // Do any migrations currently in the database depend on this one?
        const blockers = await this.read(tx => tx.run(`MATCH(b:Migration)-[:DEPENDS_ON]->(m:Migration {id: $id}) RETURN b`, {id, }));
        if (blockers.records.length > 0) {
            throw new Error(`Cannot reverse migration "${id}": another migration, ${blockers.records[0].get("id")} depends on it.`);
        }
        // Reverse the migration
        log(`Reversing migration "${id}"`);
        await this._restrictedAllowWritesWithoutAction(async () => {
            await migration.backward(dbWrite);
            await dbWrite(tx => tx.run(`MATCH (m:Migration {id: $id}) DETACH DELETE m`, {id, }));
        });
    }


    public async reverseAllMigrations(): Promise<void> {
        // Get the applied migration IDs in reverse order.
        // Any "orphaned" migrations (in the DB but not defined in code) will now be listed first.
        const appliedMigrationIds = (await this.getAppliedMigrationIds()).reverse();
        log.debug(`Removing applied migrations: ${appliedMigrationIds}`);
        for (const id of appliedMigrationIds) {
            const migration = this.migrations[id];
            if (migration === undefined) {
                throw new Error(`Cannot reset migrations due to orphaned migration "${id}". Are you on the right git branch?`);
            }
            await this.reverseMigration(id);
        }
        log.success("Migrations reset.");
    }

}
