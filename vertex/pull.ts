import { log } from "./lib/log";
import {
    PropertyDataType,
    VNodeType,
    VirtualManyRelationshipProperty,
    VirtualOneRelationshipProperty,
    VirtualPropertyDefinition,
    VirtualPropType,
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
    virtualPropSpec extends RecursiveVirtualPropRequest<VNT> = {}
> = (
    // Each VNodeDataRequest has a .allProps attribute which requests all raw properties and returns the same request object
    VNDR_AddAllProps<VNT, rawProps, maybeRawProps, virtualPropSpec> &
    // For each raw field like "uuid", the data request has a .uuid attribute which requests that field and returns the same request object
    VNDR_AddRawProp<VNT, rawProps, maybeRawProps, virtualPropSpec> &
    // For each raw field like "uuid", the data request has a .uuidIfFlag() method which conditionally requests that field
    VNDR_AddFlags<VNT, rawProps, maybeRawProps, virtualPropSpec> &
    // For each virtual property of the VNodeType, there is a .propName(p => p...) method for requesting it.
    VNDR_AddVirtualProp<VNT, rawProps, maybeRawProps, virtualPropSpec>
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
    [K in keyof VNT["properties"] as `${K}IfFlag`]: (flagName: string) => VNodeDataRequest<VNT, rawProps, maybeRawProps|K, virtualPropSpec>
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
            (subRequest: (emptyRequest: VNodeDataRequest<VNT["virtualProperties"][K]["target"]>) => SubSpec, options?: {ifFlag: FlagType})
            => VNodeDataRequest<VNT, rawProps, maybeRawProps, virtualPropSpec&{[K2 in K]: {ifFlag: FlagType, spec: SubSpec}}>
        : never
    )
};

/** Type data about virtual properties that have been requested so far in a VNodeDataRequest */
type RecursiveVirtualPropRequest<VNT extends VNodeType> = {
    [K in keyof VNT["virtualProperties"]]?: (
        VNT["virtualProperties"][K] extends VirtualManyRelationshipProperty ?
            RecursiveVirtualPropRequestManySpec<VNT["virtualProperties"][K], any> :
        never
    )
}

type RecursiveVirtualPropRequestManySpec<propType extends VirtualManyRelationshipProperty, Spec extends VNodeDataRequest<propType["target"], any, any, any>> = {
    ifFlag: string|undefined,
    spec: Spec,
};


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
            if (virtualProp.type === VirtualPropType.ManyRelationship) {
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
                        shapeData: (subRequest as any)[_internalData],
                    };
                    // Return the same object so more operations can be chained on:
                    return requestObj;
                };
            } else {
                throw new Error(`That virtual property type (${virtualProp.type}) is not supported yet.`);
            }
        }
    },
};

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
            : never
        )}
    ) : never
);

export async function newPull<VNDR extends VNodeDataRequest<any, any, any, any>>(vndr: VNDR): Promise<VNodeDataResponse<VNDR>> {
    return {} as any;
}







const vnodeType = Symbol("vnodeType");

type FieldNameFor<T extends VNodeType> = keyof T["properties"] | keyof T["virtualProperties"];

export type DataRequestFields<T extends VNodeType> = (
    {[K in keyof T["properties"]]?: DataRequestValue<T, K>} |
    {[K2 in keyof T["virtualProperties"]]?: DataRequestValue<T, K2>}
);

export type DataRequest<T extends VNodeType, Fields extends DataRequestFields<T>> = {
    [K2 in (keyof Fields)&FieldNameFor<T>]: DataRequestValue<T, K2, Fields[K2]>
}&{[vnodeType]: T}

    type DataRequestValue<T extends VNodeType, FieldName extends FieldNameFor<T>, boolType = true|false|boolean|undefined> = (
        FieldName extends keyof T["properties"] ? boolType :
        FieldName extends keyof T["virtualProperties"] ? DataRequestValueForVirtualProp<T["virtualProperties"][FieldName]> :
        {invalidKey: FieldName}
    );

        type DataRequestValueForVirtualProp<VP extends VirtualPropertyDefinition> = (
            VP extends VirtualManyRelationshipProperty ? DataRequestFields<VP["target"]> :
            VP extends VirtualOneRelationshipProperty ? {b: boolean} :
            {notAVirtualProp: VP}
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
}

////////////////////////////// VNode Data Result format /////////////////////////////////////////////////////////////



export type DataResult<Request extends DataRequest<any, any>> = (
    Request extends DataRequest<infer T, infer Fields> ?
        {[K in keyof Fields]: ResultFieldFor<T, Fields, K>}
    :
        {"error": "DataResult<> Couldn't infer DataRequest type parameters"}
);

    type ResultFieldFor<T extends VNodeType, Fields extends DataRequestFields<T>, K extends keyof Fields> = (
        K extends keyof T["properties"] ? 
            (
                boolean extends Fields[K] ? PropertyDataType<T["properties"], K>|undefined :
                true extends Fields[K] ? PropertyDataType<T["properties"], K> :
                undefined
            ) :
        K extends keyof T["virtualProperties"] ? VirtualPropertyDataType<T["virtualProperties"][K], Fields[K]> :
        never
    );

        type VirtualPropertyDataType<VP extends VirtualPropertyDefinition, Request> = (
            Request extends DataRequestValueForVirtualProp<VP> ? (
                VP extends VirtualManyRelationshipProperty ? (
                    Request extends DataRequestFields<VP["target"]> ? {[K in keyof Request]: ResultFieldFor<VP["target"], Request, K>}[] :
                    never
                ) :
                never
            ) :
            never
        );

////////////////////////////// Load VNode data from the graph ///////////////////////////////////////////////////////

/** Helper convenience function to create a fully typed DataRequest, which can be assigned to a variable */
export function DataRequest<T extends VNodeType, Fields extends DataRequestFields<T>>(tn: T, rq: Fields): DataRequest<T, Fields> {
    return {...rq, [vnodeType]: tn} as DataRequest<T, Fields>;
}

/**
 * Build a cypher query to load some data from the Neo4j graph database
 * @param request DataRequest, which determines the details and shape of the data being requested
 * @param args Arguments such as pimrary keys to filter by
 */
export function buildCypherQuery<Request extends DataRequest<VNodeType, any>>(rootRequest: Request, rootFilter: DataRequestFilter = {}): {query: string, params: {[key: string]: any}} {
    const rootNodeType = rootRequest[vnodeType];
    const label = rootNodeType.label;
    let query: string;
    const params: {[key: string]: any} = rootFilter.params || {};
    const workingVars = new Set(["_node"]);

    /** Generate a new variable name for the given node type that we can use in the Cypher query. */
    const generateNameFor = (nodeType: VNodeType): string => {
        let i = 1;
        let name = "";
        do {
            name = `_${nodeType.name.toLowerCase()}${i}`;
            i++;
        } while (workingVars.has(name));
        return name;
    };

    if (rootFilter.key === undefined) {
        query = `MATCH (_node:${label})\n`;
    } else {
        const key = rootFilter.key;
        if (key.length === 36) {
            // Look up by UUID.
            query = `MATCH (_node:${label} {uuid: $_nodeUuid})\n`;
            params._nodeUuid = key;
        } else if (key.length < 36) {
            if (rootNodeType.properties.shortId === undefined) {
                throw new Error(`The requested ${rootNodeType.name} VNode type doesn't use shortId.`);
            }
            query = `MATCH (_node:${label})<-[:IDENTIFIES]-(:ShortId {path: "${label}/" + $_nodeShortid})\n`;
            params._nodeShortid = key;
        } else {
            throw new Error("shortId must be shorter than 36 characters; UUID must be exactly 36 characters.");
        }
    }
    if (rootFilter.where) {
        query += `WHERE ${rootFilter.where.replace("@", "_node")}\n`;
    }

    

    // Build subqueries
    const addManyRelationshipSubquery = (propName: string, virtProp: VirtualManyRelationshipProperty, parentNodeVariable: string, request: DataRequestFields<VNodeType>): void => {
        const newTargetVar = generateNameFor(virtProp.target);
        workingVars.add(newTargetVar);
        query += `\nOPTIONAL MATCH ${virtProp.query.replace("@this", parentNodeVariable).replace("@target", newTargetVar)}\n`;
        // TODO: ordering of the subquery (WITH _node, ..., rel1 ORDER BY ...)

        // Add additional subqeries, if any:
        addVirtualPropsForNode(virtProp.target, newTargetVar, request);

        // Construct the WITH statement that ends this subquery
        workingVars.delete(newTargetVar);
        const rawPropertiesIncluded = (
            Object.keys(virtProp.target.properties)
            .filter(propName => request[propName] === true)
            .map(propName => `.${propName}`)
            .join(", ")
        );
        query += `WITH ${[...workingVars].join(", ")}, collect(${newTargetVar} {${rawPropertiesIncluded}}) AS ${propName}\n`;
        workingVars.add(propName);
    }

    const addVirtualPropsForNode = <VNT extends VNodeType>(nodeType: VNT, parentNodeVariable: string, request: DataRequestFields<VNT>): void => {
        // For each virtual prop:
        Object.entries(nodeType.virtualProperties).forEach(([propName, virtProp]) => {
            const thisRequest = request[propName];
            if (!thisRequest) {
                return;  // undefined or false - don't include this virtual property in the current data request
            }
            if (virtProp.type === VirtualPropType.ManyRelationship) {
                addManyRelationshipSubquery(propName, virtProp, parentNodeVariable, thisRequest as any);
            } else {
                throw new Error("Not implemented yet.");
                // TODO: Build computed virtual props, 1:1 virtual props
            }
        });
    }

    // Add subqueries:
    addVirtualPropsForNode(rootNodeType, "_node", rootRequest);

    // Build the final RETURN statement
    const rawPropertiesIncluded = (
        Object.keys(rootNodeType.properties)
        .filter(propName => rootRequest[propName] === true)
        .map(propName => `_node.${propName} AS ${propName}`)
    );
    // We remove _node (first one) from the workingVars because we never return _node directly, only the subset of 
    // its properties actually requested. But we've kept it around this long because it's used by virtual properties.
    workingVars.delete("_node");
    const finalVars = [...workingVars, ...rawPropertiesIncluded].join(", ") || "null";  // Or just return null if no variables are selected for return
    query += `\nRETURN ${finalVars}`;

    const orderBy = rootFilter.orderBy || rootNodeType.defaultOrderBy;
    if (orderBy) {
        query += ` ORDER BY _node.${orderBy}`;
    }

    return {query, params};
}

export async function pull<Request extends DataRequest<any, any>>(
    tx: WrappedTransaction,
    request: Request,
    filter: DataRequestFilter = {},
): Promise<DataResult<Request>[]> {
    const requestFields = Object.keys(request);
    const query = buildCypherQuery(request, filter);
    log.debug(query.query);

    const result = await tx.run(query.query, query.params);

    return result.records.map(record => {
        const newRecord: any = {};
        for (const field of requestFields) {
            if (request[field]) {
                newRecord[field] = record.get(field);
            }
        }
        return newRecord;
    });
}

export async function pullOne<Request extends DataRequest<any, any>>(
    tx: WrappedTransaction,
    request: Request,
    filter: DataRequestFilter = {},
): Promise<DataResult<Request>> {
    
    const result = await pull<Request>(tx, request, filter);

    if (result.length !== 1) {
        throw new Error(`Expected a single result, got ${result.length}`);
    }

    return result[0];
}
