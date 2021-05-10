// Helper for generating nominal types, until TypeScript gets native support
// https://github.com/Microsoft/TypeScript/issues/202
export type NominalType<T, K extends string> = T & { nominal: K };


// IfEquals check from https://stackoverflow.com/a/53808212 - if T and U are equal, this evaluates to Y, else N
type IfEquals<T, U, Y=unknown, N=never> =
  (<G>() => G extends T ? 1 : 2) extends
  (<G>() => G extends U ? 1 : 2) ? Y : N;

  // Helper for asserting that types are equal
export type AssertEqual<Type, Expected> = IfEquals<Type, Expected, true, false>;

// Helper for asserting that types are not equal
export type AssertNotEqual<Type, Expected> = IfEquals<Type, Expected, false, true>;

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
