// deno-lint-ignore-file no-explicit-any
import { looksLikeVNID } from "../lib/types/vnid.ts";
import { BaseVNodeType, } from "../layer2/vnode-base.ts";
import {
    VirtualManyRelationshipProperty,
    VirtualOneRelationshipProperty,
    VirtualCypherExpressionProperty,
    VirtualPropType,
} from "./virtual-props.ts";
import type { WrappedTransaction } from "../transaction.ts";
import { VNodeType, VNodeTypeWithVirtualProps } from "./vnode.ts";
import { AnyDataRequest, BaseDataRequest, DataRequestState, RequiredMixin } from "../layer2/data-request.ts";
import { ConditionalPropsMixin, DerivedPropsMixin, SubclassMixins, VirtualPropsMixin } from "./data-request-mixins.ts";
import type { DataResponse } from "./data-response.ts";
import {
    conditionalRawPropsMixinImplementation,
    derivedPropsMixinImplementation,
    includeDependenciesFlag,
    virtualPropsMixinImplementation,
} from "./data-request-mixins-impl.ts";
import { DerivedProperty } from "./derived-props.ts";
import { DataRequestFilter, FilteredRequest } from "./data-request-filtered.ts";
import { convertNeo4jFieldValue } from "../layer2/cypher-return-shape.ts";
import { EmptyResultError, TooManyResultsError } from "../layer2/query.ts";

type PullMixins<VNT extends VNodeType> = ConditionalPropsMixin<VNT> & VirtualPropsMixin<VNT> & DerivedPropsMixin<VNT> & RequiredMixin;
// This alias seems to confuse TypeScript 4.2:
//type BlankDataRequest<VNT extends VNodeType> = BaseDataRequest<VNT, never, PullMixins<VNT>>;

/** Create an empty data request to use with pull() or pullOne() */
export function newDataRequest<VNT extends VNodeType>(vnodeType: VNT): BaseDataRequest<VNT, never, PullMixins<VNT>> {
    return DataRequestState.newRequest<VNT, PullMixins<VNT>>(vnodeType, [
        conditionalRawPropsMixinImplementation,
        virtualPropsMixinImplementation,
        derivedPropsMixinImplementation,
    ]);
}

type ConvertVNodeType<DataRequest, NewType extends VNodeType> = (
    DataRequest extends BaseDataRequest<infer VNT, infer rawProps, infer Mixins> ?
        BaseDataRequest<NewType, rawProps, SubclassMixins<Mixins, VNT extends VNodeType ? VNT : never, NewType>>
    :
        never
);

// TODO: Add tests for subclassDataRequest()
export function subclassDataRequest<
    VNT extends VNodeType,
    Subclass extends VNT,
    OrigRequest extends AnyDataRequest<VNT>
>(origRequest: OrigRequest, subclassVnodeType: Subclass): ConvertVNodeType<OrigRequest, Subclass> {
    return DataRequestState.getInternalState(origRequest).cloneForSubClass(subclassVnodeType);
}


/**
 * Build a cypher query to load some data from the Neo4j graph database
 * @param _rootRequest VNodeDataRequest, which determines the shape of the data being requested
 * @param rootFilter Arguments such as primary keys to filter by, which determine what nodes are included in the response
 */
export function buildCypherQuery(rootRequest: FilteredRequest): {query: string, params: {[key: string]: any}} {
    // const rootRequest: DataRequestState = _rootRequest.requestState;
    const rootNodeType = rootRequest.vnodeType;
    const rootFilter = rootRequest.filter;
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
        if (looksLikeVNID(key)) {
            // Look up by VNID.
            query = `MATCH (_node:${label}:VNode {id: $_nodeVNID})\n`;
            params._nodeVNID = key;
        } else {
            if (rootNodeType.properties.slugId === undefined) {
                throw new Error(`The requested ${rootNodeType.name} VNode type doesn't use slugId.`);
            }
            query = `MATCH (_node:${label}:VNode)<-[:IDENTIFIES]-(:SlugId {slugId: $_nodeSlugId})\n`;
            params._nodeSlugId = key;
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
    const addManyRelationshipSubquery = (variableName: string, virtProp: VirtualManyRelationshipProperty, parentNodeVariable: string, request: FilteredRequest): void => {
        const targetVNT = virtProp.target as any as VNodeType;  // Typing of this is a bit weird, to allow the optional VNodeType.hasVirtualProperties() method to work without circular type issues.
        const newTargetVar = generateNameFor(targetVNT);
        workingVars.add(newTargetVar);
        const matchedPathVar = generateNameFor("path");  // We have to include the matched path to the target node as one of the working variables, or different paths to the same node can get combined by aggreggation functions operating on child nodes, creating incorrect results.
        workingVars.add(matchedPathVar);
        if (Object.keys(virtProp.query.params).length) {
            throw new Error(`A virtual property query clause cannot have parameters.`);
            // ^ This could be supported in the future though, if useful.
        }
        let matchClause = (
            virtProp.query.queryString
            .replace(/@this/g, parentNodeVariable)
            .replace(/@target/g, newTargetVar)
        );
        // If (one of) the relationship(s) in the MATCH (@self)-...relationships...-(@target) expression is named via the @rel placeholder,
        // then replace that with a variable that can be used to fetch properties from the relationship or sort by them.
        let relationshipVariable: string|undefined;
        if (matchClause.includes("@rel")) {
            relationshipVariable = generateNameFor("rel");
            workingVars.add(relationshipVariable);
            matchClause = matchClause.replace(/@rel/g, relationshipVariable);
        }
        query += `\nOPTIONAL MATCH ${matchedPathVar} = ${matchClause}\n`;

        // Add additional subqeries, if any:
        const virtPropsMap = addVirtualPropsForNode(newTargetVar, request, relationshipVariable);

        // Order the results of this subquery (has to happen immediately before the WITH...collect() line):
        const orderBy = virtProp.defaultOrderBy || targetVNT.defaultOrderBy;
        if (orderBy) {
            // TODO: allow ordering by properties of the relationship
            const orderExpression = orderBy.replace(/@this/g, newTargetVar).replace("@rel", relationshipVariable || "@rel");
            query += `WITH ${[...workingVars].join(", ")} ORDER BY ${orderExpression}\n`;
        }
        // Construct the WITH statement that ends this subquery, collect()ing many related nodes into a single array property
        workingVars.delete(newTargetVar);
        workingVars.delete(matchedPathVar);
        if (relationshipVariable) {
            workingVars.delete(relationshipVariable);
        }
        const variablesIncluded = request.rawPropertiesIncluded.map(p => "." + p);
        // Pull in the virtual properties included:
        for (const [pName, varName] of Object.entries(virtPropsMap)) {
            workingVars.delete(varName);
            variablesIncluded.push(`${pName}: ${varName}`);  // This re-maps our temporary variable like "friends_1" into its final name like "friends"
        }
        query += `WITH ${[...workingVars].join(", ")}, collect(${newTargetVar} {${variablesIncluded.join(", ")}}) AS ${variableName}\n`;
        workingVars.add(variableName);
    }

    /** Add an subquery clause to join each current node to at most one other node via some x:one relationship */
    const addOneRelationshipSubquery = (variableName: string, virtProp: VirtualOneRelationshipProperty, parentNodeVariable: string, request: FilteredRequest): void => {

        // [Due to a bug with Cypher subqueries and path variables?] It's sometimes necessary to put a WITH clause first:
        // See https://community.neo4j.com/t/strange-behavior-of-path-variables-with-call-subquery/29810
        if ([...workingVars].find(varName => varName.includes("path"))) {
            query += `WITH ${[...workingVars].join(", ")}\n`;
        }

        const newTargetVar = generateNameFor(virtProp.target as any as VNodeType);
        workingVars.add(newTargetVar);

        if (Object.keys(virtProp.query.params).length) {
            throw new Error(`A virtual property query clause cannot have parameters.`);
            // ^ This could be supported in the future though, if useful.
        }

        // Unfortunately, the database doesn't actually enforce that this is a 1:1 relationship, so we use this subquery
        // to limit the OPTIONAL MATCH to one node at most. According to PROFILE, this way of doing it only adds 1 "db hit"
        query += `\nCALL {\n`;
        query += `    WITH ${parentNodeVariable}\n`;
        query += `    OPTIONAL MATCH ${virtProp.query.queryString.replace(/@this/g, parentNodeVariable).replace(/@target/g, newTargetVar)}\n`;
        query += `    RETURN ${newTargetVar} LIMIT 1\n`;
        query += `}\n`;

        // Add additional subqeries, if any:
        const virtPropsMap = addVirtualPropsForNode(newTargetVar, request);

        // Construct the WITH statement that ends this subquery
        workingVars.delete(newTargetVar);
        const variablesIncluded = request.rawPropertiesIncluded.map(p => "." + p);
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

        const cypherExpression = virtProp.cypherExpression.queryString.replace(/@this/g, parentNodeVariable).replace(/@rel/g, relationshipVariable || "@rel");

        query += `WITH ${[...workingVars].join(", ")}, (${cypherExpression}) AS ${variableName}\n`;
        workingVars.add(variableName);
    }

    type VirtualPropertiesMap = {[propName: string]: string};
    // Add subqueries for each of this node's virtual properties.
    // Returns a map that maps from the virtual property's name (e.g. "friends") to the variable name/placeholder used
    // in the query (e.g. "friends_1")
    const addVirtualPropsForNode = (parentNodeVariable: string, request: FilteredRequest, relationshipVariable?: string): VirtualPropertiesMap => {
        const virtPropsMap: VirtualPropertiesMap = {};
        // For each virtual prop:
        request.virtualPropertiesIncluded.forEach(({propName, propDefn, subRequest}) => {
            const virtProp = propDefn;
            const variableName = generateNameFor(propName);
            virtPropsMap[propName] = variableName;
            if (virtProp.type === VirtualPropType.ManyRelationship) {
                if (subRequest === undefined) { throw new Error(`Missing sub-request for x:many virtProp "${propName}"!`); }
                addManyRelationshipSubquery(variableName, virtProp, parentNodeVariable, subRequest);
            } else if (virtProp.type === VirtualPropType.OneRelationship) {
                if (subRequest === undefined) { throw new Error(`Missing sub-request for x:one virtProp "${propName}"!`); }
                addOneRelationshipSubquery(variableName, virtProp, parentNodeVariable, subRequest);
            } else if (virtProp.type === VirtualPropType.CypherExpression) {
                addCypherExpression(variableName, virtProp, parentNodeVariable, relationshipVariable);
            } else {
                throw new Error("Unknown/unimplemented virtual property type.");
            }
        });
        return virtPropsMap;
    }

    // Add subqueries:
    const virtPropMap = addVirtualPropsForNode("_node", rootRequest);

    // Build the final RETURN statement
    const rawPropertiesIncluded = rootRequest.rawPropertiesIncluded.map(propName => `_node.${propName} AS ${propName}`);
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
        query += ` ORDER BY ${orderBy.replace(/@this/g, "_node")}`;
    }

    return {query, params};
}

/** Create a read-only wrapper around an object to prevent modification */
function readOnlyView<T extends Record<string, any>>(x: T): Readonly<T> {
    return new Proxy(x, { set: () => false, defineProperty: () => false, deleteProperty: () => false }) as Readonly<T>;
}

export function pull<VNT extends VNodeType, Request extends AnyDataRequest<VNT>>(
    tx: WrappedTransaction,
    vnt: VNT,
    request: ((builder: BaseDataRequest<VNT, never, PullMixins<VNT>>) => Request),
    filter?: DataRequestFilter,
): Promise<DataResponse<Request>[]>;

export function pull<Request extends AnyDataRequest<any>>(
    tx: WrappedTransaction,
    request: Request,
    filter?: DataRequestFilter,
): Promise<DataResponse<Request>[]>;

export async function pull(tx: WrappedTransaction, arg1: any, arg2?: any, arg3?: any): Promise<any> {
    const request: BaseDataRequest<VNodeTypeWithVirtualProps> = typeof arg2 === "function" ? arg2(newDataRequest(arg1)) : arg1;
    const filter: DataRequestFilter = (typeof arg2 === "function" ? arg3 : arg2) || {};
    const filteredRequest = new FilteredRequest(request, filter);
    const filteredRequestWithDependencies = new FilteredRequest(request, {...filter, flags: [...filter.flags ?? [], includeDependenciesFlag]})
    
    const query = buildCypherQuery(filteredRequestWithDependencies);
    //log.debug(query.query);
    
    const result = await tx.run(query.query, query.params);

    // Now recursively convert data types, add derived fields, and remove any interim fields that we needed but weren't explicitly requested:
    return result.records.map(record => {
        // The top-level entries in the result (but only the top level entries) need to be converted from 'Record' type to plain JS objects:
        let obj = Object.fromEntries(record.entries());
        //log.debug(`Raw result: ${JSON.stringify(obj)}\n`);
        obj = postProcessResultDataTypes(obj, filteredRequestWithDependencies);
        return postProcessResult(obj, filteredRequest)
    });
}

/**
 * Recursive helper function to convert data types from Neo4j result types to Vertex Framework Field Types
 */
function postProcessResultDataTypes(origResult: Readonly<Record<string, any>>, request: FilteredRequest): Record<string, any> {
    const newResult: any = {}
    // First add any raw fields to the new result:
    request.rawPropertiesIncluded.forEach(propName => {
        // Convert as needed from Neo4j types to Vertex Framework types, e.g. bigint -> number, Neo4jDate -> VDate:
        newResult[propName] = convertNeo4jFieldValue(propName, origResult[propName], request.vnodeType.properties[propName]);
    });

    // Now recursively handle virtual properties included in the result:
    request.virtualPropertiesIncluded.forEach(({propName, propDefn, subRequest}) => {
        if (propDefn.type === VirtualPropType.ManyRelationship) {
            if (subRequest === undefined) { throw new Error(`unexpectedly missing subrequest`); /* Just to appease TypeScript */ }
            newResult[propName] = origResult[propName].map((subResultData: any) =>
                postProcessResult(subResultData, subRequest)
            );
        } else if (propDefn.type === VirtualPropType.OneRelationship) {
            if (origResult[propName] === null) {
                newResult[propName] = null;
            } else {
                if (subRequest === undefined) { throw new Error(`unexpectedly missing subrequest`); /* Just to appease TypeScript */ }
                newResult[propName] = postProcessResult(origResult[propName], subRequest);
            }
        } else {
            // A cypher expression field
            newResult[propName] = convertNeo4jFieldValue(propName, origResult[propName], propDefn.valueType);
        }
        //log.debug(` -> newresult[${propName}] = ${JSON.stringify(newResult[propName])} from ${JSON.stringify(origResult[propName])}`);
    });

    return newResult;
}

/**
 * Recursive helper function to (1) add in any derived properties requested, and (2) remove and fields that were
 * required to compute derived properties but were not explicitly requested.
 */
function postProcessResult(origResult: Readonly<Record<string, any>>, request: FilteredRequest): Record<string, any> {
    const newResult: any = {}
    // First add any explicitly requested raw fields to the new result:
    request.rawPropertiesIncluded.forEach(propName => newResult[propName] = origResult[propName]);

    // Now recursively handle virtual properties included in the result:
    request.virtualPropertiesIncluded.forEach(({propName, propDefn, subRequest}) => {
        if (propDefn.type === VirtualPropType.ManyRelationship) {
            if (subRequest === undefined) { throw new Error(`unexpectedly missing subrequest`); /* Just to appease TypeScript */ }
            newResult[propName] = origResult[propName].map((subResultData: any) =>
                postProcessResult(subResultData, subRequest)
            );
        } else if (propDefn.type === VirtualPropType.OneRelationship) {
            if (origResult[propName] === null) {
                newResult[propName] = null;
            } else {
                if (subRequest === undefined) { throw new Error(`unexpectedly missing subrequest`); /* Just to appease TypeScript */ }
                newResult[propName] = postProcessResult(origResult[propName], subRequest);
            }
        } else {
            newResult[propName] = origResult[propName];
        }
        //log.debug(` -> newresult[${propName}] = ${JSON.stringify(newResult[propName])} from ${JSON.stringify(origResult[propName])}`);
    });

    // Then add derived properties to the result. They have access to all the data in the original result, which may
    // include "dependency" properties that we have excluded from newResult.
    const derivedProperties = request.derivedPropertiesIncluded;
    if (derivedProperties.length > 0) {
        const dataSoFar = readOnlyView(origResult);  // Don't allow the derived property implementation to mutate this directly
        for (const propName of derivedProperties) {
            const derivedProp = request.vnodeType.derivedProperties[propName];
            if (!(derivedProp instanceof DerivedProperty)) {
                throw new Error(`Derived property ${request.vnodeType.name}.${propName} is invalid. Is the class not decorated with @VNodeType.declare ?`);
            }
            newResult[propName] = derivedProp.computeValue(dataSoFar);
        }
    }

    return newResult;
}


export function pullOne<VNT extends VNodeType, Request extends AnyDataRequest<VNT>>(
    tx: WrappedTransaction,
    vnt: VNT,
    request: ((builder: BaseDataRequest<VNT, never, PullMixins<VNT>>) => Request),
    filter?: DataRequestFilter,
): Promise<DataResponse<Request>>;

export function pullOne<Request extends AnyDataRequest<any>>(
    tx: WrappedTransaction,
    request: Request,
    filter?: DataRequestFilter,
): Promise<DataResponse<Request>>;

export async function pullOne(tx: WrappedTransaction, arg1: any, arg2?: any, arg3?: any): Promise<any> {
    const result = await pull(tx, arg1, arg2, arg3);

    if (result.length === 0) {
        throw new EmptyResultError();
    } else if (result.length !== 1) {
        throw new TooManyResultsError(`Expected a single result, got ${result.length}`);
    }

    return result[0];
}

// These types match the overload signature for pull(), but have no "tx" parameter; used in WrappedTransaction and Vertex for convenience.
export type PullNoTx = (
    (
        <VNT extends VNodeType, Request extends AnyDataRequest<VNT>>(
            vnt: VNT,
            request: ((builder: BaseDataRequest<VNT, never, PullMixins<VNT>>) => Request),
            filter?: DataRequestFilter,
        ) => Promise<DataResponse<Request>[]>
    ) & (
        <Request extends AnyDataRequest<any>>(
            request: Request,
            filter?: DataRequestFilter,
        ) => Promise<DataResponse<Request>[]>
    )
);

export type PullOneNoTx = (
    (
        <VNT extends VNodeType, Request extends AnyDataRequest<VNT>>(
            vnt: VNT,
            request: ((builder: BaseDataRequest<VNT, never, PullMixins<VNT>>) => Request),
            filter?: DataRequestFilter,
        ) => Promise<DataResponse<Request>>
    ) & (
        <Request extends AnyDataRequest<any>>(
            request: Request,
            filter?: DataRequestFilter,
        ) => Promise<DataResponse<Request>>
    )
);
