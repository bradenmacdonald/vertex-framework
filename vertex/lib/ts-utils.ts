// Helper for generating nominal types, until TypeScript gets native support
// https://github.com/Microsoft/TypeScript/issues/202
export type NominalType<T, K extends string> = T & { nominal: K };


// Helper for asserting that types are equal
export type AssertEqual<Type, Expected> =
    {foo: "bar"} extends Type // Guard against "any" type
    ?
        ({foo: "bar"} extends Expected ? true : false) // Unless "any" was expected
    :
        Type extends Expected
        ? (Expected extends Type ? true : false)
        : false;

// Helper for asserting that types are not equal
export type AssertNotEqual<Type, Expected> =
    Type extends Expected
    ? false
    : (Expected extends Type ? false : true);

// Helper for asserting that an object has a specific property
export type AssertPropertyPresent<Type, KeyName extends string, ValueType = any> =
    Type extends {[K in KeyName]: ValueType} ? true : false;

// Helper for asserting that an object has a specific property
export type AssertPropertyOptional<Type, KeyName extends string, ValueType = any> =
    Type extends {[K in KeyName]: ValueType} ? false :
    Type extends {[K in KeyName]?: ValueType} ? true :
    false;

// Helper for asserting that an object doesn't have a specific property
export type AssertPropertyAbsent<Type, KeyName extends string> =
    Type extends {[K in KeyName]?: any} ? false : true;

export function checkType<Assertion extends true>(): void {/* */}
