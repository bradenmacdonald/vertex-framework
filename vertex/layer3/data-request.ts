/**
 * Data Request:
 * 
 * A Data Request is a way of specifying a subset of a VNode's properties.
 * A Data Response Shape is the fully typed shape of that data request when it is loaded from the database.
 * 
 * Data requests are usually constructed using arrow functions.
 * 
 * For example, a data request for a Person might be:
 *     p => p.uuid.name.dateOfBirth
 * That means "I want the UUID, name, and dateOfBirth fields"
 * The "Data Response Shape" for this request would be:
 *     {
 *         uuid: UUID,
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
    VNodeType
} from "../layer2/vnode";


// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface None {}

///////////////// BaseDataRequest //////////////////////////////////////////////////////////////////////////////////////

const isDataRequest = Symbol("isDataRequest");

/** The base data request type. All data requests allow choosing among a VNodeType's raw properties. */
export type BaseDataRequest<VNT extends VNodeType, requestedProperties extends keyof VNT["properties"] = never, Mixins = None> = (
    { [isDataRequest]: true, } &
    // For each raw property of the VNode that's not yet included in the request, add a property to add it to the request:
    AddRawProperties<VNT, requestedProperties, Mixins> &
    // Add the "allProps" helper that adds all properties to the request:
    AddAllProperties<VNT, requestedProperties, Mixins> &
    // And finally any mixins, to allow requesting things like conditional or virtual properties:
    Mixins
);

// For each raw property of the VNode that's not yet included in the request, add a property to add it to the request:
type AddRawProperties<VNT extends VNodeType, requestedProperties extends keyof VNT["properties"], Mixins> = {
    [propName in keyof Omit<VNT["properties"], requestedProperties>]: BaseDataRequest<VNT, requestedProperties | propName, Mixins>;
};

type AddAllProperties<VNT extends VNodeType, requestedProperties extends keyof VNT["properties"], Mixins> = (
    // If all properties are not yet included, create a .allProps property which requests all properties of this VNodeType.
    keyof VNT["properties"] extends requestedProperties ? None : { allProps: BaseDataRequest<VNT, keyof VNT["properties"], Mixins>}
);

/** A helper that mixins can use to update their state in a data request. */
export type UpdateMixin<VNT extends VNodeType, ThisRequest, CurrentMixin, NewMixin> = (
    ThisRequest extends BaseDataRequest<VNT, infer requestedProperties, CurrentMixin & infer Other> ?
        BaseDataRequest<VNT, requestedProperties, NewMixin & Other>
    : never
);

export function EmptyDataRequest<VNT extends VNodeType>(vnt: VNT): BaseDataRequest<VNT> {
    return {} as BaseDataRequest<VNT>;
}



///////////////// ConditionalRawPropsMixin /////////////////////////////////////////////////////////////////////////////


/** Allow requesting raw properties conditionally, based on whether or not a "flag" is set: */
export type ConditionalRawPropsMixin<
    VNT extends VNodeType,
    conditionallyRequestedProperties extends keyof VNT["properties"] = never,
> = ({
    [propName in keyof Omit<VNT["properties"], conditionallyRequestedProperties> as `${string & propName}IfFlag`]:
        <ThisRequest>(this: ThisRequest, flagName: string) => (
            UpdateMixin<VNT, ThisRequest,
                // Change this mixin from:
                ConditionalRawPropsMixin<VNT, conditionallyRequestedProperties>,
                // to:
                ConditionalRawPropsMixin<VNT, conditionallyRequestedProperties | propName>
            >
        )
});


export function EmptyDataRequestWithFlags<VNT extends VNodeType>(vnt: VNT): BaseDataRequest<VNT, never, ConditionalRawPropsMixin<VNT>> {
    return {} as BaseDataRequest<VNT, never, ConditionalRawPropsMixin<VNT>>;
}
