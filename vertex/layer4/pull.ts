import { log } from "../lib/log";
import { BaseVNodeType, } from "../layer2/vnode-base";
import {
    VirtualManyRelationshipProperty,
    VirtualOneRelationshipProperty,
    VirtualCypherExpressionProperty,
    VirtualPropType,
    VirtualPropertyDefinition,
} from "./virtual-props";
import type { WrappedTransaction } from "../transaction";
import { CypherQuery } from "../layer2/cypher-sugar";
import { VNodeType, VNodeTypeWithVirtualProps } from "./vnode";
import { BaseDataRequest, DataRequestState } from "../layer3/data-request";
import { ConditionalRawPropsMixin, DerivedPropsMixin, VirtualPropsMixin } from "./data-request-mixins";
import type { DataResponse } from "./data-response";
import { conditionalRawPropsMixinImplementation, derivedPropsMixinImplementation, getConditionalRawPropsData, getDerivedPropsData, getProjectedVirtualPropsData, getVirtualPropsData, virtualPropsMixinImplementation } from "./data-request-mixins-impl";

type PullMixins<VNT extends VNodeType> = ConditionalRawPropsMixin<VNT> & VirtualPropsMixin<VNT> & DerivedPropsMixin<VNT>

/** Create an empty data request to use with pull() or pullOne() */
export function newDataRequest<VNT extends VNodeType>(vnodeType: VNT): BaseDataRequest<VNT, never, PullMixins<VNT>> {
    return DataRequestState.newRequest<VNT, PullMixins<VNT>>(vnodeType, [
        conditionalRawPropsMixinImplementation,
        virtualPropsMixinImplementation,
        derivedPropsMixinImplementation,
    ]);
}


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
export function buildCypherQuery<Request extends BaseDataRequest<any, any, any>>(_rootRequest: Request, rootFilter: DataRequestFilter = {}): {query: string, params: {[key: string]: any}} {
    const rootRequest: DataRequestState = DataRequestState.getInternalState(_rootRequest);
    const rootNodeType = rootRequest.vnodeType;
    const label = rootNodeType.label;
    let query: string;
    const params: {[key: string]: any} = {};
    const workingVars = new Set(["_node"]);

    /** Generate a new variable name for the given node type or property that we can use in the Cypher query. */
    const generateNameFor = (nodeTypeOrPropertyName: BaseVNodeType|string): string => {
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
    const addManyRelationshipSubquery = (variableName: string, virtProp: VirtualManyRelationshipProperty, parentNodeVariable: string, request: DataRequestState): void => {
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
    const addOneRelationshipSubquery = (variableName: string, virtProp: VirtualOneRelationshipProperty, parentNodeVariable: string, request: DataRequestState): void => {
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
    const addVirtualPropsForNode = (parentNodeVariable: string, request: DataRequestState, relationshipVariable?: string): VirtualPropertiesMap => {
        const virtPropsMap: VirtualPropertiesMap = {};
        // For each virtual prop:
        getVirtualPropertiesIncludedIn(request, rootFilter).forEach(({propName, propDefn, shapeData}) => {
            const virtProp = propDefn;
            const virtPropRequest = shapeData;
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

/** Create a read-only wrapper around an object to prevent modification */
function readOnlyView<T extends Record<string, any>>(x: T): Readonly<T> {
    return new Proxy(x, { set: () => false, defineProperty: () => false, deleteProperty: () => false }) as Readonly<T>;
}

/**
 * Recursively add "derived properties" to the interim result from a call to pull() data from the database.
 * Derived properties have access to the raw+virtual properties that have been pulled so far.
 * 
 * This function adds fields to the "resultData" argument.
 */
function addDerivedPropertiesToResult(resultData: any, requestData: DataRequestState, filter: DataRequestFilter): void {
    const derivedProperties = getDerivedPropertiesIncludedIn(requestData, filter);
    const vnodeType = (requestData.vnodeType as VNodeType);

    if (derivedProperties.length > 0) {
        const dataSoFar = readOnlyView(resultData);  // Don't allow the derived property implementation to mutate this directly
        for (const propName of derivedProperties) {
            resultData[propName] = vnodeType.derivedProperties[propName].computeValue(dataSoFar);
        }
    }
    // Now recursively handle derived properties for any virtual -to-many or -to-one relationships included in the result:
    getVirtualPropertiesIncludedIn(requestData, filter).forEach(({propName, propDefn, shapeData}) => {
        if (!shapeData) {
            return;
        }
        if (propDefn.type === VirtualPropType.ManyRelationship) {
            resultData[propName].forEach((subResultData: any) => {
                addDerivedPropertiesToResult(subResultData, shapeData, filter);
            });
        } else if (propDefn.type === VirtualPropType.OneRelationship) {
            addDerivedPropertiesToResult(resultData[propName], shapeData, filter);
        }
    });
}

export function pull<VNT extends VNodeType, Request extends BaseDataRequest<VNT, any, any>>(
    tx: WrappedTransaction,
    vnt: VNT,
    request: ((builder: BaseDataRequest<VNT, never, PullMixins<VNT>>) => Request),
    filter?: DataRequestFilter,
): Promise<DataResponse<Request>[]>;

export function pull<Request extends BaseDataRequest<any, any, any>>(
    tx: WrappedTransaction,
    request: Request,
    filter?: DataRequestFilter,
): Promise<DataResponse<Request>[]>;

export async function pull(tx: WrappedTransaction, arg1: any, arg2?: any, arg3?: any): Promise<any> {
    const request: BaseDataRequest<VNodeTypeWithVirtualProps> = typeof arg2 === "function" ? arg2(newDataRequest(arg1)) : arg1;
    const requestData: DataRequestState = DataRequestState.getInternalState(request);
    const vnodeType = (requestData.vnodeType as VNodeType);
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
        // Add derived properties, which may use the raw+virtual properties in their computation:
        addDerivedPropertiesToResult(newRecord, requestData, filter);
        return newRecord;
    });
}

export function pullOne<VNT extends VNodeType, Request extends BaseDataRequest<VNT, any, any>>(
    tx: WrappedTransaction,
    vnt: VNT,
    request: ((builder: BaseDataRequest<VNT, never, PullMixins<VNT>>) => Request),
    filter?: DataRequestFilter,
): Promise<DataResponse<Request>>;

export function pullOne<Request extends BaseDataRequest<any, any, any>>(
    tx: WrappedTransaction,
    request: Request,
    filter?: DataRequestFilter,
): Promise<DataResponse<Request>>;

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
        <VNT extends VNodeType, Request extends BaseDataRequest<VNT, any, any>>(
            vnt: VNT,
            request: ((builder: BaseDataRequest<VNT, never, PullMixins<VNT>>) => Request),
            filter?: DataRequestFilter,
        ) => Promise<DataResponse<Request>[]>
    ) & (
        <Request extends BaseDataRequest<any, any, any>>(
            request: Request,
            filter?: DataRequestFilter,
        ) => Promise<DataResponse<Request>[]>
    )
);

export type PullOneNoTx = (
    (
        <VNT extends VNodeType, Request extends BaseDataRequest<VNT, any, any>>(
            vnt: VNT,
            request: ((builder: BaseDataRequest<VNT, never, PullMixins<VNT>>) => Request),
            filter?: DataRequestFilter,
        ) => Promise<DataResponse<Request>>
    ) & (
        <Request extends BaseDataRequest<any, any, any>>(
            request: Request,
            filter?: DataRequestFilter,
        ) => Promise<DataResponse<Request>>
    )
);


/**
 * Helper function: given a VNodeDataRequest and filter options, lists all the raw (non-virtual) properties of the VNode
 * that should be included in the data request. The properties will be returned in an ordered array, in the order that
 * the properties were declared on the VNode type definition.
 * @param request 
 * @param filter 
 */
function getRawPropertiesIncludedIn(request: DataRequestState, filter: DataRequestFilter): string[] {

    const conditionalProperties = getConditionalRawPropsData(request);

    return Object.keys(request.vnodeType.properties).filter(propName =>
        // Include this raw property if it was requested:
        request.includedProperties.includes(propName) ||
        // Or if it was requested conditionally, include it if the relevant flag is set in the filter:
        (conditionalProperties[propName] !== undefined && filter.flags?.includes(conditionalProperties[propName]))
    );
}

/**
 * Helper function: given a VNodeDataRequest and filter options, lists all the virtual properties of the VNode
 * that should be included in the data request. The properties will be returned in an ordered array, in the order that
 * the virtual properties were declared on the VNode type definition. They are returned as tuples of
 * [propKey, propDefinition]
 */
function getVirtualPropertiesIncludedIn(request: DataRequestState, filter: DataRequestFilter): Array<{propName: string, propDefn: VirtualPropertyDefinition, shapeData: DataRequestState|undefined}> {
    // Determine what virtual properties are available, in the order declared:
    const virtPropsAvailable = (request.vnodeType as VNodeTypeWithVirtualProps).virtualProperties
    const projectedVirtualPropertiesAvailable = getProjectedVirtualPropsData(request);
    const keys = Object.keys(virtPropsAvailable);
    keys.push(...Object.keys(projectedVirtualPropertiesAvailable));
    // Determine what virtual properties were now requested in this data request:
    const requested = getVirtualPropsData(request);
    return keys.filter(propName =>
        propName in requested && (
            requested[propName].ifFlag ?
                // Conditionally include this virtual prop, if a flag is set in the filter:
                filter.flags?.includes(requested[propName].ifFlag as string)
            :
                true
        )
    ).map(propName => ({
        propName,
        propDefn: virtPropsAvailable[propName] || projectedVirtualPropertiesAvailable[propName],
        shapeData: requested[propName].shapeData,
    }));
}

/**
 * Helper function: given a VNodeDataRequest and filter options, lists all the raw and virtual properties of the VNode
 * that should be included in the data request. The properties will be returned in an ordered array, in the order that
 * the properties were declared on the VNode type definition (first raw properties, then virtual properties).
 *
 * This method does not return derived fields; only raw and virtual.
 */
function getAllPropertiesIncludedIn(request: DataRequestState, filter: DataRequestFilter): string[] {
    return [
        ...getRawPropertiesIncludedIn(request, filter),
        ...getVirtualPropertiesIncludedIn(request, filter).map(v => v.propName),
    ];
}

function getDerivedPropertiesIncludedIn(request: DataRequestState, filter: DataRequestFilter): string[] {
    const keys = Object.keys((request.vnodeType as VNodeType).derivedProperties);
    const requested = getDerivedPropsData(request);
    return keys.filter(propName =>
        propName in requested && (
            requested[propName].ifFlag ?
                // Conditionally include this derived prop, if a flag is set in the filter:
                filter.flags?.includes(requested[propName].ifFlag as string)
            :
                true
        )
    );
}