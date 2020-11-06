import { any, boolean } from "@hapi/joi";
import {
    VNodeType
} from "../layer2/vnode";

const isDataRequest = Symbol("isDataRequest");

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface None {}


export type BaseDataRequest<
    VNT extends VNodeType,
    requestedProperties extends keyof VNT["properties"] = never,
    Mixins = None,
> = (
    { [isDataRequest]: true, } &
    AddRawProperties<VNT, requestedProperties, Mixins> &
    AddAllProperties<VNT, requestedProperties, Mixins> &
    Mixins
);


type AddRawProperties<
    VNT extends VNodeType,
    requestedProperties extends keyof VNT["properties"],
    Mixins,
> = {
    [propName in keyof Omit<VNT["properties"], requestedProperties>]: (
        BaseDataRequest<VNT, requestedProperties | propName, Mixins>
    );
}

type AddAllProperties<
    VNT extends VNodeType,
    requestedProperties extends keyof VNT["properties"],
    Mixins,
> = (
    // If all properties are not yet included, create a .allProps property which requests all properties of this VNodeType.
    keyof VNT["properties"] extends requestedProperties ? None : {
        allProps: BaseDataRequest<VNT, keyof VNT["properties"], Mixins>
    }
)

export function EmptyDataRequest<VNT extends VNodeType>(vnt: VNT): BaseDataRequest<VNT> {
    return {} as BaseDataRequest<VNT>;
}


/** A helper that mixins can use to update their state in a data request. */
export type UpdateMixin<VNT extends VNodeType, ThisRequest, CurrentMixin, NewMixin> = (
    ThisRequest extends BaseDataRequest<VNT, infer requestedProperties, CurrentMixin & infer Other> ?
        BaseDataRequest<VNT, requestedProperties, NewMixin & Other>
    : never
);


///////////////////////////// Allow requesting properties conditionally, based on some sort of flag:

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
