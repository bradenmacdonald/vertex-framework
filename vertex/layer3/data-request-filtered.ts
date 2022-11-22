// deno-lint-ignore-file no-explicit-any
import { BaseVNodeType, } from "../layer2/vnode-base.ts";
import {
    VirtualPropertyDefinition,
} from "./virtual-props.ts";
import { CypherQuery } from "../layer2/cypher-sugar.ts";
import { VNodeType } from "./vnode.ts";
import { BaseDataRequest, DataRequestState } from "../layer2/data-request.ts";
import {
    ConditionalRequest,
    getConditionalRawPropsData,
    getDerivedPropsData,
    getProjectedVirtualPropsData,
    getVirtualPropsData,
} from "./data-request-mixins-impl.ts";
import { VNID } from "../lib/types/vnid.ts";



/**
 * A Data Request specifies the shape (data types) and properties that should be retrieved from the graph database.
 * This DataRequestFilter specifies things other than the shape, such as ordering, filtering base on some criteria
 * (WHERE ...), pagination, and which conditionally included (flagged) properties to include.
 */
export interface DataRequestFilter<AllowedPropertyKeys extends string = string> {
    /** ID: If specified, the main node must have a VNID that is equal to this. */
    id?: VNID;
    /** @deprecated Key: Lookup a node by VNID. Use 'id' instead. */
    key?: VNID;
    /**
     * Filter the main node(s) of this data request to only those with properties that exactly match these
     * e.g. { with: {username: "joe"} }
     *
     * IMPORTANT: they keys are inserted into the query unescaped, so never put user input in the keys of this option.
     */
    with?: Partial<Record<AllowedPropertyKeys, unknown>>
    /**
     * Filter the main node(s) of this data request to only those that match this predicate.
     * 
     * Examples:
     * - `@this.name = ${name}`
     * - `@this.dateOfbirth < date("2002-01-01")`
     * - `EXISTS { MATCH (@)-->(m) WHERE @this.age = m.age }`
     */
    where?: CypherQuery;
    /** Order the results by one of the properties (e.g. "name" or "name DESC") */
    orderBy?: string;
    /** A list of flags that determines which flagged/conditional properties should get included in the response */
    flags?: (string|symbol)[];

    // Subfilters allow specifying key/where filters and ordering on virtual properties. Note that "flags" are global
    // for the entire request, so you cannot specify different flags for a subfilter.
    subFilters?: {[virtualPropName: string]: Omit<DataRequestFilter, "flags">}
}

function getSubFilter(parentFilter: DataRequestFilter, virtualPropName: string): DataRequestFilter {
    const subFilterWithoutFlags = parentFilter?.subFilters ? parentFilter.subFilters[virtualPropName] : {};
    return {
        ...subFilterWithoutFlags,
        flags: parentFilter.flags,  // Flags are shared for the entire request; they don't vary per virtual property
    };
}


/**
 * The DataRequest always fully determines the shape (data types) that will be returned from a response, although some
 * "conditional" (flagged) properties may be optional.
 *
 * The filter does not affect the shape (other than specifying which optional properties get included or not), but does
 * determine which records / how many records get returned.
 * 
 * Combining the DataRequest and Filter gives the complete options needed for a request.
 */
export class FilteredRequest {
    readonly request: BaseDataRequest<BaseVNodeType, any, any>;
    readonly filter: DataRequestFilter;

    constructor(request: BaseDataRequest<BaseVNodeType, any, any>, filter: DataRequestFilter) {
        this.filter = filter;
        // At this point, we know enough to determine which "conditional" (flagged) raw/virtual/derived properties will
        // be included in the request or not:

        const addConditionalProperties = (conditionalProperties: ConditionalRequest[]): void => {
            for (const conditionalProp of conditionalProperties) {
                if (this.filter.flags?.includes(conditionalProp.flagName)) {
                    // This conditional property/properties should be included, because their flag is set.
                    // We call the provided function, which adds additional fields to the request.
                    request = conditionalProp.conditionalRequest(request);
                }
            }
        };

        const conditionalProperties = getConditionalRawPropsData(DataRequestState.getInternalState(request));
        addConditionalProperties(conditionalProperties);

        // If we just conditionally added derived properties, they may have added some additional dependencies
        // to "request" conditionally, so "conditionalProperties" may now be longer, and we need to process those too:
        const additionalConditionalProperties = (
            getConditionalRawPropsData(DataRequestState.getInternalState(request))
        ).slice(conditionalProperties.length);
        addConditionalProperties(additionalConditionalProperties);

        this.request = request;
    }

    /** Get the internal data within the request. */
    get requestState(): DataRequestState {
        return DataRequestState.getInternalState(this.request);
    }

    get vnodeType(): VNodeType {
        const baseType: BaseVNodeType = this.requestState.vnodeType;
        return baseType as VNodeType;  // Some type casting is required
    }

    /**
     * Get the raw properties of the VNode that should be included in this request, including any that were
     * "conditional" on a flag that was specified in the filter.
     */
    get rawPropertiesIncluded(): string[] {
        return Object.keys(this.vnodeType.properties).filter(propName =>
            this.requestState.includedProperties.includes(propName)
        );
    }

    /**
     * List all the virtual properties of the VNode that should be included in the data request. The properties will be
     * returned in an ordered array, in the order that the virtual properties were declared on the VNodeType definition.
     */
    get virtualPropertiesIncluded(): Array<{propName: string, propDefn: VirtualPropertyDefinition, subRequest: FilteredRequest|undefined}> {
        // Determine what virtual properties are available, in the order declared:
        const virtPropsAvailable = this.vnodeType.virtualProperties;
        const projectedVirtualPropertiesAvailable = getProjectedVirtualPropsData(this.requestState);
        const keys = Object.keys(virtPropsAvailable);
        keys.push(...Object.keys(projectedVirtualPropertiesAvailable));
        // Determine what virtual properties were now requested in this data request:
        const requested = getVirtualPropsData(this.requestState);
        return keys.filter(propName => propName in requested).map(propName => {
            const propDefn = virtPropsAvailable[propName] || projectedVirtualPropertiesAvailable[propName];
            if (propDefn === undefined) {
                throw new Error(`Internal error building virtual prop: ${this.vnodeType.name}.${propName}: can't find property definition`);
            }
            let subRequest: FilteredRequest|undefined;
            if (requested[propName].subRequest) {
                // Build the FilteredRequest specific to this virtual prop, saying which of its properties we want to include
                const subFilter = getSubFilter(this.filter, propName);  // A different "subfilter" may apply
                subRequest = new FilteredRequest(requested[propName].subRequest, subFilter);
            }
            return {propName, propDefn, subRequest};
        });
    }

    /**
     * List all the "derived" properties of the VNode that should be included in the data request.
     * 
     * Derived properties can depend on other properties, but their dependencies are already added by
     * derivedPropsMixinImplementation as soon as a derived property is added to a request. 
     */
    get derivedPropertiesIncluded(): string[] {
        const keys = Object.keys(this.vnodeType.derivedProperties);
        const requested = getDerivedPropsData(this.requestState);
        return keys.filter(propName => propName in requested);
    }
}


