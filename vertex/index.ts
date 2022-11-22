/**
 * Public API for the Vertex Framework
 * 
 * Applications using this framework shouldn't import from outside of this file.
 */

//// Lib ///////////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    VDate,
    VD,
} from "./lib/types/vdate.ts";

export {
    VNID,
    isVNID,
} from "./lib/types/vnid.ts";

export {
    Field,
    FieldType,
    PropSchema,
    GenericSchema,
    ResponseSchema,
    validateValue,
    validatePropSchema,
    FieldValidationError,
    type TypedField,
    type ResponseFieldType,
    type GetDataType,
    type GetDataShape,
    // Neo4j types:
    type Node,
    type Relationship,
    type Path,
} from "./lib/types/field.ts";

//// Layer 1 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

// "Layer 1" is conceptually regular Neo4j functions, like tx.run()
// Nothing specific is exported here.

//// Layer 2 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    C,
    CypherQuery,
} from "./layer2/cypher-sugar.ts";

export {
    convertNeo4jFieldValue,
} from "./layer2/cypher-return-shape.ts";

export {
    InvalidNodeLabel,
    PublicValidationError,
    // BaseVNodeType - internal use only: we use VNodeType (from layer 3) in its place
    ValidationError,
    //isBaseVNodeType - internal use only
    getRelationshipType,
    type RawRelationships,
} from "./layer2/vnode-base.ts";
export type {
    RawVNode,
    RelationshipDeclaration,
} from "./layer2/vnode-base.ts";

export {
    VNodeTypeRef,
} from "./layer2/vnode-ref.ts";

export {
    getRequestedRawProperties
} from "./layer2/data-request.ts";
export type {
    AnyDataRequest,
    BaseDataRequest,
    RequestVNodeRawProperties
} from "./layer2/data-request.ts";
export {
    EmptyResultError,
    TooManyResultsError,
} from "./layer2/query.ts";

//// Layer 3 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    VirtualPropType
} from "./layer3/virtual-props.ts";
export type {
    VirtualManyRelationshipProperty,
    VirtualOneRelationshipProperty,
    VirtualCypherExpressionProperty,
    VirtualPropertyDefinition,
    VirtualPropsSchema
} from "./layer3/virtual-props.ts";

export {
    DerivedProperty,
    type DerivedPropertyFactory,
} from "./layer3/derived-props.ts";

export {
    VNodeType,
    isVNodeType,
} from "./layer3/vnode.ts";

export type {
    DataRequestFilter,
} from "./layer3/data-request-filtered.ts";

export {
    newDataRequest,
    subclassDataRequest,
} from "./layer3/pull.ts";

//// Layer 4 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    Action,
    type ActionRequest,
    type ActionDefinition,
    type ActionResult,
    defineAction,
} from "./layer4/action.ts";

export {
    defaultCreateFor,
    defaultDeleteFor,
    defaultUpdateFor,
} from "./layer4/action-templates.ts";

export {
    GenericCypherAction,
} from "./layer4/action-generic.ts";

export {
    SYSTEM_VNID
} from "./layer4/schema.ts";

//// High Level ////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    WrappedTransaction,
} from "./transaction.ts";

export {
    Vertex,
} from "./vertex.ts";

export type {
    VertexTestDataSnapshot
} from "./vertex-interface.ts";
