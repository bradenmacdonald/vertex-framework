/**
 * Public API for the Vertex Framework
 * 
 * Applications using this framework shouldn't import from outside of this file.
 */

//// Lib ///////////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    VDate,
    VD,
} from "./lib/types/vdate";

export {
    VNID,
    isVNID,
} from "./lib/types/vnid";

export {
    SlugId,
    VNodeKey,
} from "./lib/key";

//// Layer 1 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

// "Layer 1" is conceptually regular Neo4j functions, like tx.run()
// Nothing specific is exported here.

//// Layer 2 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    Field,
    TypedField,
    FieldType,
    ResponseFieldType,
    PropSchema,
    ResponseSchema,
    GetDataType,
    GetDataShape,
    validateValue,
    validatePropSchema,
    // Neo4j types:
    Node,
    Relationship,
    Path,
} from "./lib/types/field";

export {
    C,
    CypherQuery,
} from "./layer2/cypher-sugar";

export {
    InvalidNodeLabel,
    PublicValidationError,
    RawVNode,
    // BaseVNodeType - internal use only: we use VNodeType (from layer 4) in its place
    RelationshipDeclaration,
    ValidationError,
    //getVNodeType - redefined in layer 4
    //isBaseVNodeType - internal use only
} from "./layer2/vnode-base";

export {
    VNodeTypeRef,
} from "./layer2/vnode-ref";

//// Layer 3 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    AnyDataRequest,
    BaseDataRequest,
    RequestVNodeRawProperties,
    getRequestedRawProperties,
} from "./layer3/data-request";

export {
    Action,
    ActionData,
    ActionDefinition,
    ActionResult,
    defineAction,
} from "./layer3/action";

export {
    defaultCreateFor,
    defaultDeleteAndUnDeleteFor,
    defaultUpdateActionFor,
} from "./layer3/action-templates";

export {
    GenericCypherAction,
    UndoAction,
} from "./layer3/action-generic";

export {
    getActionChanges,
    ActionChangeSet,
} from "./layer3/action-changes";

export {
    SYSTEM_VNID
} from "./layer3/schema";

//// Layer 4 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    VirtualManyRelationshipProperty,
    VirtualOneRelationshipProperty,
    VirtualCypherExpressionProperty,
    VirtualPropType,
    VirtualPropertyDefinition,
    VirtualPropsSchema,
} from "./layer4/virtual-props";

export {
    DerivedProperty,
    DerivedPropertyFactory,
} from "./layer4/derived-props";

export {
    VNodeType,
    isVNodeType,
    getVNodeType,
} from "./layer4/vnode";

export {
    DataRequestFilter,
} from "./layer4/data-request-filtered";

export {
    newDataRequest,
    subclassDataRequest,
} from "./layer4/pull";

//// High Level ////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    WrappedTransaction,
} from "./transaction";

export {
    Vertex,
} from "./vertex";

export {
    VertexTestDataSnapshot
} from "./vertex-interface";
