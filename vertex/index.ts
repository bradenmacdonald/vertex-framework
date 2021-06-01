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
    GenericSchema,
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

export {
    AnyDataRequest,
    BaseDataRequest,
    RequestVNodeRawProperties,
    getRequestedRawProperties,
} from "./layer2/data-request";

//// Layer 3 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    VirtualManyRelationshipProperty,
    VirtualOneRelationshipProperty,
    VirtualCypherExpressionProperty,
    VirtualPropType,
    VirtualPropertyDefinition,
    VirtualPropsSchema,
} from "./layer3/virtual-props";

export {
    DerivedProperty,
    DerivedPropertyFactory,
} from "./layer3/derived-props";

export {
    VNodeType,
    isVNodeType,
    getVNodeType,
} from "./layer3/vnode";

export {
    DataRequestFilter,
} from "./layer3/data-request-filtered";

export {
    newDataRequest,
    subclassDataRequest,
} from "./layer3/pull";

//// Layer 4 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    Action,
    ActionRequest,
    ActionDefinition,
    ActionResult,
    defineAction,
} from "./layer4/action";

export {
    defaultCreateFor,
    defaultDeleteFor,
    defaultUpdateFor,
} from "./layer4/action-templates";

export {
    GenericCypherAction,
    UndoAction,
} from "./layer4/action-generic";

export {
    getActionChanges,
    ActionChangeSet,
} from "./layer4/action-changes";

export {
    SYSTEM_VNID
} from "./layer4/schema";

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
