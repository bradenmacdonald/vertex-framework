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
> = (
    { [isDataRequest]: true, } &
    AddRawProperties<VNT, requestedProperties> &
    AddAllProperties<VNT, requestedProperties> 
);


type AddRawProperties<
    VNT extends VNodeType,
    requestedProperties extends keyof VNT["properties"]
> = {
    [propName in keyof Omit<VNT["properties"], requestedProperties>]: <X>(this: X) => (
        X extends BaseDataRequest<VNT, requestedProperties> & infer Other ?
            BaseDataRequest<VNT, requestedProperties | propName> & Other
        : never
    );
}

type AddAllProperties<
    VNT extends VNodeType,
    requestedProperties extends keyof VNT["properties"]
> = (
    // If all properties are not yet included, create a .allProps property which requests all properties of this VNodeType.
    keyof VNT["properties"] extends requestedProperties ? None : {
        allProps: <X>(this: X) => (
            X extends BaseDataRequest<VNT, requestedProperties> & infer Other ?
                BaseDataRequest<VNT, keyof VNT["properties"]> & Other
            : never
        )
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
        <X>(this: X, flagName: string) => (
            X extends ConditionalRawPropsRequest<VNT, conditionallyRequestedProperties> & infer Other ?
            ConditionalRawPropsRequest<VNT, conditionallyRequestedProperties | propName> & Other
            : never
        )
});




export function EmptyDataRequestWithFlags<VNT extends VNodeType>(vnt: VNT): BaseDataRequest<VNT>&ConditionalRawPropsRequest<VNT> {
    return {} as BaseDataRequest<VNT>&ConditionalRawPropsRequest<VNT>;
}
