// deno-lint-ignore-file no-explicit-any
/**
 * A generic mechanism for avoiding circular imports with Vertex Framework
 */

/**
 * Metadata about a "deferred" object. This object gets wrapped in a Proxy and will be
 * auto-converted to the "real" instance at the last second.
 */
interface DeferredObjectMetadata {
    fn: () => any;
    instance?: any;
}

const _metadataKey = Symbol("_metadataKey");

const deferredObjectProxyHandler: ProxyHandler<DeferredObjectMetadata> = {
    set: (_metadata, _propKey, _value, _proxyObj) => false,  // We don't need set for now
    get: (metadata, propKey, proxyObj) => {
        if (propKey === _metadataKey) { return metadata; }
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

/**
 * Allow an object/value to be "deferred". If an object/value is passed in, it is returned unchanged. But if a function
 * is passed in, this will return a proxy object. When the proxy object is *first* accessed, the function will be called
 * to provide the value, and the proxy object will then act like that value.
 * @param fnOrValue 
 * @returns 
 */
export function deferrable<T>(fnOrValue: Deferrable<T>): T {
    if (typeof fnOrValue === "function") {
        return new Proxy({fn: fnOrValue as any, instance: undefined}, deferredObjectProxyHandler) as any as T;
    }
    return fnOrValue;
}

/**
 * Call a function with an object that may have been deferred; if the object has been deferred, this function will be
 * called only when the deferred object is first accessed. If it is a regular object, the function will be called now.
 * @param possiblyDeferredValue An object that may be deferred (returned by deferrable(() => value))
 * @param lazyFunction A function to call with the "real" value of the deferred object, before it is first accessed.
 */
export function applyLazilyToDeferrable<T>(possiblyDeferredValue: T, lazyFunction: (arg: T) => unknown): void {
    if (possiblyDeferredValue) {
        const metadata = (possiblyDeferredValue as any)[_metadataKey] as DeferredObjectMetadata;
        if (metadata !== undefined) {
            // This is a proxy wrapped around a deferred object. Don't apply the function just yet.
            const origValueFunction = metadata.fn;  // The function that creates the real object that has been deferred.
            metadata.fn = () => {
                const value = origValueFunction();
                lazyFunction(value);
                return value;
            };
            return;  // We have deferred lazyFunction(); it will be called when the Proxy is first accessed.
        }
    }
    // This is just a regular object/value. Apply the function now.
    lazyFunction(possiblyDeferredValue);
}
