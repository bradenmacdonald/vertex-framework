import { BaseVNodeType, emptyObj } from "../layer2/vnode-base.ts";
import { CleanDerivedProps, DerivedProperty, DerivedPropsSchema } from "./derived-props.ts";
import type { VirtualPropsSchema } from "./virtual-props.ts";
import { deferrable, Deferrable } from "../lib/deferrable.ts";


// In some parts of the code, it's necessary to refer to a type that has virtual props but not derived props:
export interface VNodeTypeWithVirtualProps extends BaseVNodeType {
    readonly virtualProperties: VirtualPropsSchema;
}

export interface VNodeType extends VNodeTypeWithVirtualProps {
    readonly derivedProperties: DerivedPropsSchema;
}

/**
 * Augment the base VNodeType definition to add in defaults and helper methods for layer 3 functionality.
 * 
 * This class (and the interface with the same name) is the full VNodeType abstract class
 */
export abstract class VNodeType extends BaseVNodeType {

    static readonly virtualProperties: VirtualPropsSchema = emptyObj;
    static readonly derivedProperties: DerivedPropsSchema = emptyObj;

    /** Helper method needed to declare a VNodeType's "virtualProperties" with correct typing. */
    static hasVirtualProperties<VPS extends VirtualPropsSchema>(props: Deferrable<VPS>): VPS {
        return deferrable(props);
    }

    /** Helper method needed to declare a VNodeType's "derivedProperties" with correct typing */
    static hasDerivedProperties<DPS extends DerivedPropsSchema>(props: DPS): CleanDerivedProps<DPS> {
        return deferrable(() => {
            // deno-lint-ignore no-explicit-any
            const newDerivedProps: any = {};
            // Apply the correct typing to "derivedProperties", in case it wasn't already done.
            // Specifically if any of the derived properties are functions, this will call them to convert them to DerivedProperty instances.
            // (vnt as any).derivedProperties = this.hasDerivedProperties(...);
            for (const propName in props) {
                const value = props[propName];
                if (typeof value === "function") {
                    // deno-lint-ignore no-explicit-any
                    const derivedProp = value(this as any as VNodeType, propName);
                    newDerivedProps[propName] = derivedProp;
                } else {
                    newDerivedProps[propName] = value;
                }
                if (!(newDerivedProps[propName] instanceof DerivedProperty)) {
                    throw new Error(`On VNode type ${this.name}, derived property ${propName} is invalid - its declared function did not return a DerivedProperty instance.`);
                }
            }

            return newDerivedProps;
        });
    }
}

/** Helper function to check if some object is a VNodeType */
export function isVNodeType(obj: unknown): obj is VNodeType {
    return typeof obj === "function" && Object.prototype.isPrototypeOf.call(VNodeType, obj);
}
