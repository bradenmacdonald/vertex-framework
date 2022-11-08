// deno-lint-ignore-file no-explicit-any
import { Neo4j } from "./deps.ts";
import { VNID } from "./lib/types/vnid.ts";
import { RelationshipDeclaration } from "./layer2/vnode-base.ts";

import type { CypherQuery, QueryResponse } from "./layer2/cypher-sugar.ts";
import { query, queryOne } from "./layer2/query.ts";
import { OneRelationshipSpec, RelationshipSpec, updateToManyRelationship, updateToOneRelationship } from "./layer4/action-helpers.ts";
import { pull, pullOne, PullNoTx, PullOneNoTx } from "./layer3/pull.ts";
import { VNodeType } from "./layer3/vnode.ts";
import { log } from "./lib/log.ts";

/** A data structure to keep track of the dbHits (performance measure) for all queries run */
export interface ProfileStats {
    dbHits: number;
    queryLogMode?: "compact"|"full";
}

/** A Neo4j Transaction with some Vertex Framework convenience methods */
export class WrappedTransaction {
    #tx: Neo4j.ManagedTransaction;

    public constructor(plainTx: Neo4j.ManagedTransaction, public readonly profile?: ProfileStats) {
        this.#tx = plainTx;
    }

    /**
     * Run a query on Neo4j and return the results unmodified, directly as given by the Neo4j JavaScript driver.
     * @param query The Cypher query string to run
     * @param parameters Optional query parameters.
     * @returns A Neo4j result (set of records)
     */
    public async run(query: string, parameters?: { [key: string]: any }): Promise<Neo4j.QueryResult> {
        const origQuery = query;
        if (this.profile) {
            // We want to measure dbHits stats for all queries exectuted:
            query = `PROFILE ` + query;
        }
        const result = await this.#tx.run(query, parameters ? fixParameterTypes(parameters) : undefined);
        if (this.profile && result.summary.profile) {
            let dbHits = 0;
            const addHits = (profileObj: Neo4j.ProfiledPlan) => { dbHits += profileObj.dbHits; profileObj.children.forEach(addHits); }
            addHits(result.summary.profile);
            this.profile.dbHits += dbHits;
            if (this.profile.queryLogMode) {
                const queryFormatted = this.profile.queryLogMode === "compact" ? origQuery.trim().replaceAll(/\s+/g, " ").substring(0, 100).padEnd(100, " ") : origQuery;
                log.info(`Neo4j query: ${queryFormatted} (${dbHits} dbHits)`);
            }
        }
        return result;
    }

    public query<CQ extends CypherQuery>(cypherQuery: CQ): Promise<QueryResponse<CQ>[]> {
        return query(cypherQuery, this);
    }

    public queryOne<CQ extends CypherQuery>(cypherQuery: CQ): Promise<QueryResponse<CQ>> {
        return queryOne(cypherQuery, this);
    }

    public pull: PullNoTx = ((a: any, b: any, c: any) => { return pull(this, a, b, c); }) as any;
    
    public pullOne: PullOneNoTx = ((a: any, b: any, c: any) => pullOne(this, a, b, c)) as any;

    public updateToOneRelationship<VNR extends RelationshipDeclaration>(args: {
        from: [vnt: VNodeType, id: VNID],
        rel: VNR,
        to: string|null|OneRelationshipSpec<VNR>,
    }): Promise<{prevTo: OneRelationshipSpec<VNR, VNID>}> {
        return updateToOneRelationship(this, args);
    }

    public updateToManyRelationship<VNR extends RelationshipDeclaration>(args: {
        from: [vnt: VNodeType, id: VNID],
        rel: VNR,
        to: RelationshipSpec<VNR>[],
    }): Promise<{prevTo: RelationshipSpec<VNR, VNID>[]}> {
        return updateToManyRelationship(this, args);
    }
}


/**
 * Vertex Framework uses the native JavaScript "Date" type for DateTimes, but Neo4j won't accept it as a parameter. (It
 * will accept instances of our VDate class for dates without time parts though, since it subclasses the Neo4j Date
 * type).
 * 
 * This change makes database operations more consistent by allowing the use of "Date" objects in parameters.
 * @param parameters 
 */
function fixParameterTypes(parameters: { [key: string]: any }): { [key: string]: any } {

    const fixValue = (value: any): any => {
        if (value instanceof Date) {
            // Convert this standard Date instance to the Neo4j DateTime format:
            return Neo4j.DateTime.fromStandardDate(value);
        } else if (Neo4j.isDate(value)) {
            // This is a VDate or a Neo4jDate, either will work.
            return value;
        } else if (Array.isArray(value)) {
            // Recursively convert this array:
            return value.map(v => fixValue(v));
        } else if (typeof value === "object" && value !== null) {
            // Recursively convert this map:
            return Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, fixValue(v)])
            );
        } else {
            // This value is not something we need to change.
            return value;
        }
    }

    return fixValue(parameters);
}
