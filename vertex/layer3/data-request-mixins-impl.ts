/**
 * A standard data request (BaseDataRequest) only allows specifying raw properties of a VNode.
 * These mixins extend the standard data request, so that one can request "virtual properties" (like related nodes),
 *  _conditionally_ request raw properties, and other things.
 *
 * This file contains the actual implementations of the mixins, and a separate file contains their typings, which
 * are quite different.
 */

import { C } from "../layer2/cypher-sugar.ts";
import { BaseVNodeType } from "../layer2/vnode-base.ts";
import { BaseDataRequest, MixinImplementation, DataRequestState, AnyDataRequest } from "../layer2/data-request.ts";
import { DerivedProperty } from "./derived-props.ts";
import { VirtualCypherExpressionProperty, VirtualManyRelationshipProperty, VirtualPropType } from "./virtual-props.ts";
import { VNodeType, VNodeTypeWithVirtualProps } from "./vnode.ts";

/** The type of a function which adds some fields onto an existing (or empty) data request */
type RequestBuilderFn<VNT extends BaseVNodeType = any> = (existingRequest: BaseDataRequest<VNT, any, any>) => BaseDataRequest<VNT, any, any>;

///////////////// ConditionalRawPropsMixin /////////////////////////////////////////////////////////////////////////////

const condRawPropsMixinDataKey = "condRawPropsMixinDataKey";

export interface ConditionalRequest {
    /** If a flag with this name is set in the filter when pull()ing data from the graph... */
    flagName: string;
    /** Then include these additional requested raw properties / virtual properties / derived properties: */
    conditionalRequest: RequestBuilderFn;
}

/**
 * For a given data request, get the raw properties that are included conditionally (included only if a flag is set).
 * Returns an object where the keys are the properties' names and the values are the flag values (string).
 */
export function getConditionalRawPropsData(dataRequest: DataRequestState): ConditionalRequest[] {
    return dataRequest.mixinData[condRawPropsMixinDataKey] ?? [];
}

export const conditionalRawPropsMixinImplementation: MixinImplementation = (dataRequest, methodName) => {
    if (methodName === "if") {
        // The user wants to conditionally include some properties:
        return (flagName: string, conditionalRequest: RequestBuilderFn) => {
            const currentData = getConditionalRawPropsData(dataRequest);
            // Store the new state into the parent data request:
            return dataRequest.cloneWithChanges({newMixinData: {
                [condRawPropsMixinDataKey]: [...currentData, {flagName, conditionalRequest}],
            }})
        };
    }
    return undefined;
};

///////////////// VirtualPropsMixin ////////////////////////////////////////////////////////////////////////////////////

const virtPropsMixinDataKey = "virtPropsMixinDataKey";
const projectedVirtualPropsKey = "projectedVirtualProps";

interface VirtualPropRequest {
    subRequest?: AnyDataRequest<any>,
}

// Virtual properties (like related objects) to pull from the database, along with details such as what data to pull
// in turn for those VNodes
interface VirtualPropsMixinData {
    [propName: string]: VirtualPropRequest;
}
// Additional virtual properties currently available on this VNode, which may or may not be included in the request.
// These are coming from a relationship, e.g. "Role" in the movies example.
// If one of these additional virtual props should be included in the request, it will be in 
// requestedVirtualProps too.
interface ProjectedVirtualPropsData {
    [propName: string]: VirtualCypherExpressionProperty
}
/**
 * For a given data request, get the virtual properties that are included
 */
export function getVirtualPropsData(dataRequest: DataRequestState): VirtualPropsMixinData {
    return dataRequest.mixinData[virtPropsMixinDataKey] ?? {};
}
export function requestWithVirtualPropAdded(dataRequest: DataRequestState, propName: string, propRequest: VirtualPropRequest): any {
    const currentData = getVirtualPropsData(dataRequest);
    const newData: VirtualPropsMixinData = {
        ...currentData,
        [propName]: propRequest,
    };
    return dataRequest.cloneWithChanges({newMixinData: { [virtPropsMixinDataKey]: newData }});
}
/**
 * Get a map with the "projected" virtual properties available for this node, coming from a relationship.
 * See virtualPropsForRelationship() for details.
 */
export function getProjectedVirtualPropsData(dataRequest: DataRequestState): ProjectedVirtualPropsData {
    return dataRequest.mixinData[projectedVirtualPropsKey] ?? {};
}

/**
 * A user is building a data request, and they've call a method to potentially add a virtual property to the request.
 * For example, in pull(p => p.age()), the ".age()" is what triggers this code, where propKey would be "age", and the
 * user is wanting to add the virtual property "age" to the request "dataRequest"
 */
export const virtualPropsMixinImplementation: MixinImplementation = (dataRequest, propKey) => {
    if ((dataRequest.vnodeType as VNodeTypeWithVirtualProps).virtualProperties === undefined) {
        return undefined;
    }
    const vnodeType = dataRequest.vnodeType as VNodeTypeWithVirtualProps;
    const requestedVirtualProps = getVirtualPropsData(dataRequest);
    const projectedVirtualProperties = getProjectedVirtualPropsData(dataRequest);

    const virtualProp = vnodeType.virtualProperties[propKey] || projectedVirtualProperties[propKey];
        if (virtualProp !== undefined) {
            // Operation to add a virtual property to the request:
            if (virtualProp.type === VirtualPropType.ManyRelationship || virtualProp.type === VirtualPropType.OneRelationship) {
                // Return a method that can be used to build the request for this virtual property type
                const targetVNodeType = virtualProp.target as any as VNodeType;  // Typing of this is a bit weird, to allow the optional VNodeType.hasVirtualProperties() method to work without circular type issues.
                return (buildSubRequest: (subRequest: BaseDataRequest<typeof targetVNodeType, never, any>) => BaseDataRequest<typeof targetVNodeType, any, any>) => {
                    // Build the subrequest:

                    // If this virtual property has already been requested, build on that request; otherwise start with a blank request.
                    // buildSubRequest() will use this to pick which properties of the target type should be included.
                    let existingRequest = requestedVirtualProps[propKey]?.subRequest;
                    if (existingRequest === undefined) {
                        // Create a new blank data request for the target VNodeType:
                        existingRequest = dataRequest.newRequestWithSameMixins(targetVNodeType);
                        if (virtualProp.type === VirtualPropType.ManyRelationship) {
                            // "Project" properties from the relationship onto the target VNode data request, so they can be optionally selected for inclusion:
                            const projectedRelationshipProps = virtualPropsForRelationship(virtualProp);
                            existingRequest = DataRequestState.getInternalState(existingRequest).cloneWithChanges({
                                newMixinData: { [projectedVirtualPropsKey]: projectedRelationshipProps },
                            });
                        }
                    }

                    const subRequest = buildSubRequest(existingRequest);
                    // Return the new request, with this virtual property now included:
                    return requestWithVirtualPropAdded(dataRequest, propKey, { subRequest });
                };
            } else if (virtualProp.type === VirtualPropType.CypherExpression) {
                return () => {
                    return requestWithVirtualPropAdded(dataRequest, propKey, {});
                };
            } else {
                throw new Error(`That virtual property type (${(virtualProp as any).type}) is not supported yet.`);
            }
        }
    return undefined;
};

/**
 * With a -to-many Virtual Property, there may be some properties on the _relationship_ that connects the target VNode
 * to the current VNode. This function helps to "project" those relationship properties, making them available on the
 * target VNode when it's accessed via a virtual property that sets "relationshipProps".
 * 
 * In the movie example, this makes the "role" property available on Movie when accessed via the Person.movies.role
 * virtual property, even though there is normally no Movie.role property.
 * 
 * @param virtualProp The virtual property that may specify relationship props, via .relationshipProps
 */
function virtualPropsForRelationship(virtualProp: VirtualManyRelationshipProperty): {[propName: string]: VirtualCypherExpressionProperty} {
    const extraProps: {[propName: string]: VirtualCypherExpressionProperty} = {}
    if (virtualProp.relationship !== undefined) {
        // Add properties from the relationship to the target VNode data request, so they can be optionally selected for inclusion:
        for (const relationshipPropName in virtualProp.relationship.properties) {
            const propDeclaration = virtualProp.relationship.properties[relationshipPropName];
            extraProps[relationshipPropName] = {
                type: VirtualPropType.CypherExpression,
                cypherExpression: C("@rel." + relationshipPropName),
                valueType: propDeclaration,
            };
        }
    }
    return extraProps;
}


///////////////// DerivedPropsMixin ////////////////////////////////////////////////////////////////////////////////////

const derivedPropsMixinDataKey = "derivedPropsMixinDataKey";

// Derived properties (like related objects) to pull from the database
interface DerivedPropsMixinData {
    [propName: string]: true;
}

/**
 * For a given data request, get the raw properties that are included conditionally (included only if a flag is set).
 * Returns an object where the keys are the properties' names and the values are the flag values (string).
 */
export function getDerivedPropsData(dataRequest: DataRequestState): DerivedPropsMixinData {
    return dataRequest.mixinData[derivedPropsMixinDataKey] ?? {};
}
export function requestWithDerivedPropAdded(dataRequest: DataRequestState, propName: string): any {
    const currentData = getDerivedPropsData(dataRequest);
    const newData: DerivedPropsMixinData = {
        ...currentData,
        [propName]: true,
    };
    return dataRequest.cloneWithChanges({newMixinData: { [derivedPropsMixinDataKey]: newData }});
}

export const includeDependenciesFlag = Symbol("_includeDependencies");

/**
 * A user is building a data request, and they've call a method to potentially add a derived property to the request.
 * For example, in pull(p => p.age()), the ".age()" is what triggers this code, where propKey would be "age", and the
 * user is wanting to add the derived property "age" to the request "dataRequest"
 */
export const derivedPropsMixinImplementation: MixinImplementation = (dataRequest, propKey) => {
    const vnodeType = dataRequest.vnodeType as VNodeType;
    const derivedProp = vnodeType.derivedProperties[propKey];
    if (derivedProp === undefined) {
        return undefined;
    }

    // Operation to add a derived property to the request:
    return () => {
        // Construct the new request, with this derived property now included:
        const request = requestWithDerivedPropAdded(dataRequest, propKey);
        // And add in any dependencies required:
        if (!(derivedProp instanceof DerivedProperty)) {
            throw new Error(`Derived property ${vnodeType}.${propKey} is invalid - missing @VNodeType.declare ?`);
        }
        // The code in pull() needs to be able to tell which fields were explicitly requested, and which were requested
        // only for use by derived props, as dependencies. So we add those dependency fields conditionally, only when
        // the special includeDependenciesFlag is set.
        // (The special flag is a symbol to avoid attacks where applications pass query string params into filter.flags
        // and a dependent property contains sensitive information that shouldn't be returned by pull())
        return request.if(includeDependenciesFlag, (r: any) => derivedProp.dataSpec(r));
    };
};
