/**
 * Public API for the Vertex Framework
 * 
 * Applications using this framework shouldn't import from outside of this file.
 */

//// Lib ///////////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    UUID,
} from "./lib/uuid";

//// Layer 1 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

// "Layer 1" is conceptually regular Neo4j functions, like tx.run()
// Nothing specific is exported here.

//// Layer 2 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    C,
    CypherQuery,
} from "./layer2/cypher-sugar";

export {
    ReturnShape,
    TypedResult
} from "./layer2/cypher-return-shape";
 
export {
    PropSchema,
    PropertyDataType,
    InvalidNodeLabel,
    PublicValidationError,
    RawVNode,
    ShortIdProperty,
    UuidProperty,
    // BaseVNodeType - internal use only: we use VNodeType (from layer 4) in its place
    VNodeRelationship,
    ValidationError,
    getVNodeType,
    //isBaseVNodeType - internal use only
    registerVNodeType,
} from "./layer2/vnode-base";

export {
    VNodeTypeRef,
} from "./layer2/vnode-ref";

//// Layer 3 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    BaseDataRequest,
    RequestVNodeRawProperties,
    getRequestedRawProperties,
} from "./layer3/data-request";

export {
    // Action: we use ActionWithVirtualProperties (from layer 4) in its place
    ActionData,
    ActionImplementation,
    ActionResult,
    ActionType,
    defineAction,
} from "./layer3/action";

export {
    defaultCreateFor,
    defaultDeleteAndUnDeleteFor,
    defaultUpdateActionFor,
    updateToOneRelationship,
} from "./layer3/action-templates";

export {
    SYSTEM_UUID
} from "./layer3/schema";

//// Layer 4 ///////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    ActionWithVirtualProperties as Action,
} from "./layer4/action";

export {
    VirtualManyRelationshipProperty,
    VirtualOneRelationshipProperty,
    VirtualCypherExpressionProperty,
    VirtualPropType,
    VirtualPropertyDefinition,
    VirtualPropsSchema,
} from "./layer4/virtual-props";

export {
    DerivedPropertyFactory,
} from "./layer4/derived-props";


export {
    VNodeType,
    isVNodeType,
} from "./layer4/vnode";

export {
    DataRequestFilter,
    buildCypherQuery,
} from "./layer4/pull";

//// High Level ////////////////////////////////////////////////////////////////////////////////////////////////////////

export {
    WrappedTransaction,
} from "./transaction";

export {
    Vertex,
} from "./vertex";
