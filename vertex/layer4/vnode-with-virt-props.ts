import { VNodeType, emptyObj } from "../layer2/vnode";
import { DataRequestState } from "../layer3/data-request";
import { virtualPropsMixinImplementation } from "./data-request-mixins-impl";
import { CompileDerivedPropSchema, DerivedPropertyFactory, DerivedPropsSchema, DerivedPropsSchemaCompiled } from "./derived-props";
import { VirtualPropsSchema } from "./virtual-props";


/**
 * Augment the base VNodeType definition to add in defaults and helper methods for layer 4 functionality
 */
export class ExtendedVNodeType extends VNodeType {

    static readonly virtualProperties = emptyObj;
    static derivedProperties: DerivedPropsSchemaCompiled = emptyObj;

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
                newSchema[propName] = {
                    dataSpec: DataRequestState.getInternalState(dataSpec(
                        DataRequestState.newRequest(this, [virtualPropsMixinImplementation]) as any
                    )),
                    computeValue,
                };
            };
            propSchema[propName](compileDerivedProp, this);
        }
        return Object.freeze(newSchema);
    }
}


// In some parts of the "pull" code, it's necessary to refer to a type that has virtual props but not derived props:
export interface VNodeTypeWithVirtualProps extends VNodeType {
    readonly virtualProperties: VirtualPropsSchema;
}

// The following combined value (Class) and type definition is what most Vertex Framework applications use as "VNodeType"
export const VNodeTypeWithVirtualAndDerivedProps = ExtendedVNodeType;
export interface VNodeTypeWithVirtualAndDerivedProps extends VNodeTypeWithVirtualProps {
    readonly derivedProperties: DerivedPropsSchemaCompiled;
}
