/**
 * Data Request:
 * 
 * A Data Request is a way of specifying a subset of a VNode's properties.
 * A Data Response Shape is the fully typed shape of that data request when it is loaded from the database.
 * 
 * Data requests are usually constructed using arrow functions.
 * 
 * For example, a data request for a Person might be:
 *     p => p.id.name.dateOfBirth
 * That means "I want the id, name, and dateOfBirth fields"
 * The "Data Response Shape" for this request would be:
 *     {
 *         id: VNID,
 *         name: string,
 *         dateOfBirth: date,
 *     }
 * 
 * Data Requests are flexible and extensible. The base data request allows specifying individual "raw" properties of a
 * given VNodeType, as well as specifying "allProps" to include all properties. However, different types of Data Request
 * can be constructed using Mixins.
 * 
 * For example, the ConditionalRawPropsMixin allows specifying that a certain field should only be included if a "flag"
 * is set:
 *     Request: p => p.name.dateOfBirthIfFlag("includeDOB")
 *     Response Shape: { name: string, dateOfBirth?: date }
 * When loading this example request from the database at runtime, the "includeDOB" flag will determine whether or not
 * the "dateOfBirth" property is read from the database and included in the response.
 */
import {
    BaseVNodeType
} from "./vnode-base.ts";


///////////////// BaseDataRequest //////////////////////////////////////////////////////////////////////////////////////

const isDataRequest = Symbol("isDataRequest");
export interface RequiredMixin {
    [isDataRequest]: true;
}

/**
 * The base data request type. All data requests allow choosing among a VNodeType's raw properties.
 * Choosing among a VNodeType's other properties, like virtual and derived properties, is made possible when the data
 * request contains "mixins".
 * 
 * To improve type safety, the "RequiredMixin" must always be one of the "mixins" present, but there can be others.
 */
export type BaseDataRequest<VNT extends BaseVNodeType, requestedProperties extends keyof VNT["properties"] = never, Mixins extends RequiredMixin = RequiredMixin> = (
    // For each raw property of the VNode that's not yet included in the request, add a property to add it to the request:
    {[propName in keyof Omit<VNT["properties"], requestedProperties>]: BaseDataRequest<VNT, requestedProperties | propName, Mixins>} &
    // Add the "allProps" helper that adds all properties to the request:
    (keyof VNT["properties"] extends requestedProperties ? unknown : { allProps: BaseDataRequest<VNT, keyof VNT["properties"], Mixins>}) &
    // And finally any mixins, to allow requesting things like conditional or virtual properties:
    Mixins
);

export type AnyDataRequest<VNT extends BaseVNodeType> = BaseDataRequest<VNT, any, RequiredMixin>;

/** A helper that mixins can use to update their state in a data request. */
export type UpdateMixin<VNT extends BaseVNodeType, ThisRequest, CurrentMixin, NewMixin> = (
    ThisRequest extends BaseDataRequest<VNT, infer requestedProperties, CurrentMixin & RequiredMixin & infer Other> ?
        BaseDataRequest<VNT, requestedProperties, NewMixin & RequiredMixin & Other>
    : never
);

///////////////// Inner implementation of DataRequest //////////////////////////////////////////////////////////////////

// Data Requests have a simple TypeScript API (e.g. p => p.name.id) which is achieved by wrapping a "DataRequestState"
// immutable object in a Proxy, which intercepts calls to non-existent properties like ".name" or ".id" and uses them
// to update the state and then return the an updated DataRequestState object.



/**
 * Internal data in a VNodeDataRequest object
 * 
 * This class wraps itself in a Proxy, which lets it act like the "BaseDataRequest" type, with dynamic properties.
 */
export class DataRequestState {
    // The VNodeType that this data request is for
    readonly vnodeType: BaseVNodeType;
    // Raw properties of this VNodeType to pull from the database for this request.
    readonly includedProperties: ReadonlyArray<string>;
    // What mixins are available on this DataRequest object, to provide high-level functionality like virtual fields
    readonly #activeMixins: ReadonlyArray<MixinImplementation>;
    // Additional data used to hold mixin state, such as the set of virtual properties selected for inclusion:
    readonly mixinData: Readonly<{[mixinName: string]: any}>;

    private constructor(
        vnt: BaseVNodeType,
        includedProperties: ReadonlyArray<string>,
        activeMixins: ReadonlyArray<MixinImplementation>,
        mixinData: Readonly<{[mixinName: string]: any}>,
    ) {
        this.vnodeType = vnt;
        this.includedProperties = includedProperties;
        this.#activeMixins = activeMixins;
        this.mixinData = Object.freeze(mixinData);
    }

    /**
     * Construct a new data request.
     * 
     * Returns a new DataRequestState object, wrapped in a Proxy so that it implements the BaseDataRequest interface.
     * 
     * On the returned object, you can call properties like .id.name.dateOfBirth to add those properties to the
     * underlying request.
     */
    static newRequest<VNT extends BaseVNodeType, Mixins extends RequiredMixin>(vnodeType: VNT, mixins: MixinImplementation[]): BaseDataRequest<VNT, never, Mixins> {
        const newObj = new DataRequestState(vnodeType, [], mixins.slice(), {});
        return new Proxy(newObj, DataRequestState.proxyHandler) as any as BaseDataRequest<VNT, never, Mixins>;
    }

    newRequestWithSameMixins<VNT extends BaseVNodeType>(vnodeType: VNT): BaseDataRequest<VNT, never, any> {
        const newObj = new DataRequestState(vnodeType, [], this.#activeMixins, {});
        return new Proxy(newObj, DataRequestState.proxyHandler) as any as BaseDataRequest<VNT, never, any>;
    }

    cloneWithChanges(args: {newIncludedProperties?: ReadonlyArray<string>, newMixinData?: Readonly<{[mixinName: string]: any}>}): any {
        const includedProperties = args.newIncludedProperties ? [
            // If we're adding new properties to the request:
            // First keep all existing requested/included properties, in order:
            ...this.includedProperties,
            // Then add any newly requested properties, preserving order, unless they're already included:
            ...args.newIncludedProperties.filter(propName => !this.includedProperties.includes(propName))
        ] : this.includedProperties;
        const mixinData = args.newMixinData ? {...this.mixinData, ...args.newMixinData} : this.mixinData;
        const newObj = new DataRequestState(this.vnodeType, includedProperties, this.#activeMixins, mixinData);
        // Return the new DataRequestState wrapped in a proxy so it still implements the BaseDataRequest interface
        return new Proxy(newObj, DataRequestState.proxyHandler);
    }

    cloneForSubClass<VNT extends BaseVNodeType>(subclassVnt: VNT): BaseDataRequest<VNT, never, any> {
        if (!(subclassVnt === this.vnodeType || subclassVnt.prototype instanceof this.vnodeType)) {
            throw new Error(`Cannot convert data request: ${subclassVnt.name} is not a subclass of ${this.vnodeType.name}`);
        }
        const newObj = new DataRequestState(subclassVnt, this.includedProperties, this.#activeMixins, this.mixinData);
        // Return the new DataRequestState wrapped in a proxy so it still implements the BaseDataRequest interface
        return new Proxy(newObj, DataRequestState.proxyHandler);
    }

    private getRequestProperty(propKey: string): any {
        // Is this a regular, raw property of the VNodeType?
        if (this.vnodeType.properties[propKey] !== undefined) {
            // Add it to the request and return the new request object with that included:
            return this.cloneWithChanges({newIncludedProperties: [propKey]});
        }
        // The special "allProps" property means "add all raw properties to this request"
        if (propKey === "allProps") {
            return this.cloneWithChanges({newIncludedProperties: Object.keys(this.vnodeType.properties)});
        }
        // Otherwise, perhaps this is a virtual property or something implemented by a mixin:
        for (const mixinHandler of this.#activeMixins) {
            const mixinFn = mixinHandler(this, propKey);
            if (typeof mixinFn === "function") {
                return mixinFn;
            } else if (mixinFn === undefined) {
                continue;  // This mixin doesn't handle this property
            }
            throw new Error(`A Data Request Mixin implementation returned an invalid value of type ${typeof mixinFn}; expected a function.`);
        }
        throw new Error(`Unknown property ${propKey}`);
    }

    // A key used to get the internal state (an instance of DataRequestState) from the proxy that wraps it
    private static readonly _internalState = Symbol("internalState");

    static getInternalState<VNT extends BaseVNodeType>(request: BaseDataRequest<VNT, any, any>): DataRequestState {
        return request[this._internalState];
    }

    static proxyHandler: ProxyHandler<DataRequestState> = {
        set: (dataRequestState, propKey, value, proxyObj) => false,  // Disallow setting properties on the Data Request
        get: (dataRequestState, propKey, proxyObj) => {
            if (propKey === DataRequestState._internalState) {
                return dataRequestState;
            } else if (typeof propKey !== "string") {
                throw new Error("Can't have non-string property keys on a Data Request");
            }
    
            if (dataRequestState.vnodeType === undefined) {
                throw new Error(`Can't access .${propKey} because its VNodeType is undefined. There is probably a circular import issue.`);
            }
            return dataRequestState.getRequestProperty(propKey);
        },
    };
}

/**
 * "Mixins" can add additional functionality to the base data request class. Every mixin operates at two levels:
 * the TypeScript level, which defines the shape of the request, and this implementation level which is used by
 * DataRequestState to construct the request at runtime.
 *
 * This MixinImplementation is a function, called when the user accesses a property of the request. For example,
 *    p => p.someProp()
 * will call this function with "someProp" as the method name.
 * 
 * This mixin implementation function should return undefined if it does not recognize/accept "methodName" and otherwise
 * return a function that in turn returns the updated DataRequestState object. To do this, the returned function should
 * return dataRequest.cloneWithChanges({newMixinData: ...})
 */
export type MixinImplementation = (dataRequest: DataRequestState, methodName: string) => ((...args: any) => any)|undefined;

///////////////// Request specific raw properties of a VNoteTyp ////////////////////////////////////////////////////////

export type RequestVNodeRawProperties<VNT extends BaseVNodeType, SelectedProps extends keyof VNT["properties"] = any> = (emptyRequest: BaseDataRequest<VNT>) => BaseDataRequest<VNT, SelectedProps>;

export function getRequestedRawProperties<VNT extends BaseVNodeType, SelectedProps extends keyof VNT["properties"] = string & keyof VNT["properties"]>(vnodeType: VNT, requestFn: RequestVNodeRawProperties<VNT, SelectedProps>):
    Array<SelectedProps>
{
    // Create an empty data request, with no additional mixins, so it can only select from the VNodeType's raw properties:
    const emptyRequest = DataRequestState.newRequest<VNT, RequiredMixin>(vnodeType, []);
    // Call the provided function to construct a complete request, starting with the empty request as a starting point:
    const completeRequest = requestFn(emptyRequest);
    const requestState = DataRequestState.getInternalState(completeRequest);

    return requestState.includedProperties as Array<SelectedProps>;
}

/**
 * TypeScript type helper: given a RequestVNodeRawProperties<VNT, any>, this returns the selected raw properties as a
 * type, e.g. "uuid"|"name"|"username"
 */
export type GetRequestedRawProperties<Request extends RequestVNodeRawProperties<any, any>> = (
    Request extends RequestVNodeRawProperties<infer VNT, infer SelectedProps> ? SelectedProps : never
);
