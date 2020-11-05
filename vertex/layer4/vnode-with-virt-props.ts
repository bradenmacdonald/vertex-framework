import { VNodeType, emptyObj } from "../layer2/vnode";
import { DerivedPropsSchema } from "./derived-props";
import { VirtualPropsSchema } from "./virtual-props";


/**
 * Augment the base VNodeType definition to add in defaults and helper methods for layer 4 functionality
 */
export class ExtendedVNodeType extends VNodeType {

    static readonly virtualProperties = emptyObj;
    static readonly derivedProperties: DerivedPropsSchema<any> = emptyObj;

    /**
     * Helper method used to declare derived properties with correct typing. Do not override this.
     * Usage:
     *     static readonly derivedProperties = MyVNodeType.hasDerivedProperties({
     *         ...
     *     });
     */
    static hasDerivedProperties<
        VNT extends VNodeTypeWithVirtualProps,
        DPS extends DerivedPropsSchema<VNT&{ignoreDerivedProps: true}>
    >(this: VNT, propSchema: DPS): DPS {
        return Object.freeze(propSchema);
    }
}

// In some parts of the "pull" code, it's necessary to refer to a type that has virtual props but not derived props:
export interface VNodeTypeWithVirtualProps extends VNodeType {
    readonly virtualProperties: VirtualPropsSchema;
}

// The following combined value (Class) and type definition is what most Vertex Framework applications use as "VNodeType"
export const VNodeTypeWithVirtualAndDerivedProps = ExtendedVNodeType;
export interface VNodeTypeWithVirtualAndDerivedProps extends VNodeTypeWithVirtualProps {
    readonly derivedProperties: DerivedPropsSchema<any>;
}
