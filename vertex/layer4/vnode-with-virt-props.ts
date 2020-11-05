import { VNodeType } from "../layer2/vnode";
import { DerivedPropsSchema } from "./derived-props";
import { VirtualPropsSchema } from "./virtual-props";

export class VNodeTypeWithVirtualProps extends VNodeType {

    /**
     * Helper method used to declare derived properties with correct typing. Do not override this.
     * Usage:
     *     static readonly derivedProperties = MyVNodeType.hasDerivedProperties({
     *         ...
     *     });
     */
    static hasDerivedProperties<
        VNT extends VNodeTypeWithVirtualProps,
        DPS extends DerivedPropsSchema<VNT>
    >(this: VNT, propSchema: DPS): DPS {
        return Object.freeze(propSchema);
    }
}

export interface VNodeTypeWithVirtualProps extends VNodeType {
    readonly virtualProperties: VirtualPropsSchema;
}
