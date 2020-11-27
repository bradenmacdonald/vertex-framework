import { BaseVNodeType, emptyObj, getVNodeType as baseGetVNodeType } from "../layer2/vnode-base";
import { ConvertDerivedPropsDeclarationToSchema, DerivedProperty, DerivedPropertyDeclaration, DerivedPropertyFactory, DerivedPropsDeclaration, DerivedPropsSchema } from "./derived-props";
import { VirtualPropsSchema } from "./virtual-props";


// In some parts of the code, it's necessary to refer to a type that has virtual props but not derived props:
export interface VNodeTypeWithVirtualProps extends BaseVNodeType {
    readonly virtualProperties: VirtualPropsSchema;
}

export interface VNodeType extends VNodeTypeWithVirtualProps {
    readonly derivedProperties: DerivedPropsSchema;
}

/**
 * Augment the base VNodeType definition to add in defaults and helper methods for layer 4 functionality.
 * 
 * This class (and the interface with the same name) is the full VNodeType abstract class
 */
export abstract class VNodeType extends BaseVNodeType {

    static readonly virtualProperties: VirtualPropsSchema = emptyObj;
    static readonly derivedProperties: DerivedPropsSchema = emptyObj;

    /**
     * Helper method used to declare derived properties with correct typing. Do not override this.
     * Usage:
     *     static readonly derivedProperties = MyVNodeType.hasDerivedProperties({
     *         propName,
     *         ...
     *     });
     * 
     * Where propName is a function that accepts a single method parameter (and optionally the VNodeType itself as the
     * second parameter, if your derived property implementation is shared among multiple VNodeTypes). Call that method once
     * to configure the property.
     */
    static hasDerivedProperties<DPS extends DerivedPropsDeclaration>(this: any, propSchema: DPS): ConvertDerivedPropsDeclarationToSchema<DPS> {
        const newSchema: any = {};     
        for (const propName in propSchema) {
            const propDeclaration = propSchema[propName];
            if (propDeclaration instanceof DerivedProperty) {
                newSchema[propName] = propDeclaration;
            } else {
                newSchema[propName] = new DerivedProperty<any>(propDeclaration as DerivedPropertyDeclaration<any>, this);
            }
        }
        return Object.freeze(newSchema);
    }
}

/** Helper function to check if some object is a VNodeType */
export function isVNodeType(obj: any): obj is VNodeType {
    return Object.prototype.isPrototypeOf.call(VNodeType, obj);
}

/** Extend "getVNodeType" to include layer 4 type definition */
export function getVNodeType(label: string): VNodeType {
    return baseGetVNodeType(label) as VNodeType;
}
