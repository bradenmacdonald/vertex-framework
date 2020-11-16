import type { VNodeType, VNodeTypeWithVirtualProps } from "./vnode";
import type { BaseDataRequest } from "../layer3/data-request";
import type { DataResponse } from "./data-response";
import type { VirtualPropsMixin } from "./data-request-mixins";

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
export interface DerivedPropsDeclaration {
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
    (defineProperty: DerivedPropertyFactory<ValueType>, vnt: VNodeType): void;
}

// Above this line are the arguments as declared in application code source files and passed to
// VNodeType.hasDerivedProperties(). Below this line are the derived property definitions as returned by
// VNodeType.hasDerivedProperties() and stored on the VNodeType subclass.

export interface DerivedPropsSchema {
    [K: string]: DerivedProperty<any>,
}

export type ConvertDerivedPropsDeclarationToSchema<Schema extends DerivedPropsDeclaration> = {
    [K in keyof Schema]: (
        Schema[K] extends DerivedPropertyDeclaration<infer ValueType> ? DerivedProperty<ValueType> : any
    )
}

export class DerivedProperty<ValueType> {
    #dataSpec?: (rq: BaseDataRequest<any, never, any>) => BaseDataRequest<any, any, any>;
    #computeValue?: (data: any) => ValueType;
    #declaration: DerivedPropertyDeclaration<ValueType>;
    #vnt: VNodeTypeWithVirtualProps;

    constructor(declaration: DerivedPropertyDeclaration<ValueType>, vnt: VNodeTypeWithVirtualProps) {
        this.#declaration = declaration;
        this.#vnt = vnt;
        // We don't "compile" the derived property right away, because the VNodeType class declaration is not complete
        // at this point, and the code to declare the derived property may depend on parts of the VNodeType class that
        // aren't yet loaded. Instead, "compile" the property on demand.
    }

    get dataSpec(): (rq: BaseDataRequest<any, never, any>) => BaseDataRequest<any, any, any> {
        if (this.#dataSpec === undefined) {
            this.compile();
        }
        return this.#dataSpec!;  // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }

    get computeValue(): (data: any) => ValueType {
        if (this.#computeValue === undefined) {
            this.compile();
        }
        return this.#computeValue!;  // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }

    private compile(): void {
        // Here is a function that will do the compilation.
        const compileDerivedProp: DerivedPropertyFactory<any> = (appliesTo, dataSpec, computeValue) => {
            if (appliesTo !== this.#vnt) {
                throw new Error(`Cannot add derived property "${this.#declaration.name}" to ${this.#vnt.name} because it passed the wrong VNode type to the factory function.`);
            }
            if (this.#dataSpec !== undefined) {
                throw new Error(`Duplicate definition of derived property on ${this.#vnt.name} using "${this.#declaration.name}".`);
            }
            this.#dataSpec = dataSpec;
            this.#computeValue = computeValue;
        };
        // Now call the "declaration" function, which will then call the above function to declare the property.
        // This strange indirection is needed to make the declaration syntax more reasonable and avoid issues with
        // declaring circularly typed properties that reference the VNodeType class itself.
        this.#declaration(compileDerivedProp, this.#vnt as VNodeType);
        if (this.#dataSpec === undefined) {
            throw new Error(`Derived property declaration ${this.#declaration.name} on ${this.#vnt.name} did not call the factory function to produce a derived property.`);
        }
    }
}