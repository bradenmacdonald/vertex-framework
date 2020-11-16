import { BaseVNodeType, emptyObj, getVNodeType as baseGetVNodeType } from "../layer2/vnode-base";
import { CompileDerivedPropSchema, DerivedPropertyFactory, DerivedPropsSchema, DerivedPropsSchemaCompiled } from "./derived-props";
import { VirtualPropsSchema } from "./virtual-props";


// In some parts of the code, it's necessary to refer to a type that has virtual props but not derived props:
export interface VNodeTypeWithVirtualProps extends BaseVNodeType {
    readonly virtualProperties: VirtualPropsSchema;
}

export interface VNodeType extends VNodeTypeWithVirtualProps {
    readonly derivedProperties: DerivedPropsSchemaCompiled;
}

/**
 * Augment the base VNodeType definition to add in defaults and helper methods for layer 4 functionality.
 * 
 * This class (and the interface with the same name) is the full VNodeType abstract class
 */
export abstract class VNodeType extends BaseVNodeType {

    static readonly virtualProperties = emptyObj;
    static readonly derivedProperties = emptyObj;

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
    static hasDerivedProperties<DPS extends DerivedPropsSchema>(this: any, propSchema: DPS): CompileDerivedPropSchema<DPS> {
        const newSchema: any = {};     
        for (const propName in propSchema) {
            const compileDerivedProp: DerivedPropertyFactory<any> = (appliesTo, dataSpec, computeValue) => {
                if (appliesTo !== this) {
                    throw new Error(`Cannot add derived property "${propName}" to ${this.name} because it passed the wrong VNode type to the factory function.`);
                }
                if (propName in newSchema) {
                    throw new Error(`Duplicate definition of derived property "${propName}".`);
                }
                newSchema[propName] = { dataSpec, computeValue };
            };
            propSchema[propName](compileDerivedProp, this);
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
