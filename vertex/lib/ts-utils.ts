// Helper for generating nominal types, until TypeScript gets native support
// https://github.com/Microsoft/TypeScript/issues/202
export type NominalType<T, K extends string> = T & { nominal: K };


// Helper for asserting that types are equal
export type AssertEqual<Type, Expected> =
    Type extends Expected
    ? (Expected extends Type ? true : void)
    : never;

// Helper for asserting that types are equal
export type AssertNotEqual<Type, Expected> =
    Type extends Expected
    ? true
    : (Expected extends Type ? never : true);
