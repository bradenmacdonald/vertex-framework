import { VNodeTypeWithVirtualProps } from "./vnode-with-virt-props";
import { BaseDataRequest } from "../layer3/data-request";
import { DataResponse } from "./data-response";
/**
 * Every VNode can declare "virtual properties" which are computed properties (such as related VNodes) that can be
 * loaded from the graph or other sources.
 *
 * Derived properties are a special type of virtual property which gets computed with the help of some callback function
 * (i.e. computed by JavaScript code), and which have access to values from other raw and virtual properties.
 */
export interface DerivedPropsSchema<VNT extends VNodeTypeWithVirtualProps> {
    [K: string]: DerivedProperty<VNT, any, any>,
}

export interface DerivedProperty<VNT extends VNodeTypeWithVirtualProps, DependencyRequest extends BaseDataRequest<VNT, any, any>, ValueType> {
    dependencies: (x: BaseDataRequest<VNT>) => DependencyRequest,
    computeValue: (x: DataResponse<DependencyRequest>) => ValueType,
}

export function DerivedProperty<VNT extends VNodeTypeWithVirtualProps, DependencyRequest extends BaseDataRequest<VNT, any, any>, ValueType>(
    dependencies: (x: BaseDataRequest<VNT>) => DependencyRequest,
    computeValue: (x: DataResponse<DependencyRequest>) => ValueType,
): DerivedProperty<VNT, DependencyRequest, ValueType> { return {dependencies, computeValue}; }
