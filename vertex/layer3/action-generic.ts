import { UUID } from "../lib/uuid";
import { CypherQuery } from "../layer2/cypher-sugar";
import { defineAction } from "./action";

/**
 * A generic action that can run arbitrary cypher, meant only for use in tests.
 * 
 * This cannot be inverted (is not undoable).
 */
export const GenericCypherAction = defineAction<{
    cypher: CypherQuery,
    produceResult?: (dbResult: any) => {resultData: any, modifiedNodes: UUID[]},
    modifiedNodes?: UUID[],
}, any>({
    type: `GenericCypherAction`,
    apply: async (tx, data) => {
        const dbResult = await tx.query(data.cypher);
        const {resultData, modifiedNodes} = data.produceResult ? data.produceResult(dbResult) : {resultData: {}, modifiedNodes: []};
        if (data.modifiedNodes) {
            modifiedNodes.push(...data.modifiedNodes);
        }
        return {resultData, modifiedNodes};
    },
    invert: (data, resultData) => null,
});
