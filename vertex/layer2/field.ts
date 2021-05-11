import { Node as _Node, Relationship as _Relationship, Path as _Path } from "neo4j-driver-lite";
import Joi from "@hapi/joi";
import { isVNID, VNID } from "../lib/vnid";
import { VDate, isNeo4jDate } from "../lib/vdate";

import type { BaseVNodeType, RawVNode } from "./vnode-base";

/* Export properly typed Neo4j data structures  */
export type Node = _Node<bigint>;
export type Relationship = _Relationship<bigint>;
export type Path = _Path<bigint>;

/* Validation helpers for specific types */

/** Custom VNID Validator for Joi */
const vnidValidator: Joi.CustomValidator = (value, helpers) => {
    // An alternative is to use this regex: /^_[0-9A-Za-z]{1,22}$/
    if (!isVNID(value)) {
        throw new Error("Invalid VNID");
    }
    return value;
};
const max64bitInt = 2n**63n - 1n;
const min64bitInt = -(2n**64n - 1n);
/** Custom Joi validator to add BigInt support. Won't work with other number-related validators like min() though. */
const validateBigInt: Joi.CustomValidator = (value, helpers) => {
    if (typeof value === "bigint") {
        // "The Neo4j type system uses 64-bit signed integer values. The range of values is between -(2**64- 1) and
        // (2**63- 1)." So we reject BigInts outside of that range.
        if (value > max64bitInt || value < min64bitInt) {
            throw new Error("BigInt value is outside of Neo4j's supported 64 bit range.");
        }
        return value;  // It's already a BigInt, return it unchanged.
    } else {
        // Note that we don't automatically convert strings or any other data type.
        throw new Error("Not a BigInt value.");
    }
};
/** Custom Joi validator to add Date (without time) support. */
const validateDate: Joi.CustomValidator = (value, helpers) => {
    if (value instanceof VDate) {
        return value;
    } else if (isNeo4jDate(value)) {
        return VDate.fromNeo4jDate(value);
    } else if (value instanceof Date) {
        throw new Error("Don't use JavaScript Date objects for calendar dates - too many timezone problems. Try VDate.fromString(\"YYYY-MM-DD\") instead.");
    } else {
        throw new Error("Not a date value.");
    }
};
/** Validation regex for Unicode-aware slugs */
const slugRegex = /^[-\p{Alphabetic}\p{Mark}\p{Decimal_Number}\p{Join_Control}]+$/u;

/**
 * Field data types which can be used as VNode/Neo4j property types and also returned from Cypher queries.
 */
export const enum FieldType {
    Any,
    VNID,
    Int,
    BigInt,
    Float,
    String,
    /** A unicode-aware slug (cannot contain spaces/punctuation). Valid: "the-thing". Invalid: "foo_bar" or "foo bar" */
    Slug,
    Boolean,
    /** A date without any time format. */
    Date,
    DateTime,
    // Future types (also supported by Neo4j): Point, Duration, Time
    _max  // Unused, just to get the max value
}

/**
 * Types which can be returned from Cypher queries but cannot be used for VNode properties:
 */
export const enum ResponseFieldType {
    Node = 100,
    Relationship,
    Path,
    Map,
    List,
    VNode,
    _max  // Unused, just to get the max value
}

/* Our internal field data type */
export interface FieldData<FT extends FieldType = FieldType, Nullable extends boolean = boolean, SchemaType extends Joi.AnySchema = Joi.AnySchema> {
    readonly type: FT,
    readonly nullable: Nullable,
    readonly schema: SchemaType,
    // Check: (validationFunction: (baseSchema: SchemaType) => SchemaType) => FieldData<FT, Nullable, SchemaType>
}

/** Helper function used below to build the global "Field" constant object, which holds FieldData instances */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const makeField = <FT extends FieldType, Nullable extends boolean, SchemaType extends Joi.AnySchema>(type: FT, nullable: Nullable, baseSchema: SchemaType) => ({
    type,
    nullable,
    schema: baseSchema,
    Check: (validationFunction: (baseSchema: SchemaType) => SchemaType) => makeField(type, nullable, validationFunction(baseSchema)),
});

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const makeFieldWithOrNull = <FT extends FieldType, SchemaType extends Joi.AnySchema>(type: FT, baseSchema: SchemaType) => ({
    ...makeField(type, false, baseSchema.required()),
    OrNull: makeField(type, true, baseSchema.required().allow(null)),
});

/**
 * Properties Schema (usually for a VNodeType, but also can be used to define properties on a relationship)
 * 
 * This represents a generic schema, used to define the properties allowed/expected on a graph node, relationship, etc.
 */
export interface PropSchema {
    [K: string]: FieldData;
}

/**
 * Response fields are data types that can be returned from queries, but not used as VNode properties
 */
export interface ResponseField<FT extends ResponseFieldType = ResponseFieldType, Nullable extends boolean = boolean> {
    readonly type: FT;
    readonly nullable: Nullable;
}
export type ResponseFieldSpec = FieldData|ResponseField;
export interface ResponseSchema {
    [K: string]: ResponseFieldSpec;
}
// This helper function is used to declare variables with appropriate typing as "RS extends ResponseSchema" and not just "ResponseSchema"
export function ResponseSchema<RS extends ResponseSchema>(rs: RS): RS { return rs; }

// Map field type - only used for specifying the return shape of custom/complex cypher queries
interface MapFieldSpec { [k: string]: ResponseFieldSpec; }
export interface MapField<Spec extends MapFieldSpec = MapFieldSpec, Nullable extends boolean = boolean> extends ResponseField<ResponseFieldType.Map, Nullable> {
    readonly spec: Spec,
}
// List field type - only used for specifying the return shape of custom/complex cypher queries
export interface ListField<Spec extends ResponseFieldSpec = ResponseFieldSpec, Nullable extends boolean = boolean> extends ResponseField<ResponseFieldType.List, Nullable> {
    readonly spec: Spec,
}
// Raw VNode Type - a VNode with all of its properties (but no virtual properties or derived properties)
export interface RawVNodeField<VNT extends BaseVNodeType = any, Nullable extends boolean = boolean> extends ResponseField<ResponseFieldType.VNode, Nullable> {
    readonly vnodeType: VNT;
}

/**
 * Vertex Framework basic field types.
 * 
 * Most of these types can be used for two purposes:
 *  (1) for defining schema of a VNode's (its required properties and their types). For this use, you can also use
 *      .Check(v => v.blah()) to add in additional validation constraints using Joi's validation API.
 *  (2) for specifying the return shape of Cypher queries made to the Neo4j database.
 */
export const Field = Object.freeze({
    Any: makeField(FieldType.Any, false, Joi.any()),
    VNID: makeFieldWithOrNull(FieldType.VNID, Joi.string().custom(vnidValidator)),
    Int: makeFieldWithOrNull(FieldType.Int, Joi.number().integer()),
    /** A signed integer up to 64 bits. For larger than 64 bits, use a string type as Neo4j doesn't support it. */
    BigInt: makeFieldWithOrNull(FieldType.BigInt, Joi.any().custom(validateBigInt)),
    Float: makeFieldWithOrNull(FieldType.Float, Joi.number()),
    /** A String. Default max length is 1,000, so use .Check(s => s.max(...)) if you need to change the limit. */
    String: makeFieldWithOrNull(FieldType.String, Joi.string().max(1_000)),
    /** A unicode-aware slug (cannot contain spaces/punctuation). Valid: "the-thing". Invalid: "foo_bar" or "foo bar" */
    Slug: makeFieldWithOrNull(FieldType.Slug, Joi.string().regex(slugRegex).max(60)),
    Boolean: makeFieldWithOrNull(FieldType.Boolean, Joi.boolean()),
    /** A calendar date, i.e. a date without time information */
    Date: makeFieldWithOrNull(FieldType.Date, Joi.any().custom(validateDate)),
    DateTime: makeFieldWithOrNull(FieldType.DateTime, Joi.date().iso()),

    // Special field types that can be returned from Cypher queries, but not used as property types:
    Map: <M extends MapFieldSpec>(m: M): MapField<M, false> & {OrNull: MapField<M, true>} => ({
        type: ResponseFieldType.Map as const, spec: m, nullable: false as const,
        OrNull: {type: ResponseFieldType.Map as const, spec: m, nullable: true as const},
    }),
    List: <L extends ResponseFieldSpec>(valueType: L): ListField<L, false> & {OrNull: ListField<L, true>} => ({
        type: ResponseFieldType.List as const, spec: valueType, nullable: false as const,
        OrNull: {type: ResponseFieldType.List as const, spec: valueType, nullable: true as const},
    }),
    // Pass through of the types used by the underlying Neo4j JavaScript driver:
    Node: {
        type: ResponseFieldType.Node as const, nullable: false as const,
        OrNull: {type: ResponseFieldType.Node as const, nullable: true as const}
    },
    Relationship: {
        type: ResponseFieldType.Relationship as const, nullable: false as const,
        OrNull: {type: ResponseFieldType.Relationship as const, nullable: true as const}
    },
    Path: {
        type: ResponseFieldType.Path as const, nullable: false as const,
        OrNull: {type: ResponseFieldType.Path as const, nullable: true as const}
    },
    /** A Raw VNode: includes all of its properties but not virtual props or derived props */
    VNode: <VNT extends BaseVNodeType>(vnodeType: VNT) => ({
        type: ResponseFieldType.VNode as const, nullable: false as const, vnodeType,
        OrNull: {type: ResponseFieldType.VNode as const, nullable: true as const, vnodeType,},
    }),

    // Convenience definition to get Joi via Field.Check
    // e.g. to use things like Field.Int.Check(n=>n.min(Field.Check.Ref("otherField")))
    Check: Joi,
});

/**
 * TypeScript helper type to get the underlying TypeScript/Javascript data type for a given field declaration.
 */
export type GetDataType<FieldSpec extends ResponseFieldSpec> = (
    FieldSpec extends FieldData<any, any, any> ?
        (FieldSpec extends FieldData<any, true, any> ? null : never) | (
            FieldSpec extends FieldData<FieldType.Any, any, any> ? any :
            FieldSpec extends FieldData<FieldType.VNID, any, any> ? VNID :
            FieldSpec extends FieldData<FieldType.Int, any, any> ? number :
            FieldSpec extends FieldData<FieldType.BigInt, any, any> ? bigint :
            FieldSpec extends FieldData<FieldType.Float, any, any> ? number :
            FieldSpec extends FieldData<FieldType.String, any, any> ? string :
            FieldSpec extends FieldData<FieldType.Slug, any, any> ? string :
            FieldSpec extends FieldData<FieldType.Boolean, any, any> ? boolean :
            FieldSpec extends FieldData<FieldType.Date, any, any> ? VDate :
            FieldSpec extends FieldData<FieldType.DateTime, any, any> ? Date :
            {error: "unknown FieldType"}
        ) :
    FieldSpec extends ResponseField<any, any> ?
        (FieldSpec extends ResponseField<any, true> ? null : never) | (
            FieldSpec extends MapField<infer Spec> ? { [K in keyof Spec]: GetDataType<Spec[K]> } :
            FieldSpec extends ListField<infer Spec> ? GetDataType<Spec>[] :
            FieldSpec extends ResponseField<ResponseFieldType.Node, any> ? Node :
            FieldSpec extends ResponseField<ResponseFieldType.Relationship, any> ? Relationship :
            FieldSpec extends ResponseField<ResponseFieldType.Path, any> ? Path :
            FieldSpec extends RawVNodeField<infer VNT, any> ? 
                RawVNode<FieldSpec["vnodeType"]>
            :
            {error: "unknown Response FieldType"}
        ) :
    never
);

export type GetDataShape<Schema extends ResponseSchema> = {
    [K in keyof Schema]: GetDataType<Schema[K]>;
}

/**
 * Validate that a value matches the given field definition. Throw an exception if not.
 *
 * This will not attempt to cast/coerce values to the correct type, because doing so could mask the fact that
 * inconsistently type values are stored in the database.
 *
 * @param fieldType The Field definition, e.g. Field.Float.OrNull or Field.Int.Check(i => i.min(0))
 * @param value The value to validate
 * @returns The validated value
 */
export function validateValue<FD extends FieldData<any, any, any>>(fieldType: FD, value: any): GetDataType<FD> {
    const result = fieldType.schema.validate(value, {convert: false});
    if (result.error) {
        throw result.error;
    }
    return result.value;
}


/**
 * Validate that a collection of values matches the given schema. Throw an exception if not.
 *
 * @param propSchema The PropSchema definition
 * @param value The object with keys and values to validate
 * @returns The validated object
 */
export function validatePropSchema<PS extends PropSchema>(propSchema: PS, value: any, options?: Joi.ValidationOptions): GetDataShape<PS> {
    // Build a Joi.object() schema, using the "schema" property of every FieldData in the propSchema:
    const joiSchemaObj = Joi.object(Object.fromEntries(
        Object.entries(propSchema).map(([key, fieldData]) => [key, fieldData.schema])
    ));
    const result = joiSchemaObj.validate(value, {convert: false, ...options});
    if (result.error) {
        throw result.error;
    }
    return result.value;
}
