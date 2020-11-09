import { VNodeType, emptyObj } from "../layer2/vnode";
import { BaseDataRequest, DataRequestState } from "../layer3/data-request";
import { VirtualPropsMixin } from "./data-request-mixins";
import { virtualPropsMixinImplementation } from "./data-request-mixins-impl";
import { DataResponse } from "./data-response";
import { DerivedProperty, DerivedPropsSchema } from "./derived-props";
import { VirtualPropsSchema } from "./virtual-props";


/**
 * Augment the base VNodeType definition to add in defaults and helper methods for layer 4 functionality
 */
export class ExtendedVNodeType extends VNodeType {

    static readonly virtualProperties = emptyObj;
    static derivedProperties: DerivedPropsSchema<any> = emptyObj;

    /**
     * Helper method used to declare derived properties with correct typing. Do not override this.
     * Usage:
     *     static readonly derivedProperties = MyVNodeType.hasDerivedProperties({
     *         ...
     *     });
     */
    static hasDerivedProperties<
        // VNT extends VNodeTypeWithVirtualProps,
        DPS extends DerivedPropsSchema<any>
    >(propSchema: DPS): DPS {
        return Object.freeze(propSchema);
    }

    static DerivedProperty<VNT extends VNodeTypeWithVirtualProps, DependencyRequest extends BaseDataRequest<VNT, any, any>, ValueType>(
        this: VNT,
        dependencies: (spec: BaseDataRequest<VNT, never, VirtualPropsMixin<VNT>>) => DependencyRequest,
        computeValue: (data: DataResponse<DependencyRequest>) => ValueType,
    ): DerivedProperty<VNT, DependencyRequest, ValueType> {
        return {
            dependencies: dependencies( DataRequestState.newRequest<VNT, VirtualPropsMixin<VNT>>(this, [virtualPropsMixinImplementation]) ),
            computeValue,
        };
    }




    static augmentWithDerivedProps<VNT extends VNodeTypeWithVirtualProps, DPS extends DerivedPropsSchema<VNT>>(this: VNT, schema: DPS): VNodeTypeWithDerivedProps<VNT, DPS> {
        const baseClassTyped = this as any; // Work around https://github.com/microsoft/TypeScript/issues/37142
        const newClassHolder = {
            [this.name]: class extends baseClassTyped {
                static readonly derivedProperties: DPS = schema;
            },
        };
        return newClassHolder[this.name] as any;
    }
}

// In some parts of the "pull" code, it's necessary to refer to a type that has virtual props but not derived props:
export interface VNodeTypeWithVirtualProps extends VNodeType {
    readonly virtualProperties: VirtualPropsSchema;
}


type VNodeTypeWithDerivedProps<VNT extends VNodeTypeWithVirtualProps, DPS extends DerivedPropsSchema<VNT>> = VNT & {
    derivedProperties: DPS;
}

// The following combined value (Class) and type definition is what most Vertex Framework applications use as "VNodeType"
export const VNodeTypeWithVirtualAndDerivedProps = ExtendedVNodeType;
export interface VNodeTypeWithVirtualAndDerivedProps extends VNodeTypeWithVirtualProps {
    readonly derivedProperties: DerivedPropsSchema<this>;
}
