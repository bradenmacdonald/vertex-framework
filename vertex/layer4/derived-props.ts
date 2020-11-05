import { VNodeTypeWithVirtualProps } from "./vnode-with-virt-props";
import { VNodeDataRequestBuilder, VNodeDataRequestBuilt, VNodeDataResponse } from "./pull";
/**
 * Every VNode can declare "virtual properties" which are computed properties (such as related VNodes) that can be
 * loaded from the graph or other sources.
 *
 * Derived properties are a special type of virtual property which gets computed with the help of some callback function
 * (i.e. computed by JavaScript code), and which have access to values from other raw and virtual properties.
 */
export interface DerivedPropsSchema<VNT extends VNodeTypeWithVirtualProps&{ignoreDerivedProps: true}> {
    [K: string]: DerivedProperty<VNT, any, any>,
}

export interface DerivedProperty<VNT extends VNodeTypeWithVirtualProps&{ignoreDerivedProps: true}, DependencyRequest extends VNodeDataRequestBuilt<VNT>, ValueType> {
    dependencies: (x: VNodeDataRequestBuilder<VNT>) => DependencyRequest,
    computeValue: (x: VNodeDataResponse<DependencyRequest>) => ValueType,
}

export function DerivedProperty<VNT extends VNodeTypeWithVirtualProps&{ignoreDerivedProps: true}, DependencyRequest extends VNodeDataRequestBuilt<VNT>, ValueType>(
    dependencies: (x: VNodeDataRequestBuilder<VNT&{ignoreDerivedProps: true}>) => DependencyRequest,
    computeValue: (x: VNodeDataResponse<DependencyRequest>) => ValueType,
): DerivedProperty<VNT, DependencyRequest, ValueType> { return {dependencies, computeValue}; }
