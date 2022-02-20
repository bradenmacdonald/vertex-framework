import { VNID } from "../lib/types/vnid.ts";
import { CypherQuery } from "../layer2/cypher-sugar.ts";
import { defineAction } from "./action.ts";

/**
 * A generic action that can run arbitrary cypher, meant only for use in tests.
 */
export const GenericCypherAction = defineAction({
    type: `GenericCypherAction`,
    parameters: {} as {
        cypher: CypherQuery,
        modifiedNodes?: VNID[],
        description?: string,
    },
    apply: async (tx, data) => {
        await tx.query(data.cypher);
        return {
            resultData: {},
            modifiedNodes: data.modifiedNodes ?? [],
            description: data.description || `Generic action modified ${(data.modifiedNodes ?? []).length} VNode(s)`,
        };
    },
});
