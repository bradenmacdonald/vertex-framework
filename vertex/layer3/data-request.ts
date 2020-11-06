import { any, boolean } from "@hapi/joi";
import {
    VNodeType
} from "../layer2/vnode";

const isDataRequest = Symbol("isDataRequest");

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface None {}


type BaseDataRequest<
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


///////////////////////////// Allow requesting properties conditionally, based on some sort of flag:

type ConditionalRawPropsRequest<
    VNT extends VNodeType,
    conditionallyRequestedProperties extends keyof VNT["properties"] = never,
> = ({
    [propName in keyof Omit<VNT["properties"], conditionallyRequestedProperties> as `${string & propName}IfFlag`]:
        <ThisRequest>(this: ThisRequest, flagName: string) => (
            ThisRequest extends BaseDataRequest<VNT, infer requestedProperties, ConditionalRawPropsRequest<VNT, conditionallyRequestedProperties> & infer Other> ?
                BaseDataRequest<VNT, requestedProperties, ConditionalRawPropsRequest<VNT, conditionallyRequestedProperties | propName> & Other>
            : never
        )
});


export function EmptyDataRequestWithFlags<VNT extends VNodeType>(vnt: VNT): BaseDataRequest<VNT, never, ConditionalRawPropsRequest<VNT>> {
    return {} as BaseDataRequest<VNT, never, ConditionalRawPropsRequest<VNT>>;
}
