/**
 * A standard data request (BaseDataRequest) only allows specifying raw properties of a VNode.
 * These mixins extend the standard data request, so that one can request "virtual properties" (like related nodes),
 *  _conditionally_ request raw properties, and other things.
 *
 * This file contains the actual implementations of the mixins, and a separate file contains their typings, which
 * are quite different.
 */

import { C } from "../layer2/cypher-sugar";
import { BaseDataRequest, MixinImplementation, DataRequestState } from "../layer3/data-request";
import { VirtualCypherExpressionProperty, VirtualManyRelationshipProperty, VirtualPropType } from "./virtual-props";
import { VNodeTypeWithVirtualProps } from "./vnode-with-virt-props";

///////////////// ConditionalRawPropsMixin /////////////////////////////////////////////////////////////////////////////

const condRawPropsMixinDataKey = "condRawPropsMixinDataKey";
/**
 * For a given data request, get the raw properties that are included conditionally (included only if a flag is set).
 * Returns an object where the keys are the properties' names and the values are the flag values (string).
 */
export function getConditionalRawPropsData(dataRequest: DataRequestState): { [propName: string]: string; } {
    return dataRequest.mixinData[condRawPropsMixinDataKey] ?? {};
}

export const conditionalRawPropsMixinImplementation: MixinImplementation = (dataRequest, methodName) => {
    if (methodName.endsWith("IfFlag")) {
        const propName = methodName.substr(0, methodName.length - 6);
        const propDefn = dataRequest.vnodeType.properties[propName];
        if (propDefn === undefined) {
            return undefined;
        }
        // The user wants to conditionally include the property propName/propDefn, based on a flag. Return a function to do that:
        return (flagName: string) => {
            const currentData = getConditionalRawPropsData(dataRequest);
            // Return the data request, but now with the property "propName" conditionally requested (so it will only
            // be retrieved if the flag "flagName" is specified when pulling the data from the graph database.)
            return dataRequest.cloneWithChanges({newMixinData: {
                [condRawPropsMixinDataKey]: {...currentData, [propName]: flagName},
            }})
        };
    }
    return undefined;
};

///////////////// VirtualPropsMixin ////////////////////////////////////////////////////////////////////////////////////

const virtPropsMixinDataKey = "virtPropsMixinDataKey";
const projectedVirtualPropsKey = "projectedVirtualProps";

interface VirtualPropRequest {
    ifFlag: string|undefined,  // <-- If set to a string, this virtual property is only to be included when a flag with that name is set (conditional inclusion)
    shapeData?: DataRequestState,
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
 * For a given data request, get the raw properties that are included conditionally (included only if a flag is set).
 * Returns an object where the keys are the properties' names and the values are the flag values (string).
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
            if (requestedVirtualProps[propKey] !== undefined) {
                throw new Error(`Virtual Property ${vnodeType}.${propKey} was requested multiple times in one data request, which is not supported.`);
            }
            if (virtualProp.type === VirtualPropType.ManyRelationship || virtualProp.type === VirtualPropType.OneRelationship) {
                // Return a method that can be used to build the request for this virtual property type
                const targetVNodeType = virtualProp.target;
                return (buildSubRequest: (subRequest: BaseDataRequest<typeof targetVNodeType, never, any>) => BaseDataRequest<typeof targetVNodeType, any, any>, options?: {ifFlag: string|undefined}) => {
                    // Build the subrequest immediately, using the supplied code:
                    let subRequestData = dataRequest.newRequestWithSameMixins(targetVNodeType); // An empty request - the buildSubRequest() will use it to pick which properties of the target type should be included.
                    if (virtualProp.type === VirtualPropType.ManyRelationship) {
                        // "Project" properties from the relationship onto the target VNode data request, so they can be optionally selected for inclusion:
                        const projectedRelationshipProps = virtualPropsForRelationship(virtualProp);
                        subRequestData = DataRequestState.getInternalState(subRequestData).cloneWithChanges({
                            newMixinData: { [projectedVirtualPropsKey]: projectedRelationshipProps },
                        });
                    }
                    const subRequest = buildSubRequest(subRequestData);
                    if (requestedVirtualProps[propKey] !== undefined) {
                        throw new Error(`Virtual Property ${vnodeType}.${propKey} was requested multiple times in one data request, which is not supported.`);
                    }
                    // Return the the new request, with this virtual property now included:
                    return requestWithVirtualPropAdded(dataRequest, propKey, {
                        ifFlag: options?.ifFlag,
                        shapeData: DataRequestState.getInternalState(subRequest),
                    });
                };
            } else if (virtualProp.type === VirtualPropType.CypherExpression) {
                return (options?: {ifFlag: string|undefined}) => {
                    // Return the the new request, with this virtual property now included:
                    return requestWithVirtualPropAdded(dataRequest, propKey, {ifFlag: options?.ifFlag});
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
            const joiValidator = virtualProp.relationship.properties[relationshipPropName];
            extraProps[relationshipPropName] = {
                type: VirtualPropType.CypherExpression,
                cypherExpression: C("@rel." + relationshipPropName),
                valueType: (
                    joiValidator.type === "string" ? "string" :
                    joiValidator.type === "boolean" ? "boolean" :
                    joiValidator.type === "number" ? "number" :
                    "any"
                ),
            };
        }
    }
    return extraProps;
}
