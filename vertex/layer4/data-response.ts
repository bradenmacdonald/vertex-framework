import { ReturnTypeFor } from "../layer2/cypher-return-shape";
import { PropertyDataType, VNodeType } from "../layer2/vnode";
import { BaseDataRequest } from "../layer3/data-request";
import {
    ConditionalRawPropsMixin, IncludedVirtualCypherExpressionProp, IncludedVirtualManyProp, IncludedVirtualOneProp, VirtualPropsMixin
} from "./data-request-with-virt-props";
import { VNodeTypeWithVirtualProps } from "./vnode-with-virt-props";

/**
 * When a Data Request is executed ("pulled") from the database, this defines the shape/type of the response
 */
export type DataResponse<Request extends BaseDataRequest<VNodeType, any, any>> = (
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
                        : includedVirtualProps[virtualProp] extends IncludedVirtualCypherExpressionProp<infer VirtPropDefinition> ?
                            ReturnTypeFor<VirtPropDefinition["valueType"]> | (includedVirtualProps[virtualProp]["ifFlag"] extends string ? undefined : never)
                        : never
                    )}
                : unknown
            : unknown
        )
        // Derived properties that are included, possibly conditional on some flag:
        // {[derivedProp in keyof includedDerivedProperties]: (
        //     includedDerivedProperties[derivedProp]["valueType"]
        //     | (includedDerivedProperties[derivedProp]["ifFlag"] extends string ? undefined : never)
        // )}
    ) : never
);
