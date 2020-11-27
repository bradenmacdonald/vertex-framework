import { ReturnTypeFor } from "../layer2/cypher-return-shape";
import { PropertyDataType, BaseVNodeType } from "../layer2/vnode-base";
import { BaseDataRequest } from "../layer3/data-request";
import {
    ConditionalRawPropsMixin,
    DerivedPropsMixin,
    IncludedDerivedPropRequest,
    IncludedVirtualCypherExpressionProp,
    IncludedVirtualManyProp,
    IncludedVirtualOneProp,
    VirtualPropsMixin
} from "./data-request-mixins";
import { VNodeType, VNodeTypeWithVirtualProps } from "./vnode";


type UnWindConditionalPropsArray<conditionallyRequestedProperties extends BaseDataRequest<any, any, any>[]> = (
    conditionallyRequestedProperties extends [infer Spec1, ...infer Rest] ?
        Partial<DataResponse<Spec1>> & UnWindConditionalPropsArray<Rest>
    :
        unknown
);


/**
 * When a Data Request is executed ("pulled") from the database, this defines the shape/type of the response
 */
export type DataResponse<Request extends BaseDataRequest<BaseVNodeType, any, any>> = (
    Request extends BaseDataRequest<infer VNT, infer includedProperties, infer Mixins> ? (
        // Raw properties that are definitely included:
        {[rawProp in includedProperties]: PropertyDataType<VNT["properties"], rawProp>} &
        // Raw properties that are conditionally included, depending on whether a certain flag is set or not:
        (
            Mixins extends ConditionalRawPropsMixin<VNT, infer conditionallyRequestedProperties> & infer Other ?
                UnWindConditionalPropsArray<conditionallyRequestedProperties>
            : unknown
        ) &
        // Virtual properties that are included, possibly conditional on some flag:
        (
            VNT extends VNodeTypeWithVirtualProps ?
                Mixins extends VirtualPropsMixin<VNT, infer includedVirtualProps> & infer Other?
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
                            ReturnTypeFor<ValueType>
                        : never
                    )}
                : unknown
            : unknown
        ) &
        // Derived properties that are included, possibly conditional on some flag:
        (
            VNT extends VNodeType ?
                Mixins extends DerivedPropsMixin<VNT, infer includedDerivedProps> & infer Other?
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
