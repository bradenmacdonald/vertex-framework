// Helper for generating nominal types, until TypeScript gets native support
// https://github.com/Microsoft/TypeScript/issues/202

export type NominalType<T, K extends string> = T & { nominal: K };
