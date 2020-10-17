import { VertexCore } from "./vertex-interface";
import { log } from "./lib/log";
import {
    PropertyDataType,
    VNodeType,
    VirtualManyRelationshipProperty,
    VirtualOneRelationshipProperty,
    VirtualPropertyDefinition,
    VirtualPropType,
} from "./vnode";
import { WrappedTransaction } from "./transaction";

////////////////////////////// VNode Data Request format ////////////////////////////////////////////////////////////

type RecursiveVirtualPropRequestManySpec<propType extends VirtualManyRelationshipProperty, Spec extends NewDataRequest<propType["target"], any, any, any>> = {
    ifFlag: string|undefined,
    spec: Spec,
};

type RecursiveVirtualPropRequest<VNT extends VNodeType> = {
    [K in keyof VNT["virtualProperties"]]?: (
        VNT["virtualProperties"][K] extends VirtualManyRelationshipProperty ?
            RecursiveVirtualPropRequestManySpec<VNT["virtualProperties"][K], any> :
        never
    )
}

type NDR_AddAllProps<
    VNT extends VNodeType,
    rawProps extends keyof VNT["properties"],
    maybeRawProps extends keyof VNT["properties"],
    virtualPropSpec extends RecursiveVirtualPropRequest<VNT>,
> = {
    allProps: NewDataRequest<VNT, keyof VNT["properties"], maybeRawProps, virtualPropSpec>
};

type NDR_AddRawProp<
    VNT extends VNodeType,
    rawProps extends keyof VNT["properties"],
    maybeRawProps extends keyof VNT["properties"],
    virtualPropSpec extends RecursiveVirtualPropRequest<VNT>,
> = {
    [K in keyof VNT["properties"]/* as Exclude<K, rawProps|maybeRawProps>*/]: NewDataRequest<VNT, rawProps|K, maybeRawProps, virtualPropSpec>
};

type NDR_AddFlags<
    VNT extends VNodeType,
    rawProps extends keyof VNT["properties"],
    maybeRawProps extends keyof VNT["properties"],
    virtualPropSpec extends RecursiveVirtualPropRequest<VNT>,
> = {
    [K in keyof VNT["properties"] as `${K}IfFlag`]: (flagName: string) => NewDataRequest<VNT, rawProps, maybeRawProps|K, virtualPropSpec>
};

type NDR_AddVirtualProp<
    VNT extends VNodeType,
    rawProps extends keyof VNT["properties"],
    maybeRawProps extends keyof VNT["properties"],
    virtualPropSpec extends RecursiveVirtualPropRequest<VNT>,
> = {
    [K in keyof VNT["virtualProperties"]]: (
        VNT["virtualProperties"][K] extends VirtualManyRelationshipProperty ?
            <SubSpec extends NewDataRequest<VNT["virtualProperties"][K]["target"]>, FlagType extends string|undefined = undefined>
            (subRequest: (emptyRequest: NewDataRequest<VNT["virtualProperties"][K]["target"]>) => SubSpec, options?: {ifFlag: FlagType})
            => NewDataRequest<VNT, rawProps, maybeRawProps, virtualPropSpec&{[K2 in K]: {ifFlag: FlagType, spec: SubSpec}}>
        : never
    )
};

type NewDataRequest<
    VNT extends VNodeType,
    rawProps extends keyof VNT["properties"] = never,
    maybeRawProps extends keyof VNT["properties"] = never,
    virtualPropSpec extends RecursiveVirtualPropRequest<VNT> = {}
> = (
    // Each NewDataRequest has a .allProps attribute which requests all raw properties and returns the same request object
    NDR_AddAllProps<VNT, rawProps, maybeRawProps, virtualPropSpec> &
    // For each raw field like "uuid", the data request has a .uuid attribute which requests that field and returns the same request object
    NDR_AddRawProp<VNT, rawProps, maybeRawProps, virtualPropSpec> &
    // For each raw field like "uuid", the data request has a .uuidIfFlag() method which conditionally requests that field
    NDR_AddFlags<VNT, rawProps, maybeRawProps, virtualPropSpec> &
    // For each virtual property of the VNodeType, there is a .propName(p => p...) method for requesting it.
    NDR_AddVirtualProp<VNT, rawProps, maybeRawProps, virtualPropSpec>
);



export function NewDataRequest<VNT extends VNodeType>(vnt: VNT): NewDataRequest<VNT, never, never> {
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
