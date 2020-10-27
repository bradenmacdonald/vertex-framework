import { log } from "./lib/log";
import {
    PropertyDataType,
    VNodeType,
    VirtualManyRelationshipProperty,
    VirtualOneRelationshipProperty,
    VirtualPropertyDefinition,
    VirtualPropType,
    PropSchema,
} from "./vnode";
import type { WrappedTransaction } from "./transaction";

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
    VNT extends VNodeType,
    rawProps extends keyof VNT["properties"] = never,
    maybeRawProps extends keyof VNT["properties"] = never,
    virtualPropSpec extends RecursiveVirtualPropRequest<VNT> = {}  // eslint-disable-line @typescript-eslint/ban-types
> = (
    // Each VNodeDataRequest has a .allProps attribute which requests all raw properties and returns the same request object
    VNDR_AddAllProps<VNT, rawProps, maybeRawProps, virtualPropSpec> &
    // For each raw field like "uuid", the data request has a .uuid attribute which requests that field and returns the same request object
    VNDR_AddRawProp<VNT, rawProps, maybeRawProps, virtualPropSpec> &
    // For each raw field like "uuid", the data request has a .uuidIfFlag() method which conditionally requests that field
    VNDR_AddFlags<VNT, rawProps, maybeRawProps, virtualPropSpec> &
    // For each virtual property of the VNodeType, there is a .propName(p => p...) method for requesting it.
    VNDR_AddVirtualProp<VNT, rawProps, maybeRawProps, virtualPropSpec> &
    // When requesting related VNodes via virtual properties, one can also request fields from the relationship between the current VNode and the related one:
    VNDR_AddVirtualRelationshipProp<VNT, rawProps, maybeRawProps, virtualPropSpec>
);

/** Each VNodeDataRequest has a .allProps attribute which requests all raw properties and returns the same request object */
type VNDR_AddAllProps<
    VNT extends VNodeType,
    rawProps extends keyof VNT["properties"],
    maybeRawProps extends keyof VNT["properties"],
    virtualPropSpec extends RecursiveVirtualPropRequest<VNT>,
> = {
    allProps: VNodeDataRequest<VNT, keyof VNT["properties"], maybeRawProps, virtualPropSpec>
};

/** For each raw field like "uuid", the data request has a .uuid attribute which requests that field and returns the same request object */
type VNDR_AddRawProp<
    VNT extends VNodeType,
    rawProps extends keyof VNT["properties"],
    maybeRawProps extends keyof VNT["properties"],
    virtualPropSpec extends RecursiveVirtualPropRequest<VNT>,
> = {
    [K in keyof VNT["properties"]/* as Exclude<K, rawProps|maybeRawProps>*/]: VNodeDataRequest<VNT, rawProps|K, maybeRawProps, virtualPropSpec>
};

/** For each raw field like "uuid", the data request has a .uuidIfFlag() method which conditionally requests that field */
type VNDR_AddFlags<
    VNT extends VNodeType,
    rawProps extends keyof VNT["properties"],
    maybeRawProps extends keyof VNT["properties"],
    virtualPropSpec extends RecursiveVirtualPropRequest<VNT>,
> = {
    [K in keyof VNT["properties"] as K extends string ? `${K}IfFlag` : never]: (flagName: string) => VNodeDataRequest<VNT, rawProps, maybeRawProps|K, virtualPropSpec>
};

/** For each virtual property of the VNodeType, there is a .propName(p => p...) method for requesting it. */
type VNDR_AddVirtualProp<
    VNT extends VNodeType,
    rawProps extends keyof VNT["properties"],
    maybeRawProps extends keyof VNT["properties"],
    virtualPropSpec extends RecursiveVirtualPropRequest<VNT>,
> = {
    [K in keyof VNT["virtualProperties"]]: (
        VNT["virtualProperties"][K] extends VirtualManyRelationshipProperty ?
            // For each x:many virtual property, add a method for requesting that virtual property:
            <SubSpec extends VNodeDataRequest<VNT["virtualProperties"][K]["target"]>, FlagType extends string|undefined = undefined>
            // This is the method:
            (subRequest: (
                buildSubequest: VNodeDataRequest<VNT["virtualProperties"][K]["target"] & ExtraRelationshipProps<VNT["virtualProperties"][K]["relationshipProps"]>>) => SubSpec,
                options?: {ifFlag?: FlagType}
            )
            // The return value of the method is the same VNodeDataRequest, with the additional virtual property added in:
            => VNodeDataRequest<VNT, rawProps, maybeRawProps, virtualPropSpec&{[K2 in K]: {ifFlag: FlagType, spec: SubSpec, type: "many"}}>
        : VNT["virtualProperties"][K] extends VirtualOneRelationshipProperty ?
            // For each x:one virtual property, add a method for requesting that virtual property:
            <SubSpec extends VNodeDataRequest<VNT["virtualProperties"][K]["target"]>, FlagType extends string|undefined = undefined>
            (subRequest: (buildSubequest: VNodeDataRequest<VNT["virtualProperties"][K]["target"]>) => SubSpec, options?: {ifFlag: FlagType})
            => VNodeDataRequest<VNT, rawProps, maybeRawProps, virtualPropSpec&{[K2 in K]: {ifFlag: FlagType, spec: SubSpec, type: "one"}}>
        : never
    )
};

/**
 * If this VNodeType is joined to some parent type via a virtual property, there may be fields stored on the
 * relationship that can be added to the request (annotated onto this VNode)
 */
type VNDR_AddVirtualRelationshipProp<
    VNT extends VNodeType,
    rawProps extends keyof VNT["properties"],
    maybeRawProps extends keyof VNT["properties"],
    virtualPropSpec extends RecursiveVirtualPropRequest<VNT>,
> = (
    VNT extends ExtraRelationshipProps<infer RelationshipPropSchema> ? {
        [K in keyof RelationshipPropSchema]: VNodeDataRequest<VNT, rawProps, maybeRawProps, virtualPropSpec>
    } : {/* If this is a normal/root VNode, not joined in via a virtual prop, there is no extra method available here. */}
);

/** Type data about virtual properties that have been requested so far in a VNodeDataRequest */
type RecursiveVirtualPropRequest<VNT extends VNodeType> = {
    [K in keyof VNT["virtualProperties"]]?: (
        VNT["virtualProperties"][K] extends VirtualManyRelationshipProperty ?
            RecursiveVirtualPropRequestManySpec<VNT["virtualProperties"][K], any> :
        VNT["virtualProperties"][K] extends VirtualOneRelationshipProperty ?
            RecursiveVirtualPropRequestOneSpec<VNT["virtualProperties"][K], any> :
        never
    )
}

type RecursiveVirtualPropRequestManySpec<propType extends VirtualManyRelationshipProperty, Spec extends VNodeDataRequest<propType["target"], any, any, any>> = {
    ifFlag: string|undefined,
    spec: Spec,
    type: "many",  // This field doesn't really exist; it's just a hint to the type system so it can distinguish ...ManySpec from ...OneSpec
};

type RecursiveVirtualPropRequestOneSpec<propType extends VirtualOneRelationshipProperty, Spec extends VNodeDataRequest<propType["target"], any, any, any>> = {
    ifFlag: string|undefined,
    spec: Spec,
    type: "one",  // This field doesn't really exist; it's just a hint to the type system so it can distinguish ...ManySpec from ...OneSpec
};

type ExtraRelationshipProps<PS extends PropSchema|undefined> = {availablePropsFromRelationship: PS};


// Internal data stored in a VNodeDataRequest:
const _vnodeType = Symbol("vnodeType");
const _rawProperties = Symbol("rawProperties");
const _virtualProperties = Symbol("virtualProperties");
const _internalData = Symbol("internalData");

/** Internal data in a VNodeDataRequest object */
interface VNDRInternalData {
    // The VNodeType that this data request is for
    [_vnodeType]: VNodeType;
    // Raw properties to pull from the database.
    // Keys represent the property names; string values indicate they should only be pulled when a flag is set.
    [_rawProperties]: {[propName: string]: true|string}
    // Virtual properties (like related objects) to pull from the database, along with details such as what data to pull
    // in turn for those VNodes
    [_virtualProperties]: {[propName: string]: {ifFlag: string|undefined, shapeData?: VNDRInternalData}},
}

/** Proxy handler that works with the VNodeDataRequest() function to implement the VNodeDataRequest API. */
const vndrProxyHandler: ProxyHandler<VNDRInternalData> = {
    set: (internalData, propKey, value, requestObj) => false,  // Disallow setting properties on the VNodeDataRequest
    get: (internalData, propKey, requestObj) => {
        const vnodeType = internalData[_vnodeType];

        if (propKey === _internalData) {
            return internalData;
        } else if (typeof propKey !== "string") {
            throw new Error("Can't have non-string fields on a VNodeDataRequest");
        }

        // Note: in this handler code, "return requestObj" will return the Proxy, i.e. the VNodeDataRequest, so that
        // multiple calls can be chained:
        //     const r = VNodeDataRequest(type).field1.field2.field3IfFlag("flag").field4 etc.

        if (vnodeType.properties[propKey] !== undefined) {
            // Operation to include a raw property:
            // "request.name" means add the "name" raw property to "request" and return "request"
            internalData[_rawProperties][propKey] = true;
            return requestObj;
        }

        if (propKey === "allProps") {
            Object.keys(vnodeType.properties).forEach(someProp => internalData[_rawProperties][someProp] = true);
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
                    // The user is conditionally requesting a field, based on some flag.
                    // Check if this property was already requested though.
                    const oldRequest = internalData[_rawProperties][actualPropKey];
                    if (oldRequest === undefined) {
                        internalData[_rawProperties][actualPropKey] = flagName;
                    } else if (oldRequest === true) {
                        log.warn(`Cleanup needed: Property ${vnodeType.name}.${actualPropKey} was requested unconditionally and conditionally (${actualPropKey}IfFlag).`);
                    } else {
                        throw new Error(`Property ${vnodeType.name}.${actualPropKey} was requested based on two different flags (${flagName}, ${oldRequest}), which is unsupported.`);
                    }
                    return requestObj;
                };
            }
        }

        const virtualProp = vnodeType.virtualProperties[propKey];
        if (virtualProp !== undefined) {
            // Operation to add a virtual property:
            if (virtualProp.type === VirtualPropType.ManyRelationship || virtualProp.type === VirtualPropType.OneRelationship) {
                // Return a method that can be used to build the request for this virtual property type
                const targetVNodeType = virtualProp.target;
                return (buildSubRequest: (subRequest: VNodeDataRequest<typeof targetVNodeType>) => VNodeDataRequest<typeof targetVNodeType>, options?: {ifFlag: string|undefined}) => {
                    // Build the subrequest immediately, using the supplied code:
                    const subRequest = buildSubRequest(VNodeDataRequest(targetVNodeType));
                    // Save the request in our internal data:
                    if (internalData[_virtualProperties][propKey] !== undefined) {
                        throw new Error(`Virtual Property ${vnodeType}.${propKey} was requested multiple times in one data request, which is not supported.`);
                    }
                    internalData[_virtualProperties][propKey] = {
                        ifFlag: options?.ifFlag,
                        shapeData: getInternalData(subRequest),
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

// The full VNodeDataRequest<A, B, C, D> type is private and not exported, but it's necessary/useful to export the basic version:
export type VNodeDataRequestBuilder<VNT extends VNodeType> = VNodeDataRequest<VNT>;

/**
 * Base "constructor" for a VNodeDataRequest.
 *
 * Returns an empty VNodeDataRequest for the specified VNode type, which can be used to build a complete request.
 * @param vnt The VNode Type for which the request is being built
 */
export function VNodeDataRequest<VNT extends VNodeType>(vnt: VNT): VNodeDataRequestBuilder<VNT> {
    const data: VNDRInternalData = {
        [_vnodeType]: vnt,
        [_rawProperties]: {},
        [_virtualProperties]: {},
    };
    return new Proxy(data, vndrProxyHandler) as any;
}

/**
 * When a VNodeDataRequest is executed ("pulled") from the database, this defines the shape/type of the response
 */
type VNodeDataResponse<VNDR extends VNodeDataRequest<any, any, any, any>> = (
    VNDR extends VNodeDataRequest<infer VNT, infer rawProps, infer maybeRawProps, infer virtualPropSpec> ? (
        {[rawProp in rawProps]: PropertyDataType<VNT["properties"], rawProp>} &
        {[conditionalRawProp in maybeRawProps]?: PropertyDataType<VNT["properties"], conditionalRawProp>} &
        {[virtualProp in keyof virtualPropSpec]: (
            virtualPropSpec[virtualProp] extends RecursiveVirtualPropRequestManySpec<any, infer Spec> ?
                VNodeDataResponse<Spec>[] | (virtualPropSpec[virtualProp]["ifFlag"] extends string ? undefined : never)
            : virtualPropSpec[virtualProp] extends RecursiveVirtualPropRequestOneSpec<any, infer Spec> ?
                // 1:1 relationships are currently always optional at the DB level, so this may be null
                VNodeDataResponse<Spec> | null | (virtualPropSpec[virtualProp]["ifFlag"] extends string ? undefined : never)
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
     *     @.name = $name
     *     @.dateOfbirth < date("2002-01-01")
     *     EXISTS { MATCH (@)-->(m) WHERE @.age = m.age }
     */
    where?: string;
    /** Params: Values that are referenced in the "where" predicate, if any. */
    params?: {[key: string]: any};
    /** Order the results by one of the fields (e.g. "name" or "name DESC") */
    orderBy?: string;
    /** Optional fields to include in the response */
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
    const params: {[key: string]: any} = rootFilter.params || {};
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
        query += `WHERE ${rootFilter.where.replace("@", "_node")}\n`;
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
        query += `\nOPTIONAL MATCH ${virtProp.query.queryString.replace("@this", parentNodeVariable).replace("@target", newTargetVar)}\n`;

        // Add additional subqeries, if any:
        const virtPropsMap = addVirtualPropsForNode(newTargetVar, request);

        // Order the results of this subquery (has to happen immediately before the WITH...collect() line):
        if (virtProp.target.defaultOrderBy) {
            query += `WITH ${[...workingVars].join(", ")} ORDER BY ${newTargetVar}.${virtProp.target.defaultOrderBy}\n`;
        }
        // Construct the WITH statement that ends this subquery, collect()ing many related nodes into a single array property
        workingVars.delete(newTargetVar);
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

    type VirtualPropertiesMap = {[propName: string]: string};
    // Add subqueries for each of this node's virtual properties.
    // Returns a map that maps from the virtual property's name (e.g. "friends") to the variable name/placeholder used
    // in the query (e.g. "friends_1")
    const addVirtualPropsForNode = (parentNodeVariable: string, request: VNDRInternalData): VirtualPropertiesMap => {
        const virtPropsMap: VirtualPropertiesMap = {};
        // For each virtual prop:
        getVirtualPropertiesIncludedIn(request, rootFilter).forEach(propName => {
            const virtProp = request[_vnodeType].virtualProperties[propName];
            const virtPropRequest = request[_virtualProperties][propName].shapeData;
            const variableName = generateNameFor(propName);
            virtPropsMap[propName] = variableName;
            if (virtProp.type === VirtualPropType.ManyRelationship) {
                if (virtPropRequest === undefined) { throw new Error(`Missing sub-request for x:many virtProp "${propName}"!`); }
                addManyRelationshipSubquery(variableName, virtProp, parentNodeVariable, virtPropRequest);
            } else if (virtProp.type === VirtualPropType.OneRelationship) {
                if (virtPropRequest === undefined) { throw new Error(`Missing sub-request for x:one virtProp "${propName}"!`); }
                addOneRelationshipSubquery(variableName, virtProp, parentNodeVariable, virtPropRequest);
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
        query += ` ORDER BY _node.${orderBy}`;
    }

    return {query, params};
}


export function pull<VNT extends VNodeType, VNDR extends VNodeDataRequest<VNT, any, any, any>>(
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
    const request: VNodeDataRequest<VNodeType> = typeof arg2 === "function" ? arg2(VNodeDataRequest(arg1)) : arg1;
    const requestData: VNDRInternalData = getInternalData(request);
    const filter: DataRequestFilter = (typeof arg2 === "function" ? arg3 : arg2) || {};
    const topLevelFields = getAllFieldsIncludedIn(requestData, filter);

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

export function pullOne<VNT extends VNodeType, VNDR extends VNodeDataRequest<VNT, any, any, any>>(
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
        <VNT extends VNodeType, VNDR extends VNodeDataRequest<VNT, any, any, any>>(
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
        <VNT extends VNodeType, VNDR extends VNodeDataRequest<VNT, any, any, any>>(
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
        // request[_rawProperties][propName] will be either undefined (exclude), true (include), or a string (include based on flag)
        typeof request[_rawProperties][propName] === "string" ?
            // Conditionally include this raw prop, if a flag is set in the filter:
            filter.flags?.includes(request[_rawProperties][propName] as string)
        :
            request[_rawProperties][propName] === true
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
    Object.keys(request[_vnodeType].virtualProperties).forEach(propName => {
        const cond = propName in request[_virtualProperties] && (
            request[_virtualProperties][propName].ifFlag ?
                // Conditionally include this virtual prop, if a flag is set in the filter:
                filter.flags?.includes(request[_virtualProperties][propName].ifFlag as string)
            :
                true
        );
    });
    return Object.keys(request[_vnodeType].virtualProperties).filter(propName =>
        propName in request[_virtualProperties] && (
            request[_virtualProperties][propName].ifFlag ?
                // Conditionally include this virtual prop, if a flag is set in the filter:
                filter.flags?.includes(request[_virtualProperties][propName].ifFlag as string)
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
function getAllFieldsIncludedIn(request: VNDRInternalData, filter: DataRequestFilter): string[] {
    return [
        ...getRawPropertiesIncludedIn(request, filter),
        ...getVirtualPropertiesIncludedIn(request, filter),
    ];
}

