import { log } from "./lib/log";
import { VertexCore, Migration } from "./vertex-interface";


/** Helper function to check if a trigger with the given name is installed in the Neo4j database */
async function isTriggerInstalled(graph: VertexCore, name: string): Promise<boolean> {
    // For some reason, this counts as a write operation so won't work with dbRead()
    const triggers = await graph._restrictedWrite(tx => tx.run(`CALL apoc.trigger.list() yield name`));
    return triggers.records.find(x => x.get("name") === name) !== undefined;
}

/**
 * Declare a standard unique, auto-generated UUID schema, used by most TechNotes graph nodes.
 * @param tx The current Neo4j write transaction
 * @param modelName The label of the new model / node type
 */
async function declareModel(graph: VertexCore, modelName: string, opts: {shortId?: boolean} = {}): Promise<void> {
    const constraintName = modelName.toLowerCase() + "_uuid_uniq";
    await graph._restrictedWrite(async tx => {
        await tx.run(`CREATE CONSTRAINT ${constraintName} ON (m:${modelName}) ASSERT m.uuid IS UNIQUE`);
        if (opts.shortId) {
            const shortIdConstraintName = modelName.toLowerCase() + "_shortid_uniq";
            await tx.run(`CREATE CONSTRAINT ${shortIdConstraintName} ON (m:${modelName}) ASSERT m.shortId IS UNIQUE`)
        }
    });
    // The following gives each node an auto-generated UUID on creation:
    await graph._restrictedWrite(async tx => {
        await tx.run(`CALL apoc.uuid.install("${modelName}")`)
    });
}

/** Reverse of declareModel() */
async function removeModel(graph: VertexCore, modelName: string, opts: {shortId?: boolean} = {}): Promise<void> {
    const constraintName = modelName.toLowerCase() + "_uuid_uniq";
    await graph._restrictedWrite(tx => tx.run(`MATCH (s:ShortId)-[:IDENTIFIES]->(:${modelName}) DETACH DELETE s`));
    await graph._restrictedWrite(tx => tx.run(`MATCH (m:${modelName}) DETACH DELETE m`));
    await graph._restrictedWrite(tx => tx.run(`CALL apoc.uuid.remove("${modelName}")`));
    await graph._restrictedWrite(tx => tx.run(`DROP CONSTRAINT ${constraintName}`));
    if (opts.shortId) {
        const shortIdConstraintName = modelName.toLowerCase() + "_shortid_uniq";
        await graph._restrictedWrite(tx => tx.run(`DROP CONSTRAINT ${shortIdConstraintName}`));
    }
}

/**
 * Allow code to write to the database without the trackActionChanges trigger.
 *
 * Normally, for any write transaction, the trackActionChanges trigger will check that the
 * write was done alongside the creation of an "Action" node in the database; for schema migrations
 * we don't use Actions, so we need to pause the trigger during migrations or the trigger
 * will throw an exception and prevent the migration transactions from committing.
 */
async function runWithoutAction(graph: VertexCore, someCode: () => Promise<any>): Promise<void> {
    try {
        if (await isTriggerInstalled(graph, "trackActionChanges")) {
            log.debug("Trigger is installed - pausing");
            await graph._restrictedWrite(tx => tx.run(`CALL apoc.trigger.pause("trackActionChanges")`));
        } else {
            log.debug("Trigger is not installed");
        }
        await someCode();
    } finally {
        // We must check again if the trigger is installed since someCode() may have changed it.
        if (await isTriggerInstalled(graph, "trackActionChanges")) {
            log.debug("Resuming trigger");
            await graph._restrictedWrite(tx => tx.run(`CALL apoc.trigger.resume("trackActionChanges")`));
        }
    }
}



/**
 * Get an ordered list of the migration IDs that have been applied to this database already,
 * possibly including unknown migrations (from other git branches, etc.)
 */
export async function getAppliedMigrationIds(graph: VertexCore): Promise<string[]> {
    const dbResult = await graph.read(tx => tx.run("MATCH (m:Migration) RETURN m.id"));
    // Get an un-ordered set of applied migrations, including some which may no longer exist in the "migrations" global
    const appliedIdSet = new Set(dbResult.records.map(record => record.get("m.id")));
    const result: string[] = [];
    // Build "result" by removing IDs from appliedIdSet in order:
    for (const migrationId in graph.migrations) {
        if (appliedIdSet.delete(migrationId)) {
            result.push(migrationId);
        }
    }
    // Are there any migration IDs in the database but not in the 'migrations' global?
    appliedIdSet.forEach(unknonwId => { result.push(unknonwId); })
    return result;
}

export async function runMigrations(graph: VertexCore): Promise<void> {
    const appliedMigrationIds = new Set(await getAppliedMigrationIds(graph));
    for (const migrationId in graph.migrations) {
        if (appliedMigrationIds.has(migrationId)) {
            log.debug(`"${migrationId}" is already applied.`);
        } else {
            const migration = graph.migrations[migrationId];
            // Check dependencies
            migration.dependsOn.forEach(depId => {
                if (!appliedMigrationIds.has(depId)) {
                    throw new Error(`Unable to apply migration "${migrationId}": depends on "${depId}" which is not applied.`);
                }
            });
            // Apply the migration
            log(`Applying migration "${migrationId}"`);
            await runWithoutAction(graph, async () => {
                await migration.forward(graph._restrictedWrite.bind(graph), declareModel.bind(null, graph), removeModel.bind(null, graph));
                await graph._restrictedWrite(tx =>
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

export async function reverseMigration(graph: VertexCore, id: string): Promise<void> {
    const migration: Migration = graph.migrations[id];
    if (migration === undefined) {
        throw new Error(`Unknown migration: "${id}"`);
    }
    // Do any migrations currently in the database depend on this one?
    const blockers = await graph.read(tx => tx.run(`MATCH(b:Migration)-[:DEPENDS_ON]->(m:Migration {id: $id}) RETURN b`, {id, }));
    if (blockers.records.length > 0) {
        throw new Error(`Cannot reverse migration "${id}": another migration, ${blockers.records[0].get("id")} depends on it.`);
    }
    // Reverse the migration
    log(`Reversing migration "${id}"`);
    await runWithoutAction(graph, async () => {
        await migration.backward(graph._restrictedWrite.bind(graph), declareModel.bind(null, graph), removeModel.bind(null, graph));
        await graph._restrictedWrite(tx => tx.run(`MATCH (m:Migration {id: $id}) DETACH DELETE m`, {id, }));
    });
}


export async function reverseAllMigrations(graph: VertexCore): Promise<void> {
    // Get the applied migration IDs in reverse order.
    // Any "orphaned" migrations (in the DB but not defined in code) will now be listed first.
    const appliedMigrationIds = (await getAppliedMigrationIds(graph)).reverse();
    log.debug(`Removing applied migrations: ${appliedMigrationIds}`);
    for (const id of appliedMigrationIds) {
        const migration = graph.migrations[id];
        if (migration === undefined) {
            throw new Error(`Cannot reset migrations due to orphaned migration "${id}". Are you on the right git branch?`);
        }
        await reverseMigration(graph, id);
    }
    log.success("Migrations reset.");
}
