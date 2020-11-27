import { BaseVNodeType, emptyObj, getVNodeType as baseGetVNodeType, RelationshipsDeclaration } from "../layer2/vnode-base";
import { CleanDerivedProps, DerivedProperty, DerivedPropsSchema, DerivedPropsSchemaCleaned } from "./derived-props";
import type { VirtualPropsSchema } from "./virtual-props";


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

    /** Completely optional helper method to declare a VNodeType's "rel" (relationships) property with correct typing. */
    static hasRelationshipsFromThisTo<Rels extends RelationshipsDeclaration>(relationships: Rels): Rels {
        return relationships;
    }

    /** Completely optional helper method to declare a VNodeType's "virtualProperties" with correct typing. */
    static hasVirtualProperties<VPS extends VirtualPropsSchema>(props: VPS): VPS {
        return props;
    }

    /** Completely optional helper method to declare a VNodeType's "derivedProperties" with correct typing */
    static hasDerivedProperties<DPS extends DerivedPropsSchema>(props: DPS): CleanDerivedProps<DPS> {
        // Note: we are returning this as a different type ("Cleaned"), but it's actually the decorator
        // @VNodeType.declare that changes the type of this, converting any derived props that are functions to the
        // DerivedProperty instances that they return. In practice that takes effect at class declaration time so it's
        // convenient to let TypeScript know about the type now; otherwise TypeScript won't know.
        return props as any;
    }

    /**
     * Validate and register a VNodeType.
     *
     * Every VNodeType must be decorated with this function (or call this function with the VNodeType subclass, if not
     * using decorators)
     */
    static declare(vnt: VNodeType): void {
        // This is extending the base class "declare" static method:
        BaseVNodeType.declare(vnt);

        // Apply the correct typing to "derivedProperties", in case it wasn't already done.
        // Specifically if any of the derived properties are functions, this will call them to convert them to DerivedProperty instances.
        // (vnt as any).derivedProperties = this.hasDerivedProperties(vnt.derivedProperties);
        for (const propName in vnt.derivedProperties) {
            const value = vnt.derivedProperties[propName];
            if (typeof value === "function") {
                const derivedProp = value(vnt, propName);
                vnt.derivedProperties[propName] = derivedProp;
            }
            if (!(vnt.derivedProperties[propName] instanceof DerivedProperty)) {
                throw new Error(`On VNode type ${vnt.name}, derived property ${propName} is invalid - its declared function did not return a DerivedProperty instance.`);
            }
        }
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
