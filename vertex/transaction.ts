import type { Result, Transaction } from "neo4j-driver";
import QueryRunner from "neo4j-driver/types/query-runner";
import { UUID, RelationshipDeclaration } from ".";

import type { CypherQuery, QueryResponse } from "./layer2/cypher-sugar";
import { query, queryOne } from "./layer2/query";
import { OneRelationshipSpec, RelationshipSpec, updateToManyRelationship, updateToOneRelationship } from "./layer3/action-helpers";
import { pull, pullOne, PullNoTx, PullOneNoTx } from "./layer4/pull";
import { VNodeType } from "./layer4/vnode";

/** A Neo4j Transaction with some Vertex Framework convenience methods */
export class WrappedTransaction implements QueryRunner {
    #tx: Transaction;

    public constructor(plainTx: Transaction) {
        this.#tx = plainTx;
    }

    public run(query: string, parameters?: { [key: string]: any }): Result {
        return this.#tx.run(query, parameters);
    }

    public query<CQ extends CypherQuery>(cypherQuery: CQ): Promise<QueryResponse<CQ>[]> {
        return query(cypherQuery, this.#tx);
    }

    public queryOne<CQ extends CypherQuery>(cypherQuery: CQ): Promise<QueryResponse<CQ>> {
        return queryOne(cypherQuery, this.#tx);
    }

    public pull: PullNoTx = ((a: any, b: any, c: any) => { return pull(this, a, b, c); }) as any;
    
    public pullOne: PullOneNoTx = ((a: any, b: any, c: any) => pullOne(this, a, b, c)) as any;

    public updateToOneRelationship<VNR extends RelationshipDeclaration>(args: {
        from: [vnt: VNodeType, uuid: UUID],
        rel: VNR,
        to: string|null|OneRelationshipSpec<VNR>,
    }): Promise<{prevTo: OneRelationshipSpec<VNR>}> {
        return updateToOneRelationship(this, args);
    }

    public updateToManyRelationship<VNR extends RelationshipDeclaration>(args: {
        from: [vnt: VNodeType, uuid: UUID],
        rel: VNR,
        to: RelationshipSpec<VNR>[],
    }): Promise<{prevTo: RelationshipSpec<VNR>[]}> {
        return updateToManyRelationship(this, args);
    }
}
