import { VNodeTypeWithVirtualProps } from "./vnode-with-virt-props";
import { BaseDataRequest, DataRequestState } from "../layer3/data-request";
import { DataResponse } from "./data-response";
import { VirtualPropsMixin } from "./data-request-mixins";

/**
 * Derived properties are a special type of virtual property which gets computed with the help of some callback function
 * (i.e. computed by JavaScript code), and which have access to values from other raw and virtual properties.
 * 
 * Declare derived properties within a VNodeType class definition like this:
 *     static readonly derivedProperties = Person.hasDerivedProperties({
 *         propName,
 *     });
 *
 * Where propName is a function that accepts a single method parameter (and optionally the VNodeType itself as the
 * second parameter, if your derived property implementation is shared among multiple VNodeTypes). Call that method once
 * to configure the property.
 */
export interface DerivedPropsSchema {
    [K: string]: DerivedPropertyDeclaration<any>,
}

export interface DerivedPropertyFactory<ValueType> {
    <VNT extends VNodeTypeWithVirtualProps, Request extends BaseDataRequest<VNT, any, any>>(
        appliesTo: VNT,
        dataSpec: (rq: BaseDataRequest<VNT, never, VirtualPropsMixin<VNT>>) => Request,
        computeValue: (data: DataResponse<Request>) => ValueType,
    ): void;
}

export interface DerivedPropertyDeclaration<ValueType> {
    (defineProperty: DerivedPropertyFactory<ValueType>, vnt: VNodeTypeWithVirtualProps): void;
}

// Above this line are the arguments as declared in application code source files and passed to
// VNodeType.hasDerivedProperties(). Below this line are the "compiled" derived property definitions as returned by
// VNodeType.hasDerivedProperties() and stored on the VNodeType subclass.

export interface DerivedPropsSchemaCompiled {
    [K: string]: DerivedProperty<any>,
}

export interface DerivedProperty<ValueType> {
    readonly dataSpec: DataRequestState,
    readonly computeValue: (data: any) => ValueType,
}

export type CompileDerivedPropSchema<Schema extends DerivedPropsSchema> = {
    [K in keyof Schema]: (
        Schema[K] extends DerivedPropertyDeclaration<infer ValueType> ? DerivedProperty<ValueType> : any
    )
}
