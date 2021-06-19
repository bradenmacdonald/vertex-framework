/**
 * A generic mechanism for avoiding circular imports with Vertex Framework
 */
interface DeferredObjectMetadata {
    fn: () => any;
    instance?: any;
}

const deferredObjectProxyHandler: ProxyHandler<DeferredObjectMetadata> = {
    set: (metadata, propKey, value, proxyObj) => false,  // We don't need set for now
    get: (metadata, propKey, proxyObj) => {
        if (metadata.instance === undefined) { metadata.instance = metadata.fn(); }
        return Reflect.get(metadata.instance, propKey, proxyObj);
    },
    getPrototypeOf: (metadata) => {
        if (metadata.instance === undefined) { metadata.instance = metadata.fn(); }
        return Reflect.getPrototypeOf(metadata.instance);
    },
    has: (metadata, propKey) => {
        if (metadata.instance === undefined) { metadata.instance = metadata.fn(); }
        return Reflect.has(metadata.instance, propKey);
    },
    construct: (metadata, argArray, newTarget) => {
        if (metadata.instance === undefined) { metadata.instance = metadata.fn(); }
        return Reflect.construct(metadata.instance, argArray, newTarget);
    },
    getOwnPropertyDescriptor: (metadata, propKey) => { 
        if (metadata.instance === undefined) { metadata.instance = metadata.fn(); }
        return Reflect.getOwnPropertyDescriptor(metadata.instance, propKey); },
    apply: (metadata, thisArg, argArray) => {
        if (metadata.instance === undefined) { metadata.instance = metadata.fn(); }
        return Reflect.apply(metadata.instance, thisArg, argArray);
    },
    ownKeys: (metadata) => {
        if (metadata.instance === undefined) { metadata.instance = metadata.fn(); }
        return Reflect.ownKeys(metadata.instance);
    },
};

export type Deferrable<T> = T|(() => T);

export function deferrable<T>(fnOrValue: Deferrable<T>): T {
    if (typeof fnOrValue === "function") {
        return new Proxy({fn: fnOrValue as any, instance: undefined}, deferredObjectProxyHandler) as any as T;
    }
    return fnOrValue;
}
