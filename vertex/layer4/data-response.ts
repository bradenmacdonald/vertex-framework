import { GetDataType } from "../layer2/field";
import { BaseVNodeType } from "../layer2/vnode-base";
import { AnyDataRequest, BaseDataRequest, RequiredMixin } from "../layer3/data-request";
import {
    ConditionalPropsMixin,
    DerivedPropsMixin,
    IncludedDerivedPropRequest,
    IncludedVirtualCypherExpressionProp,
    IncludedVirtualManyProp,
    IncludedVirtualOneProp,
    VirtualPropsMixin
} from "./data-request-mixins";
import { VNodeType, VNodeTypeWithVirtualProps } from "./vnode";


type UnWindConditionalPropsArray<conditionallyRequestedProperties extends AnyDataRequest<any>[]> = (
    conditionallyRequestedProperties extends [infer Spec1, ...infer Rest] ?
        // Should be just:
        //     Partial<DataResponse<Spec1>> & UnWindConditionalPropsArray<Rest>
        // But TypeScript can't figure that out so we need:
        (Spec1 extends AnyDataRequest<any> ? Partial<DataResponse<Spec1>> : unknown)
        & (Rest extends AnyDataRequest<any>[] ? UnWindConditionalPropsArray<Rest> : unknown)
    :
        unknown
);


/**
 * When a Data Request is executed ("pulled") from the database, this defines the shape/type of the response
 */
export type DataResponse<Request extends AnyDataRequest<BaseVNodeType>> = (
    Request extends BaseDataRequest<infer VNT, infer includedProperties, RequiredMixin & infer Mixins> ? (
        // Raw properties that are definitely included:
        {[rawProp in includedProperties]: GetDataType<VNT["properties"][rawProp]>} &
        // Any properties that are conditionally included, depending on whether a certain flag is set or not:
        (
            Mixins extends ConditionalPropsMixin<VNT, infer conditionallyRequestedProperties> & infer Other ?
                UnWindConditionalPropsArray<conditionallyRequestedProperties>
            : unknown
        ) &
        // Virtual properties that are included, possibly conditional on some flag:
        (
            VNT extends VNodeTypeWithVirtualProps ?
                Mixins extends VirtualPropsMixin<VNT, infer includedVirtualProps> & infer Other?
                    keyof includedVirtualProps extends never ? unknown :  // This line makes types look nicer by hiding the "& {}" type when there are no included virtual props
                    {[virtualProp in keyof includedVirtualProps]: (
                        // A -to-many virtual property is included:
                        includedVirtualProps[virtualProp] extends IncludedVirtualManyProp<any, infer Spec> ?
                            DataResponse<Spec>[]
                        // A -to-one virtual property is included:
                        : includedVirtualProps[virtualProp] extends IncludedVirtualOneProp<any, infer Spec> ?
                            // 1:1 relationships are currently always optional at the DB level, so this may be null
                            DataResponse<Spec> | null
                        // A cypher expression virtual property is included:
                        : includedVirtualProps[virtualProp] extends IncludedVirtualCypherExpressionProp<infer ValueType> ?
                            GetDataType<ValueType>
                        : never
                    )}
                : unknown
            : unknown
        ) &
        // Derived properties that are included, possibly conditional on some flag:
        (
            VNT extends VNodeType ?
                Mixins extends DerivedPropsMixin<VNT, infer includedDerivedProps> & infer Other?
                    keyof includedDerivedProps extends never ? unknown :  // This line makes types look nicer by hiding the "& {}" type when there are no included derived props
                    {[propName in keyof includedDerivedProps]: (
                        includedDerivedProps[propName] extends IncludedDerivedPropRequest<infer ValueType> ?
                            ValueType
                        : {error: boolean}
                    )}
                : unknown
            : unknown
        )
    ) : never
);
