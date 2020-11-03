import { log } from "./lib/log";
import { getVNodeType, VNodeType } from "./vnode";

/** Interface for our "Fake" VNodeType which holds the label used to lazily load the real type. */
interface FakeVNodeType {
    label: string;  // <-- this label is the same as the "real" VNodeType we want to load
    loadedVNodeType?: VNodeType;  // <-- This holds a reference to the "real" VNodeType after we load it lazily
}

/** Helper method used by vnodeRefProxyHandler to get the real VNodeType from the fake VNodeType */
function getVNode(refData: FakeVNodeType): VNodeType {
    log.warn(`getVNode(${refData.label}); already loaded? ${refData.loadedVNodeType}`);
    if (refData.loadedVNodeType === undefined) {
        refData.loadedVNodeType = getVNodeType(refData.label);
    }
    return refData.loadedVNodeType;
}

/** Proxy handler implementation that makes VNodeTypeRef work */
const vnodeRefProxyHandler: ProxyHandler<FakeVNodeType> = {
    set: (refData, propKey, value, proxyObj) => false,  // Disallow setting properties on the VNodeType
    get: (refData, propKey, proxyObj) => { return Reflect.get(getVNode(refData), propKey, proxyObj); },
    getPrototypeOf: (refData) => { return Reflect.getPrototypeOf(getVNode(refData)); },
    has: (refData, propKey) => { return Reflect.has(getVNode(refData), propKey); },
    construct: (refData, argArray, newTarget) => { return Reflect.construct(getVNode(refData), argArray, newTarget); },
    getOwnPropertyDescriptor: (refData, propKey) => { return Reflect.getOwnPropertyDescriptor(getVNode(refData), propKey); },
    apply: (refData, thisArg, argArray) => { return Reflect.apply(getVNode(refData), thisArg, argArray); },
    ownKeys: (refData) => { return Reflect.ownKeys(getVNode(refData)); },
};

/**
 * Create a forward reference to a VNodeType, to avoid circular import issues.
 * 
 * Use this as follows:
 *     import { VNodeType, VirtualPropType, VNodeTypeRef, ... } from "vertex-framework"
 *
 *     // There is a circular reference between Movie and MovieFranchise, so declare a forward reference now:
 *     export const MovieRef: typeof Movie = VNodeTypeRef("TestMovie");  // the string must match the VNodeType's label
 *
 *     // _now_ we can import MovieFranchise without circular references:
 *     import { MovieFranchise } from "./MovieFranchise";
 * 
 * Then in MovieFranchise, use MovieRef everywhere in top-level code that you would use "Movie". Be sure not to access
 * any properties like MovieRef.label until the whole module has initialized.
 */
export const VNodeTypeRef = <VNT extends VNodeType>(label_: string): VNT => {

    // Dynamically construct a VNodeType class to use as the internal data ("target") for the proxy.
    // We need this because the "target" must be somewhat similar in terms of prototype to the real VNode type
    // for the proxy to work.
    const classBuilder = {
        FakeVNodeType: class extends VNodeType {
            static label = label_;
            static loadedVNodeType?: VNodeType;  // <-- the real VNodeType will be loaded on demand (later) and stored here
        },
    }

    return new Proxy(classBuilder.FakeVNodeType, vnodeRefProxyHandler) as any as VNT;
}
