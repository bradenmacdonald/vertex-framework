/**
 * The core database Schema for a Vertex Framework application
 *
 * Labels used are:
 *  :Migration - tracks database schema and data migration history
 *  :VNode - label for all VNodes (basically all nodes involved in the Vertex Framework, except Migrations)
 *  :User:VNode - label for the User VNode type; must exist and be a VNode but details are up to the application
 */
import { Migration } from "../vertex-interface.ts";

export const migrations: Readonly<{[id: string]: Migration}> = Object.freeze({
    // ES6 objects preserve string key order, so these migrations don't need numbers, only string IDs.
    "_root": {
        dependsOn: [],
        // This is the root migration, which sets up the schema so we can track all other migrations.
        forward: (dbWrite) => dbWrite(tx =>
            tx.run("CREATE CONSTRAINT migration_id_uniq FOR (m:Migration) REQUIRE m.id IS UNIQUE")
        ),
        backward: (dbWrite) => dbWrite(tx =>
            tx.run("DROP CONSTRAINT migration_id_uniq IF EXISTS")
        ),
    },
    vnode: {
        dependsOn: ["_root"],
        forward: async (dbWrite) => {
            await dbWrite(async tx => {
                // We have the core label "VNode" which applies to all VNodes and enforces their VNID uniqueness
                await tx.run(`CREATE CONSTRAINT vnode_id_uniq FOR (v:VNode) REQUIRE v.id IS UNIQUE`);
            });
        },
        backward: async (dbWrite) => {
            await dbWrite(async tx => {
                await tx.run("DROP CONSTRAINT vnode_id_uniq IF EXISTS");
            });
            // Delete all nodes after the indexes have been removed (faster than doing so before):

            // await tx.run(`MATCH (v:VNode) DETACH DELETE v`);
            // The above query will run out of memory for large datasets, so use this iterative approach instead:
            // See https://neo4j.com/developer/kb/large-delete-transaction-best-practices-in-neo4j/
            await dbWrite(`CALL apoc.periodic.iterate("MATCH (n:VNode)  RETURN id(n) AS id", "MATCH (n) WHERE id(n) = id DETACH DELETE n", {batchSize: 100})`);
        },
    },
});
