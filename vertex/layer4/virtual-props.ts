import type { CypherQuery } from "../layer2/cypher-sugar";
import type { FieldType } from "../layer2/cypher-return-shape";
import { VNodeRelationship } from "../layer2/vnode-base";
import { VNodeTypeWithVirtualProps } from "./vnode";
/**
 * Every VNode can declare "virtual properties" which are computed properties
 * (such as related VNodes) that can be loaded from the graph or other sources.
 * For example, a "User" node could have "age" (now() - dateOfBirth) or "friends"
 * (list of related User nodes) as virtual properties.
 */
export interface VirtualPropsSchema {
    [K: string]: VirtualPropertyDefinition,
}

export const VirtualPropType = {
    // What type of virtual property this is. Note this can't be a const enum, because doing so breaks useful type
    // inference unless it's always explicitly used as "VirtualPropType.ManyRelationship as const", which is annoying.
    ManyRelationship: "many-relationship" as const,
    OneRelationship: "one-relationship" as const,
    CypherExpression: "cypher-expression" as const,
}

export interface VirtualManyRelationshipProperty {
    type: typeof VirtualPropType.ManyRelationship;
    query: CypherQuery;
    target: VNodeTypeWithVirtualProps;
    // One of the relationships in the query can be assigned to the variable @rel, and if so, specify its props here so
    // that the relationship properties can be optionally included (as part of the target node)
    relationship?: VNodeRelationship,
    // How should this relationship be ordered by default, if not by the default ordering of the target VNode?
    // Should be a cypher expression that can reference fields on @this, @target, or @rel (if @rel is used in the query)
    defaultOrderBy?: string,
}
export interface VirtualOneRelationshipProperty {
    type: typeof VirtualPropType.OneRelationship,
    query: CypherQuery,
    target: VNodeTypeWithVirtualProps;
}
export interface VirtualCypherExpressionProperty {
    type: typeof VirtualPropType.CypherExpression,
    cypherExpression: CypherQuery,
    valueType: FieldType,
}

export type VirtualPropertyDefinition = (
    |VirtualManyRelationshipProperty
    |VirtualOneRelationshipProperty
    |VirtualCypherExpressionProperty
);
