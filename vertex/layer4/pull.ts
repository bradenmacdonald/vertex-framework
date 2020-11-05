import Joi from "@hapi/joi";
import { log } from "../lib/log";
import {
    PropertyDataType,
    VNodeType,
    VNodeRelationship,
} from "../layer2/vnode";
import {
    VirtualManyRelationshipProperty,
    VirtualOneRelationshipProperty,
    VirtualCypherExpressionProperty,
    VirtualPropType,
} from "./virtual-props";
import type { WrappedTransaction } from "../transaction";
import type { ReturnTypeFor } from "../layer2/cypher-return-shape";
import { C, CypherQuery } from "../layer2/cypher-sugar";
import { VNodeTypeWithVirtualAndDerivedProps, VNodeTypeWithVirtualProps } from "./vnode-with-virt-props";

////////////////////////////// VNode Data Request format ////////////////////////////////////////////////////////////

/**
 * VNode Data Request: A tool to build a request for data from the database.
 *
 * A VNodeDataRequest can be used to specify exactly which VNodes, properties, and relationships should be loaded from
 * the database. You can specify that some properties should be loaded conditionally, only if a certain boolean "Flag"
 * is set when the request is executed.
 * 
 * Example:
 *     const request = (VNodeDataRequest(Person)
 *         .uuid
 *         .name
 *         .dateOfBirthIfFlag("includeDOB")
 *         .friends(f => f.uuid.name)
 *     );
 */
type VNodeDataRequest<
    VNT extends VNodeTypeWithVirtualProps,
    includedProperties extends keyof VNT["properties"] = never,
    flaggedProperties extends keyof VNT["properties"] = never,
    includedVirtualProperties extends RecursiveVirtualPropRequest<VNT> = {},  // eslint-disable-line @typescript-eslint/ban-types
> = (
    // Each VNodeDataRequest has a .allProps attribute which requests all raw (non-virtual) properties and returns the same request object
    VNDR_AddAllProps<VNT, includedProperties, flaggedProperties, includedVirtualProperties> &
    // For each raw property like "uuid", the data request has a .uuid attribute which requests that property and returns the same request object
    VNDR_AddRawProp<VNT, includedProperties, flaggedProperties, includedVirtualProperties> &
    // For each raw property like "uuid", the data request has a .uuidIfFlag() method which conditionally requests that property
    VNDR_AddFlags<VNT, includedProperties, flaggedProperties, includedVirtualProperties> &
    // For each virtual property of the VNodeType, there is a .propName(p => p...) method for requesting it.
    VNDR_AddVirtualProp<VNT, includedProperties, flaggedProperties, includedVirtualProperties> &
    // For each derived property of the VNodeType, there is a .propName() method for requesting it.
    // However, if the type system hints that this VNodeType extends {ignoreDerivedProps: true}, then we skip this,
    // which prevents circular type definition errors when defining derived properties, and also prevents derived props
    // from declaring a dependency on other derived props, which is not allowed.
    ( VNT extends {ignoreDerivedProps: true} ? any : VNDR_AddDerivedProp<VNT, includedProperties, flaggedProperties, includedVirtualProperties> )
);

/** Each VNodeDataRequest has a .allProps attribute which requests all raw properties and returns the same request object */
type VNDR_AddAllProps<
    VNT extends VNodeTypeWithVirtualProps,
    includedProperties extends keyof VNT["properties"],
    flaggedProperties extends keyof VNT["properties"],
    includedVirtualProperties extends RecursiveVirtualPropRequest<VNT>,
> = {
    allProps: VNodeDataRequest<VNT, keyof VNT["properties"], flaggedProperties, includedVirtualProperties>
};

/** For each raw property like "uuid", the data request has a .uuid attribute which requests that property and returns the same request object */
type VNDR_AddRawProp<
    VNT extends VNodeTypeWithVirtualProps,
    includedProperties extends keyof VNT["properties"],
    flaggedProperties extends keyof VNT["properties"],
    includedVirtualProperties extends RecursiveVirtualPropRequest<VNT>,
> = {
    [K in keyof VNT["properties"]/* as Exclude<K, includedProperties|flaggedProperties>*/]: VNodeDataRequest<VNT, includedProperties|K, flaggedProperties, includedVirtualProperties>
};

/** For each raw property like "uuid", the data request has a .uuidIfFlag() method which conditionally requests that property */
type VNDR_AddFlags<
    VNT extends VNodeTypeWithVirtualProps,
    includedProperties extends keyof VNT["properties"],
    flaggedProperties extends keyof VNT["properties"],
    includedVirtualProperties extends RecursiveVirtualPropRequest<VNT>,
> = {
    [K in keyof VNT["properties"] as K extends string ? `${K}IfFlag` : never]: (flagName: string) => VNodeDataRequest<VNT, includedProperties, flaggedProperties|K, includedVirtualProperties>
};

/** For each virtual property of the VNodeType, there is a .propName(p => p...) method for requesting it. */
type VNDR_AddVirtualProp<
    VNT extends VNodeTypeWithVirtualProps,
    includedProperties extends keyof VNT["properties"],
    flaggedProperties extends keyof VNT["properties"],
    includedVirtualProperties extends RecursiveVirtualPropRequest<VNT>,
> = {
    [K in keyof VNT["virtualProperties"]]: (

        VNT["virtualProperties"][K] extends VirtualManyRelationshipProperty ?
            // For each x:many virtual property, add a method for requesting that virtual property:
            <SubSpec extends VNodeDataRequest<VNT["virtualProperties"][K]["target"]>, FlagType extends string|undefined = undefined>
            // This is the method:
            (subRequest: (
                buildSubequest: VNodeDataRequest<VNT["virtualProperties"][K]["target"] & ProjectRelationshipProps<VNT["virtualProperties"][K]["relationship"]>>) => SubSpec,
                options?: {ifFlag?: FlagType}
            )
            // The return value of the method is the same VNodeDataRequest, with the additional virtual property added in:
            => VNodeDataRequest<VNT, includedProperties, flaggedProperties, includedVirtualProperties&{[K2 in K]: {ifFlag: FlagType, spec: SubSpec, type: "many"}}>

        : VNT["virtualProperties"][K] extends VirtualOneRelationshipProperty ?
            // For each x:one virtual property, add a method for requesting that virtual property:
            <SubSpec extends VNodeDataRequest<VNT["virtualProperties"][K]["target"]>, FlagType extends string|undefined = undefined>
            (subRequest: (buildSubequest: VNodeDataRequest<VNT["virtualProperties"][K]["target"]>) => SubSpec, options?: {ifFlag: FlagType})
            => VNodeDataRequest<VNT, includedProperties, flaggedProperties, includedVirtualProperties&{[K2 in K]: {ifFlag: FlagType, spec: SubSpec, type: "one"}}>

        : VNT["virtualProperties"][K] extends VirtualCypherExpressionProperty ?
            // Add a method to include this [virtual property based on a cypher expression], optionally toggled via a flag:
            <FlagType extends string|undefined = undefined>(options?: {ifFlag: FlagType})
            => VNodeDataRequest<VNT, includedProperties, flaggedProperties, includedVirtualProperties&{[K2 in K]: {ifFlag: FlagType, type: "cypher", propertyDefinition: VNT["virtualProperties"][K]}}>

        : never
    )
};

/** For each derived property of the VNodeType, there is a .propName(p => p...) method for requesting it. */
type VNDR_AddDerivedProp<
    VNT extends VNodeTypeWithVirtualProps,
    includedProperties extends keyof VNT["properties"],
    flaggedProperties extends keyof VNT["properties"],
    includedVirtualProperties extends RecursiveVirtualPropRequest<VNT>,
> = (
    VNT extends VNodeTypeWithVirtualAndDerivedProps ? {
        // Method to add each derived property to the data request:
        [K in keyof VNT["derivedProperties"]]: () => VNodeDataRequest<VNT, includedProperties, flaggedProperties, includedVirtualProperties>
    } : never
);

/** Type data about virtual properties that have been requested so far in a VNodeDataRequest */
type RecursiveVirtualPropRequest<VNT extends VNodeTypeWithVirtualProps> = {
    [K in keyof VNT["virtualProperties"]]?: (
        VNT["virtualProperties"][K] extends VirtualManyRelationshipProperty ?
            IncludedVirtualManyProp<VNT["virtualProperties"][K], any> :
        VNT["virtualProperties"][K] extends VirtualOneRelationshipProperty ?
            IncludedVirtualOneProp<VNT["virtualProperties"][K], any> :
        VNT["virtualProperties"][K] extends VirtualCypherExpressionProperty ?
            IncludedVirtualCypherExpressionProp<VNT["virtualProperties"][K]> :
        never
    )
}

type IncludedVirtualManyProp<propType extends VirtualManyRelationshipProperty, Spec extends VNodeDataRequest<propType["target"], any, any, any>> = {
    ifFlag: string|undefined,
    spec: Spec,
    type: "many",  // This field doesn't really exist; it's just a hint to the type system so it can distinguish among the RecursiveVirtualPropRequest types
};

type IncludedVirtualOneProp<propType extends VirtualOneRelationshipProperty, Spec extends VNodeDataRequest<propType["target"], any, any, any>> = {
    ifFlag: string|undefined,
    spec: Spec,
    type: "one",  // This field doesn't really exist; it's just a hint to the type system so it can distinguish among the RecursiveVirtualPropRequest types
};

type IncludedVirtualCypherExpressionProp<propType extends VirtualCypherExpressionProperty> = {
    ifFlag: string|undefined,
    type: "cypher",  // This field doesn't really exist; it's just a hint to the type system so it can distinguish among the RecursiveVirtualPropRequest types
    propertyDefinition: propType;  // This field also doesn't exist, but is required for type inference to work
};

// When using a virtual property to join some other VNode to another node, this ProjectRelationshipProps type is used to
// "project" properties from the *relationship* so that they appear as virtual properties on the target VNode.
//
// For example, if there is a (:Person)-[:ACTED_IN]->(:Movie) where "Person" is the main VNode and "Person.movies" is a
// virtual property to list the movies they acted in, and the ACTED_IN relationship has a "role" property, then this is
// used to make the "role" property appear as a virtual property on the Movie VNode.
type ProjectRelationshipProps<Rel extends VNodeRelationship|undefined> = (
    Rel extends VNodeRelationship ? {
        virtualProperties: {
            [K in keyof Rel["properties"]]: VirtualCypherExpressionPropertyForRelationshipProp<Rel["properties"][K]>
        }
    } : {virtualProperties: {/* empty */}}
);
type VirtualCypherExpressionPropertyForRelationshipProp<Prop> = (
    // This is a generated VirtualCypherExpressionProperty, used to make a property from the relationship appear as an
    // available virtual property on the target VNode. (e.g. the "role" property from the ACTED_IN relationship now
    // appears as a VirtualCypherExpressionProperty on the Movie VNode when accessed via the "person.movies.role"
    // virtual property, even though there is normally no "movies.role" virtual property.)
    Omit<VirtualCypherExpressionProperty, "valueType"> & {
        // We don't really enforce relationship properties or know when they're nullable so assume they can always be null:
        valueType: {nullOr: (
            // "Prop" is the property definition (Joi validator) defined in the VNode.relationshipsFrom section
            Prop extends Joi.StringSchema ? "string" :
            Prop extends Joi.NumberSchema ? "number" :
            Prop extends Joi.BooleanSchema ? "boolean" :
            Prop extends Joi.DateSchema ? "string" :
            "any"
        )}
    }
);


// Internal data stored in a VNodeDataRequest:
const _vnodeType = Symbol("vnodeType");
const _includedProperties = Symbol("includedProperties");
const _includedVirtualProperties = Symbol("virtualProperties");
const _projectedVirtualProperties = Symbol("_projectedVirtualProperties");
const _internalData = Symbol("internalData");

/** Internal data in a VNodeDataRequest object */
interface VNDRInternalData {
    // The VNodeType that this data request is for
    [_vnodeType]: VNodeTypeWithVirtualProps;
    // Raw properties to pull from the database.
    // Keys represent the property names; string values indicate they should only be pulled when a flag is set.
    [_includedProperties]: {[propName: string]: true|string}
    // Virtual properties (like related objects) to pull from the database, along with details such as what data to pull
    // in turn for those VNodes
    [_includedVirtualProperties]: {[propName: string]: {ifFlag: string|undefined, shapeData?: VNDRInternalData}},
    // Additional virtual properties currently available on this VNode, which may or may not be included in the request.
    // These are coming from a relationship, e.g. "Role" in the movies example.
    // If one of these additional virtual props should be included in the request, it will be in 
    // _includedVirtualProperties too.
    [_projectedVirtualProperties]: {[propName: string]: VirtualCypherExpressionProperty}
}

/** Proxy handler that works with the VNodeDataRequest() function to implement the VNodeDataRequest API. */
const vndrProxyHandler: ProxyHandler<VNDRInternalData> = {
    set: (internalData, propKey, value, requestObj) => false,  // Disallow setting properties on the VNodeDataRequest
    get: (internalData, propKey, requestObj) => {
        const vnodeType = internalData[_vnodeType];

        if (propKey === _internalData) {
            return internalData;
        } else if (typeof propKey !== "string") {
            throw new Error("Can't have non-string property keys on a VNodeDataRequest");
        }

        if (vnodeType === undefined) {
            throw new Error(`Can't access .${propKey} because its VNodeType is undefined. There is probably a circular import issue.`);
        }

        // Note: in this handler code, "return requestObj" will return the Proxy, i.e. the VNodeDataRequest, so that
        // multiple calls can be chained:
        //     const r = VNodeDataRequest(type).property1.property2.property3IfFlag("flag").property4 etc.

        if (vnodeType.properties[propKey] !== undefined) {
            // Operation to include a raw property:
            // "request.name" means add the "name" raw property to "request" and return "request"
            internalData[_includedProperties][propKey] = true;
            return requestObj;
        }

        if (propKey === "allProps") {
            Object.keys(vnodeType.properties).forEach(someProp => internalData[_includedProperties][someProp] = true);
            return requestObj;
        }

        if (propKey.endsWith("IfFlag")) {
            // Operation to conditionally add a raw property
            // "request.nameIfFlag('includeName')" means add the "name" raw property to "request" and return "request", but
            // when executing the request, only fetch the "name" property if the "includeName" flag is set.
            const actualPropKey = propKey.substr(0, propKey.length - 6);  // Remove "IfFlag"
            if (vnodeType.properties[actualPropKey] !== undefined) {
                // ...IfFlag requires an argument (the flag name), so return a function:
                return (flagName: string) => {
                    // The user is conditionally requesting a property, based on some flag.
                    // Check if this property was already requested though.
                    const oldRequest = internalData[_includedProperties][actualPropKey];
                    if (oldRequest === undefined) {
                        internalData[_includedProperties][actualPropKey] = flagName;
                    } else if (oldRequest === true) {
                        log.warn(`Cleanup needed: Property ${vnodeType.name}.${actualPropKey} was requested unconditionally and conditionally (${actualPropKey}IfFlag).`);
                    } else {
                        throw new Error(`Property ${vnodeType.name}.${actualPropKey} was requested based on two different flags (${flagName}, ${oldRequest}), which is unsupported.`);
                    }
                    return requestObj;
                };
            }
        }

        const virtualProp = vnodeType.virtualProperties[propKey] || internalData[_projectedVirtualProperties][propKey];
        if (virtualProp !== undefined) {
            // Operation to add a virtual property:
            if (virtualProp.type === VirtualPropType.ManyRelationship || virtualProp.type === VirtualPropType.OneRelationship) {
                // Return a method that can be used to build the request for this virtual property type
                const targetVNodeType = virtualProp.target;
                return (buildSubRequest: (subRequest: VNodeDataRequest<typeof targetVNodeType>) => VNodeDataRequest<typeof targetVNodeType>, options?: {ifFlag: string|undefined}) => {
                    // Build the subrequest immediately, using the supplied code:
                    const subRequestData = VNodeDataRequest(targetVNodeType); // An empty request - the buildSubRequest() will use it to pick which properties of the target type should be included.
                    if (virtualProp.type === VirtualPropType.ManyRelationship) {
                        // "Project" properties from the relationship onto the target VNode data request, so they can be optionally selected for inclusion:
                        const projectedRelationshipProps = virtualPropsForRelationship(virtualProp);
                        getInternalData(subRequestData)[_projectedVirtualProperties] = projectedRelationshipProps;
                    }
                    const subRequest = buildSubRequest(subRequestData);
                    // Save the request in our internal data:
                    if (internalData[_includedVirtualProperties][propKey] !== undefined) {
                        throw new Error(`Virtual Property ${vnodeType}.${propKey} was requested multiple times in one data request, which is not supported.`);
                    }
                    internalData[_includedVirtualProperties][propKey] = {
                        ifFlag: options?.ifFlag,
                        shapeData: getInternalData(subRequest),
                    };
                    // Return the same object so more operations can be chained on:
                    return requestObj;
                };
            } else if (virtualProp.type === VirtualPropType.CypherExpression) {
                return (options?: {ifFlag: string|undefined}) => {
                    // Save the request in our internal data:
                    if (internalData[_includedVirtualProperties][propKey] !== undefined) {
                        throw new Error(`Virtual Property ${vnodeType}.${propKey} was requested multiple times in one data request, which is not supported.`);
                    }
                    internalData[_includedVirtualProperties][propKey] = {
                        ifFlag: options?.ifFlag,
                    };
                    // Return the same object so more operations can be chained on:
                    return requestObj;
                };
            } else {
                throw new Error(`That virtual property type (${(virtualProp as any).type}) is not supported yet.`);
            }
        }

        throw new Error(`VNodeDataRequest(${internalData[_vnodeType].name}).${propKey} doesn't exist or is not implemented.`);
    },
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

// The full VNodeDataRequest<A, B, C, D> type is private and not exported, but it's necessary/useful to export the basic version:
export type VNodeDataRequestBuilder<VNT extends VNodeTypeWithVirtualProps> = VNodeDataRequest<VNT>;
export type VNodeDataRequestBuilt<VNT extends VNodeTypeWithVirtualProps> = VNodeDataRequest<VNT, any, any, any>;

/**
 * Base "constructor" for a VNodeDataRequest.
 *
 * Returns an empty VNodeDataRequest for the specified VNode type, which can be used to build a complete request.
 * @param vnt The VNode Type for which the request is being built
 */
export function VNodeDataRequest<VNT extends VNodeTypeWithVirtualProps>(vnt: VNT): VNodeDataRequestBuilder<VNT> {
    const data: VNDRInternalData = {
        [_vnodeType]: vnt,
        [_includedProperties]: {},
        [_includedVirtualProperties]: {},
        [_projectedVirtualProperties]: {}
    };
    return new Proxy(data, vndrProxyHandler) as any;
}

/**
 * When a VNodeDataRequest is executed ("pulled") from the database, this defines the shape/type of the response
 */
export type VNodeDataResponse<VNDR extends VNodeDataRequest<any, any, any, any>> = (
    VNDR extends VNodeDataRequest<infer VNT, infer includedProperties, infer flaggedProperties, infer includedVirtualProperties> ? (
        // Raw properties that are definitely included:
        {[rawProp in includedProperties]: PropertyDataType<VNT["properties"], rawProp>} &
        // Raw properties that are conditionally included, depending on whether a certain flag is set or not:
        {[conditionalRawProp in flaggedProperties]?: PropertyDataType<VNT["properties"], conditionalRawProp>} &
        // Virtual properties that are included, possibly conditional on some flag:
        {[virtualProp in keyof includedVirtualProperties]: (
            // A -to-many virtual property is included:
            includedVirtualProperties[virtualProp] extends IncludedVirtualManyProp<any, infer Spec> ?
                VNodeDataResponse<Spec>[] | (includedVirtualProperties[virtualProp]["ifFlag"] extends string ? undefined : never)
            // A -to-one virtual property is included:
            : includedVirtualProperties[virtualProp] extends IncludedVirtualOneProp<any, infer Spec> ?
                // 1:1 relationships are currently always optional at the DB level, so this may be null
                VNodeDataResponse<Spec> | null | (includedVirtualProperties[virtualProp]["ifFlag"] extends string ? undefined : never)
            // A cypher expression virtual property is included:
            : includedVirtualProperties[virtualProp] extends IncludedVirtualCypherExpressionProp<infer VirtPropDefinition> ?
                ReturnTypeFor<VirtPropDefinition["valueType"]> | (includedVirtualProperties[virtualProp]["ifFlag"] extends string ? undefined : never)
            : never
        )}
    ) : never
);

export interface DataRequestFilter {
    /** Key: If specified, the main node must have a UUID or shortId that is equal to this. */
    key?: string;
    /**
     * Filter the main node(s) of this data request to only those that match this predicate.
     * 
     * Examples:
     *     @this.name = ${name}
     *     @this.dateOfbirth < date("2002-01-01")
     *     EXISTS { MATCH (@)-->(m) WHERE @this.age = m.age }
     */
    where?: CypherQuery;
    /** Order the results by one of the properties (e.g. "name" or "name DESC") */
    orderBy?: string;
    /** A list of flags that determines which flagged/conditional properties should get included in the response */
    flags?: string[];
}


/**
 * Build a cypher query to load some data from the Neo4j graph database
 * @param _rootRequest VNodeDataRequest, which determines the shape of the data being requested
 * @param rootFilter Arguments such as primary keys to filter by, which determine what nodes are included in the response
 */
export function buildCypherQuery<Request extends VNodeDataRequest<any, any, any, any>>(_rootRequest: Request, rootFilter: DataRequestFilter = {}): {query: string, params: {[key: string]: any}} {
    const rootRequest: VNDRInternalData = getInternalData(_rootRequest);
    const rootNodeType = rootRequest[_vnodeType];
    const label = rootNodeType.label;
    let query: string;
    const params: {[key: string]: any} = {};
    const workingVars = new Set(["_node"]);

    /** Generate a new variable name for the given node type or property that we can use in the Cypher query. */
    const generateNameFor = (nodeTypeOrPropertyName: VNodeType|string): string => {
        let i = 1;
        let name = "";
        const baseName = typeof nodeTypeOrPropertyName === "string" ? nodeTypeOrPropertyName : nodeTypeOrPropertyName.name.toLowerCase();
        do {
            name = `_${baseName}${i}`;
            i++;
        } while (workingVars.has(name));
        return name;
    };

    if (rootFilter.key === undefined) {
        query = `MATCH (_node:${label}:VNode)\n`;
    } else {
        const key = rootFilter.key;
        if (key.length === 36) {
            // Look up by UUID.
            query = `MATCH (_node:${label}:VNode {uuid: $_nodeUuid})\n`;
            params._nodeUuid = key;
        } else if (key.length < 36) {
            if (rootNodeType.properties.shortId === undefined) {
                throw new Error(`The requested ${rootNodeType.name} VNode type doesn't use shortId.`);
            }
            query = `MATCH (_node:${label}:VNode)<-[:IDENTIFIES]-(:ShortId {shortId: $_nodeShortid})\n`;
            params._nodeShortid = key;
        } else {
            throw new Error("shortId must be shorter than 36 characters; UUID must be exactly 36 characters.");
        }
    }
    if (rootFilter.where) {
        // This query is being filtered by some WHERE condition.
        // Add it and any parameter values into this query. Rename parameters as needed.
        let whereClause = rootFilter.where.queryString.replace("@this", "_node");
        let i = 1;
        for (const paramName in rootFilter.where.params) {
            const newParamName = `whereParam${i++}`;
            whereClause = whereClause.replace("$" + paramName, "$" + newParamName);
            params[newParamName] = rootFilter.where.params[paramName];
        }
        query += `WHERE ${whereClause}\n`;
    }

    

    // Build subqueries

    /** Add an OPTIONAL MATCH clause to join each current node to many other nodes via some x:many relationship */
    const addManyRelationshipSubquery = (variableName: string, virtProp: VirtualManyRelationshipProperty, parentNodeVariable: string, request: VNDRInternalData): void => {
        const newTargetVar = generateNameFor(virtProp.target);
        workingVars.add(newTargetVar);
        if (Object.keys(virtProp.query.params).length) {
            throw new Error(`A virtual property query clause cannot have parameters.`);
            // ^ This could be supported in the future though, if useful.
        }
        let matchClause = (
            virtProp.query.queryString
            .replace("@this", parentNodeVariable)
            .replace("@target", newTargetVar)
        );
        // If (one of) the relationship(s) in the MATCH (@self)-...relationships...-(@target) expression is named via the @rel placeholder,
        // then replace that with a variable that can be used to fetch properties from the relationship or sort by them.
        let relationshipVariable: string|undefined;
        if (matchClause.includes("@rel")) {
            relationshipVariable = generateNameFor("rel");
            workingVars.add(relationshipVariable);
            matchClause = matchClause.replace("@rel", relationshipVariable);
        }
        query += `\nOPTIONAL MATCH ${matchClause}\n`;

        // Add additional subqeries, if any:
        const virtPropsMap = addVirtualPropsForNode(newTargetVar, request, relationshipVariable);

        // Order the results of this subquery (has to happen immediately before the WITH...collect() line):
        const orderBy = virtProp.defaultOrderBy || virtProp.target.defaultOrderBy;
        if (orderBy) {
            // TODO: allow ordering by properties of the relationship
            const orderExpression = orderBy.replace("@this", newTargetVar).replace("@rel", relationshipVariable || "@rel");
            query += `WITH ${[...workingVars].join(", ")} ORDER BY ${orderExpression}\n`;
        }
        // Construct the WITH statement that ends this subquery, collect()ing many related nodes into a single array property
        workingVars.delete(newTargetVar);
        if (relationshipVariable) {
            workingVars.delete(relationshipVariable);
        }
        const variablesIncluded = getRawPropertiesIncludedIn(request, rootFilter).map(p => "." + p);
        // Pull in the virtual properties included:
        for (const [pName, varName] of Object.entries(virtPropsMap)) {
            workingVars.delete(varName);
            variablesIncluded.push(`${pName}: ${varName}`);  // This re-maps our temporary variable like "friends_1" into its final name like "friends"
        }
        query += `WITH ${[...workingVars].join(", ")}, collect(${newTargetVar} {${variablesIncluded.join(", ")}}) AS ${variableName}\n`;
        workingVars.add(variableName);
    }

    /** Add an subquery clause to join each current node to at most one other node via some x:one relationship */
    const addOneRelationshipSubquery = (variableName: string, virtProp: VirtualOneRelationshipProperty, parentNodeVariable: string, request: VNDRInternalData): void => {
        const newTargetVar = generateNameFor(virtProp.target);
        workingVars.add(newTargetVar);

        if (Object.keys(virtProp.query.params).length) {
            throw new Error(`A virtual property query clause cannot have parameters.`);
            // ^ This could be supported in the future though, if useful.
        }

        // Unfortunately, the database doesn't actually enforce that this is a 1:1 relationship, so we use this subquery
        // to limit the OPTIONAL MATCH to one node at most. According to PROFILE, this way of doing it only adds 1 "db hit"
        query += `\nCALL {\n`;
        query += `    WITH ${parentNodeVariable}\n`;
        query += `    OPTIONAL MATCH ${virtProp.query.queryString.replace("@this", parentNodeVariable).replace("@target", newTargetVar)}\n`;
        query += `    RETURN ${newTargetVar} LIMIT 1\n`;
        query += `}\n`;

        // Add additional subqeries, if any:
        const virtPropsMap = addVirtualPropsForNode(newTargetVar, request);

        // Construct the WITH statement that ends this subquery
        workingVars.delete(newTargetVar);
        const variablesIncluded = getRawPropertiesIncludedIn(request, rootFilter).map(p => "." + p);
        // Pull in the virtual properties included:
        for (const [pName, varName] of Object.entries(virtPropsMap)) {
            workingVars.delete(varName);
            variablesIncluded.push(`${pName}: ${varName}`);  // This re-maps our temporary variable like "friends_1" into its final name like "friends"
        }
        query += `WITH ${[...workingVars].join(", ")}, ${newTargetVar} {${variablesIncluded.join(", ")}} AS ${variableName}\n`;
        workingVars.add(variableName);
    }

    /** Add a variable computed using some cypher expression */
    const addCypherExpression = (variableName: string, virtProp: VirtualCypherExpressionProperty, parentNodeVariable: string, relationshipVariable?: string): void => {
        if (Object.keys(virtProp.cypherExpression.params).length) {
            throw new Error(`A virtual property cypherExpression cannot have parameters.`);
            // ^ This could be supported in the future though, if useful.
        }

        const cypherExpression = virtProp.cypherExpression.queryString.replace("@this", parentNodeVariable).replace("@rel", relationshipVariable || "@rel");

        query += `WITH ${[...workingVars].join(", ")}, (${cypherExpression}) AS ${variableName}\n`;
        workingVars.add(variableName);
    }

    type VirtualPropertiesMap = {[propName: string]: string};
    // Add subqueries for each of this node's virtual properties.
    // Returns a map that maps from the virtual property's name (e.g. "friends") to the variable name/placeholder used
    // in the query (e.g. "friends_1")
    const addVirtualPropsForNode = (parentNodeVariable: string, request: VNDRInternalData, relationshipVariable?: string): VirtualPropertiesMap => {
        const virtPropsMap: VirtualPropertiesMap = {};
        // For each virtual prop:
        getVirtualPropertiesIncludedIn(request, rootFilter).forEach(propName => {
            const virtProp = request[_vnodeType].virtualProperties[propName] || request[_projectedVirtualProperties][propName];
            const virtPropRequest = request[_includedVirtualProperties][propName].shapeData;
            const variableName = generateNameFor(propName);
            virtPropsMap[propName] = variableName;
            if (virtProp.type === VirtualPropType.ManyRelationship) {
                if (virtPropRequest === undefined) { throw new Error(`Missing sub-request for x:many virtProp "${propName}"!`); }
                addManyRelationshipSubquery(variableName, virtProp, parentNodeVariable, virtPropRequest);
            } else if (virtProp.type === VirtualPropType.OneRelationship) {
                if (virtPropRequest === undefined) { throw new Error(`Missing sub-request for x:one virtProp "${propName}"!`); }
                addOneRelationshipSubquery(variableName, virtProp, parentNodeVariable, virtPropRequest);
            } else if (virtProp.type === VirtualPropType.CypherExpression) {
                addCypherExpression(variableName, virtProp, parentNodeVariable, relationshipVariable);
            } else {
                throw new Error("Not implemented yet.");
                // TODO: Build computed virtual props, 1:1 virtual props
            }
        });
        return virtPropsMap;
    }

    // Add subqueries:
    const virtPropMap = addVirtualPropsForNode("_node", rootRequest);

    // Build the final RETURN statement
    const rawPropertiesIncluded = getRawPropertiesIncludedIn(rootRequest, rootFilter).map(propName => `_node.${propName} AS ${propName}`);
    const virtPropsIncluded = Object.entries(virtPropMap).map(([propName, varName]) => `${varName} AS ${propName}`);
    Object.values(virtPropMap).forEach(varName => workingVars.delete(varName));
    // We remove _node (first one) from the workingVars because we never return _node directly, only the subset of 
    // its properties actually requested. But we've kept it around this long because it's used by virtual properties.
    workingVars.delete("_node");
    if (workingVars.size > 0) {
        throw new Error(`Internal error in buildCypherQuery: working variable ${[...workingVars][0]} was not consumed.`);
    }
    const finalVars = [...rawPropertiesIncluded, ...virtPropsIncluded].join(", ") || "null";  // Or just return null if no variables are selected for return
    query += `\nRETURN ${finalVars}`;

    const orderBy = rootFilter.orderBy || rootNodeType.defaultOrderBy;
    if (orderBy) {
        query += ` ORDER BY ${orderBy.replace("@this", "_node")}`;
    }

    return {query, params};
}


export function pull<VNT extends VNodeTypeWithVirtualProps, VNDR extends VNodeDataRequest<VNT, any, any, any>>(
    tx: WrappedTransaction,
    vnt: VNT,
    vndr: ((builder: VNodeDataRequestBuilder<VNT>) => VNDR),
    filter?: DataRequestFilter,
): Promise<VNodeDataResponse<VNDR>[]>;

export function pull<VNDR extends VNodeDataRequest<any, any, any, any>>(
    tx: WrappedTransaction,
    vndr: VNDR,
    filter?: DataRequestFilter,
): Promise<VNodeDataResponse<VNDR>[]>;

export async function pull(tx: WrappedTransaction, arg1: any, arg2?: any, arg3?: any): Promise<any> {
    const request: VNodeDataRequest<VNodeTypeWithVirtualAndDerivedProps> = typeof arg2 === "function" ? arg2(VNodeDataRequest(arg1)) : arg1;
    const requestData: VNDRInternalData = getInternalData(request);
    const filter: DataRequestFilter = (typeof arg2 === "function" ? arg3 : arg2) || {};
    const topLevelFields = getAllPropertiesIncludedIn(requestData, filter);

    const query = buildCypherQuery(request, filter);
    log.debug(query.query);

    const result = await tx.run(query.query, query.params);

    return result.records.map(record => {
        const newRecord: any = {};
        for (const field of topLevelFields) {
            newRecord[field] = record.get(field);
        }
        return newRecord;
    });
}

export function pullOne<VNT extends VNodeTypeWithVirtualProps, VNDR extends VNodeDataRequest<VNT, any, any, any>>(
    tx: WrappedTransaction,
    vnt: VNT,
    vndr: ((builder: VNodeDataRequestBuilder<VNT>) => VNDR),
    filter?: DataRequestFilter,
): Promise<VNodeDataResponse<VNDR>>;

export function pullOne<VNDR extends VNodeDataRequest<any, any, any, any>>(
    tx: WrappedTransaction,
    vndr: VNDR,
    filter?: DataRequestFilter,
): Promise<VNodeDataResponse<VNDR>>;

export async function pullOne(tx: WrappedTransaction, arg1: any, arg2?: any, arg3?: any): Promise<any> {
    const result = await pull(tx, arg1, arg2, arg3);

    if (result.length !== 1) {
        throw new Error(`Expected a single result, got ${result.length}`);
    }

    return result[0];
}

// These types match the overload signature for pull(), but have no "tx" parameter; used in WrappedTransaction and Vertex for convenience.
export type PullNoTx = (
    (
        <VNT extends VNodeTypeWithVirtualProps, VNDR extends VNodeDataRequest<VNT, any, any, any>>(
            vnt: VNT,
            vndr: ((builder: VNodeDataRequestBuilder<VNT>) => VNDR),
            filter?: DataRequestFilter,
        ) => Promise<VNodeDataResponse<VNDR>[]>
    ) & (
        <VNDR extends VNodeDataRequest<any, any, any, any>>(
            vndr: VNDR,
            filter?: DataRequestFilter,
        ) => Promise<VNodeDataResponse<VNDR>[]>
    )
);

export type PullOneNoTx = (
    (
        <VNT extends VNodeTypeWithVirtualProps, VNDR extends VNodeDataRequest<VNT, any, any, any>>(
            vnt: VNT,
            vndr: ((builder: VNodeDataRequestBuilder<VNT>) => VNDR),
            filter?: DataRequestFilter,
        ) => Promise<VNodeDataResponse<VNDR>>
    ) & (
        <VNDR extends VNodeDataRequest<any, any, any, any>>(
            vndr: VNDR,
            filter?: DataRequestFilter,
        ) => Promise<VNodeDataResponse<VNDR>>
    )
);

// Helper functions:

function getInternalData(request: VNodeDataRequest<any, any, any, any>): VNDRInternalData {
    return (request as any)[_internalData];
}

/**
 * Helper function: given a VNodeDataRequest and filter options, lists all the raw (non-virtual) properties of the VNode
 * that should be included in the data request. The properties will be returned in an ordered array, in the order that
 * the properties were declared on the VNode type definition.
 * @param request 
 * @param filter 
 */
function getRawPropertiesIncludedIn(request: VNDRInternalData, filter: DataRequestFilter): string[] {
    return Object.keys(request[_vnodeType].properties).filter(propName =>
        // request[_includedProperties][propName] will be either undefined (exclude), true (include), or a string (include based on flag)
        typeof request[_includedProperties][propName] === "string" ?
            // Conditionally include this raw prop, if a flag is set in the filter:
            filter.flags?.includes(request[_includedProperties][propName] as string)
        :
            request[_includedProperties][propName] === true
    );
}

/**
 * Helper function: given a VNodeDataRequest and filter options, lists all the virtual properties of the VNode
 * that should be included in the data request. The properties will be returned in an ordered array, in the order that
 * the virtual properties were declared on the VNode type definition.
 * @param request 
 * @param filter 
 */
function getVirtualPropertiesIncludedIn(request: VNDRInternalData, filter: DataRequestFilter): string[] {
    const keys = Object.keys(request[_vnodeType].virtualProperties);
    keys.push(...Object.keys(request[_projectedVirtualProperties]));
    return keys.filter(propName =>
        propName in request[_includedVirtualProperties] && (
            request[_includedVirtualProperties][propName].ifFlag ?
                // Conditionally include this virtual prop, if a flag is set in the filter:
                filter.flags?.includes(request[_includedVirtualProperties][propName].ifFlag as string)
            :
                true
        )
    );
}

/**
 * Helper function: given a VNodeDataRequest and filter options, lists all the raw and virtual properties of the VNode
 * that should be included in the data request. The properties will be returned in an ordered array, in the order that
 * the properties were declared on the VNode type definition (first raw properties, then virtual properties).
 * @param request 
 * @param filter 
 */
function getAllPropertiesIncludedIn(request: VNDRInternalData, filter: DataRequestFilter): string[] {
    return [
        ...getRawPropertiesIncludedIn(request, filter),
        ...getVirtualPropertiesIncludedIn(request, filter),
    ];
}

