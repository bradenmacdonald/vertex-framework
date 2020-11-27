/**
 * This whole file is a giant hack, but creates an easy way to work around most instances of circular references that
 * one will encounter when creating a project using Vertex Framework. See the description of VNodeTypeRef below for
 * details.
 */
import { getVNodeType, BaseVNodeType, RelationshipDeclaration } from "./vnode-base";

/** Interface for our "Fake" VNodeType which holds the label used to lazily load the real type. */
interface FakeVNodeType {
    label: string;  // <-- this label is the same as the "real" VNodeType we want to load
    loadedVNodeType?: BaseVNodeType;  // <-- This holds a reference to the "real" VNodeType after we load it lazily
    relationshipsProxy: any;  // <-- This holds a special proxy used to access the relationships under .rel.REL_NAME before the VNodeType is loaded.
}

/** Helper method used by vnodeRefProxyHandler to get the real VNodeType from the fake VNodeType */
function getVNode(refData: FakeVNodeType): BaseVNodeType {
    if (refData.loadedVNodeType === undefined) {
        refData.loadedVNodeType = getVNodeType(refData.label);
    }
    return refData.loadedVNodeType;
}

/** Proxy handler implementation that makes VNodeTypeRef work */
const vnodeRefProxyHandler: ProxyHandler<FakeVNodeType> = {
    set: (refData, propKey, value, proxyObj) => false,  // Disallow setting properties on the VNodeType
    get: (refData, propKey, proxyObj) => {
        if (propKey === "rel" && refData.loadedVNodeType === undefined) {
            // The VNodeType is not yet loaded - return a proxy that returns forward references (proxies) for each
            // relationship. We assume the relationship exists (it should, due to TypeScript checking).
            return refData.relationshipsProxy;
        }
        return Reflect.get(getVNode(refData), propKey, proxyObj);
    },
    getPrototypeOf: (refData) => { return Reflect.getPrototypeOf(getVNode(refData)); },
    has: (refData, propKey) => { return Reflect.has(getVNode(refData), propKey); },
    construct: (refData, argArray, newTarget) => { return Reflect.construct(getVNode(refData), argArray, newTarget); },
    getOwnPropertyDescriptor: (refData, propKey) => { 
        // This might be necessary in some cases? But seems like a bug so let's leave it out unless needed.
        // if (propKey === "prototype") { return Reflect.getOwnPropertyDescriptor(refData, propKey); }
        return Reflect.getOwnPropertyDescriptor(getVNode(refData), propKey); },
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
 * Then in MovieFranchise, use MovieRef everywhere in top-level code that you would use "Movie". You can use the
 * reference itself and you can also access its relationships like MovieRef.rel.SOME_RELATIONSHIP, but you cannot access
 * any properties of the reference (like "MovieRef.label") or of the relationships (like "MovieRef.rel.SOME_REL.label"),
 * as any property access other than the .rel.REL_NAME properties will attempt loading the VNode.
 */
export const VNodeTypeRef = <VNT extends BaseVNodeType>(label_: string): VNT => {

    const name = `${label_}Placeholder`;
    // Dynamically construct a VNodeType class to use as the internal data ("target") for the proxy.
    // We need this because the "target" must be somewhat similar in terms of prototype to the real VNode type
    // for the proxy to work.
    const classBuilder = {
        [name]: class extends BaseVNodeType {
            static label = label_;
            static loadedVNodeType?: BaseVNodeType;  // <-- the real VNodeType will be loaded on demand (later) and stored here
            static relationshipsProxy: any;
        },
    }

    // Create a sub-proxy used to make relationships partially available via ThisProxy.rel.REL_NAME even before the
    // VNodeType is loaded, if necssary.
    classBuilder[name].relationshipsProxy = new Proxy(classBuilder[name], RelationshipsProxyHandler);

    return new Proxy(classBuilder[name], vnodeRefProxyHandler) as any as VNT;
}


/// More proxies, to allow access to [VNodeTypeRef].rel.SOME_RELATIONSHIP before VNodeType has loaded:

class RelationshipPlaceholder {
    #label: string;
    #refData: FakeVNodeType;

    constructor(label: string, refData: FakeVNodeType) {
        this.#label = label;
        this.#refData = refData;
    }

    get realParentVNode(): BaseVNodeType {
        return getVNode(this.#refData);
    }

    get realRelationship(): RelationshipDeclaration {
        return this.realParentVNode.rel[this.#label];
    }
}

// When a VNodeRef's .rel.SOME_REL relationships are accessed before the VNodeType has been fully declared and
// initialized, this proxy acts as a placeholder for the RelationshipDeclaration, until it gets fully loaded.
const VNodeRelationshipProxyHandler: ProxyHandler<RelationshipPlaceholder> = {
    set: (target, propKey, value, proxyObj) => false,  // Disallow setting properties

    get: (placeholder, propKey, proxyObj) => { return Reflect.get(placeholder.realRelationship, propKey); },
    getPrototypeOf: (placeholder) => { return Reflect.getPrototypeOf(placeholder.realRelationship); },
    has: (placeholder, propKey) => { return Reflect.has(placeholder.realRelationship, propKey); },
    getOwnPropertyDescriptor: (placeholder, propKey) => { return Reflect.getOwnPropertyDescriptor(placeholder.realRelationship, propKey); },
    ownKeys: (placeholder) => { return Reflect.ownKeys(placeholder.realRelationship); },
    construct: (placeholder, argArray, newTarget) => { throw new Error("Can't construct a relationship placeholder proxy."); },
    apply: (placeholder, thisArg, argArray) => { throw new Error("Can't apply a relationship placeholder proxy."); },
};

/** Proxy handler implementation that makes the .rel property of VNodeType work even before the VNode is fully declared */
const RelationshipsProxyHandler: ProxyHandler<FakeVNodeType> = {
    set: (refData, propKey, value, proxyObj) => false,  // Disallow setting properties
    get: (refData, propKey, proxyObj) => {
        if (refData.loadedVNodeType !== undefined) {
            throw new Error(`Looks like a direct reference to VNodeTypeRef.rel (for "${refData.loadedVNodeType.name}") has been kept around after the VNode has loaded - this could lead to bugs and so is not supported.`);
        }
        if (typeof propKey !== "string") {
            throw new Error("Invalid relationship name - not a string.");
        }
        return new Proxy(new RelationshipPlaceholder(propKey, refData), VNodeRelationshipProxyHandler);
    },
    has: (refData, propKey) => { return true; },  // Pretend all properties are valid (all relationships exist); they should be checked via TypeScript anyways
};
