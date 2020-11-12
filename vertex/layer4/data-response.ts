import { ReturnTypeFor } from "../layer2/cypher-return-shape";
import { PropertyDataType, BaseVNodeType } from "../layer2/vnode-base";
import { BaseDataRequest } from "../layer3/data-request";
import {
    ConditionalRawPropsMixin, DerivedPropsMixin, IncludedDerivedPropRequest, IncludedVirtualCypherExpressionProp, IncludedVirtualManyProp, IncludedVirtualOneProp, VirtualPropsMixin
} from "./data-request-mixins";
import { VNodeType, VNodeTypeWithVirtualProps } from "./vnode";

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
                {[conditionalRawProp in conditionallyRequestedProperties]?: PropertyDataType<VNT["properties"], conditionalRawProp>}
            : unknown
        ) &
        // Virtual properties that are included, possibly conditional on some flag:
        (
            VNT extends VNodeTypeWithVirtualProps ?
                Mixins extends VirtualPropsMixin<VNT, infer includedVirtualProps> & infer Other?
                    {[virtualProp in keyof includedVirtualProps]: (
                        // A -to-many virtual property is included:
                        includedVirtualProps[virtualProp] extends IncludedVirtualManyProp<any, infer Spec> ?
                            DataResponse<Spec>[] | (includedVirtualProps[virtualProp]["ifFlag"] extends string ? undefined : never)
                        // A -to-one virtual property is included:
                        : includedVirtualProps[virtualProp] extends IncludedVirtualOneProp<any, infer Spec> ?
                            // 1:1 relationships are currently always optional at the DB level, so this may be null
                            DataResponse<Spec> | null | (includedVirtualProps[virtualProp]["ifFlag"] extends string ? undefined : never)
                        // A cypher expression virtual property is included:
                        : includedVirtualProps[virtualProp] extends IncludedVirtualCypherExpressionProp<infer ValueType> ?
                            ReturnTypeFor<ValueType> | (includedVirtualProps[virtualProp]["ifFlag"] extends string ? undefined : never)
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
                            ValueType | (includedDerivedProps[propName]["ifFlag"] extends string ? undefined : never)
                        : {error: boolean}
                    )}
                : unknown
            : unknown
        )
    ) : never
);
