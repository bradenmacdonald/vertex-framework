// deno-lint-ignore-file no-explicit-any
import { Neo4j } from "../../deps.ts";
import { VNID } from "./vnid.ts";
import { VDate } from "./vdate.ts";
import {
    Validator,
    TypedValidator,
    validateAnyPrimitive,
    validateBigInt,
    validateSlug,
    validateVDate,
    validateVNID,
    validateInteger,
    validateFloat,
    validateString,
    trimStringMaxLength,
    validateBoolean,
    validateDateTime,
    validateEmail,
} from "./validator.ts";

/* Export properly typed Neo4j data structures  */
export type Node = Neo4j.Node<bigint>;
export type Relationship = Neo4j.Relationship<bigint>;
export type Path = Neo4j.Path<bigint>;

export type PrimitiveValue = null|number|bigint|string|boolean|VDate|Date;
export type GenericValue = PrimitiveValue|{[key: string]: GenericValue}|GenericValue[];

/**
 * Field data types which can be used as VNode/Neo4j property types and also returned from Cypher queries.
 */
export const enum FieldType {
    // Property / primitive data types:
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
    // Future primitive/property types (also supported by Neo4j):
    // Point,
    // Duration,
    // Time,
    /**
     * An AnyPrimitive property can be any of: Null, Int, BigInt, Float, String, Boolean, Date, or DateTime.
     * (VNID and Slug are special cases of String that can't be distinguished from String by value, so are excluded.)
     */
    AnyPrimitive,

    // Composite types - cannot be used as VNode properties but can be used for almost anything else
    /** A Record is a map where the keys are known in advance */
    Record,
    /** Map: A key-value structure with arbitrary string keys that aren't known in advance (unlike Record) */
    Map,
    List,
    /** An AnyGeneric field can be a Map, List, Record, or AnyPrimitive, or any combination of those */
    AnyGeneric,

    // Response types - these can _only_ be used when specifying the shape of a Cypher query response
    VNode,
    Node,
    Relationship,
    Path,
    Any,
}

/* Basic data structure that holds data about the type of a field. */
export interface TypedField<FT extends FieldType = FieldType, Nullable extends boolean = boolean> {
    readonly type: FT,
    readonly nullable: Nullable,
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Property types: 

export type PropertyFieldType = (
    | FieldType.VNID
    | FieldType.Int
    | FieldType.BigInt
    | FieldType.Float
    | FieldType.String
    | FieldType.Slug
    | FieldType.Boolean
    | FieldType.Date
    | FieldType.DateTime
    | FieldType.AnyPrimitive
);

type GetPrimitiveValueType<FT extends PropertyFieldType> = 
    FT extends FieldType.VNID ? VNID :
    FT extends FieldType.Int ? number :
    FT extends FieldType.BigInt ? bigint :
    FT extends FieldType.Float ? number :
    FT extends FieldType.String ? string :
    FT extends FieldType.Slug ? string :
    FT extends FieldType.Boolean ? boolean :
    FT extends FieldType.Date ? VDate :
    FT extends FieldType.DateTime ? Date :
    FT extends FieldType.AnyPrimitive ? PrimitiveValue :
    never;


export interface PropertyTypedField<
    FT extends PropertyFieldType = PropertyFieldType,
    Nullable extends boolean = boolean,
> extends TypedField<FT, Nullable> {
    readonly baseValidator: Validator<GetPrimitiveValueType<FT>>;  // The base validator is always called, and is called after any custom validators
    readonly customValidator?: Validator<GetPrimitiveValueType<FT>>;  // Custom validators
}

/**
 * Properties Schema (usually for a VNodeType, but also can be used to define properties on a relationship)
 */
export interface PropSchema {
    [K: string]: PropertyTypedField<PropertyFieldType, boolean>;
}

// This helper function is used to declare variables with appropriate typing as "RS extends ResponseSchema" and not just "ResponseSchema"
export function PropSchema<PS extends PropSchema>(ps: PS): PS { return ps; }

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Composite types:

export type CompositeFieldType = (
    | FieldType.Record
    | FieldType.Map
    | FieldType.List
    | FieldType.AnyGeneric
);

export interface CompositeTypedField<
    FT extends CompositeFieldType = CompositeFieldType,
    Nullable extends boolean = boolean,
    Schema extends any = any,
> extends TypedField<FT, Nullable> {
    readonly schema: Schema;  // Defines the shape of this composite field (what type of values it holds)
}

// The record type comes in two flavors, depending on whether or not it allows response-typed values:
export type RecordTypedField        <Nullable extends boolean = boolean, Schema extends GenericSchema  = GenericSchema>  = CompositeTypedField<FieldType.Record, Nullable, Schema> & {__generic: true};
export type ResponseRecordTypedField<Nullable extends boolean = boolean, Schema extends ResponseSchema = ResponseSchema> = CompositeTypedField<FieldType.Record, Nullable, Schema>;
// Note: the `& {__generic: true};` part of RecordTypedField is not actually part of the value, but is necessary for
// TypeScript to be able to tell these types apart structurally.

// The map type comes in two flavors, depending on whether or not it allows response-typed values:
export type MapTypedField        <Nullable extends boolean = boolean, Schema extends GenericSchema[any]  = any>  = CompositeTypedField<FieldType.Map, Nullable, Schema> & {__generic: true};
export type ResponseMapTypedField<Nullable extends boolean = boolean, Schema extends ResponseSchema[any] = any> = CompositeTypedField<FieldType.Map, Nullable, Schema>;

// The list type comes in two flavors, depending on whether or not it allows response-typed values:
export type ListTypedField        <Nullable extends boolean = boolean, Schema extends GenericSchema[any]  = any>  = CompositeTypedField<FieldType.List, Nullable, Schema> & {__generic: true};
export type ResponseListTypedField<Nullable extends boolean = boolean, Schema extends ResponseSchema[any] = any> = CompositeTypedField<FieldType.List, Nullable, Schema>;

export type AnyGenericField = CompositeTypedField<FieldType.AnyGeneric, false, unknown>;

/**
 * A schema that allows property typed field and composite typed fields, but not response typed fields
 * This is useful for e.g. action parameters
 */
export interface GenericSchema {
    [K: string]: PropertyTypedField|RecordTypedField|MapTypedField|ListTypedField|AnyGenericField;
}

// This helper function is used to declare variables with appropriate typing as "RS extends ResponseSchema" and not just "ResponseSchema"
export function GenericSchema<GS extends GenericSchema>(gs: GS): GS { return gs; }

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Response types: (returned from Neo4j queries but not used for anything else)

export type ResponseFieldType = (
    | FieldType.VNode
    | FieldType.Node
    | FieldType.Relationship
    | FieldType.Path
    | FieldType.Any
);

/* A VNodeType definition for our purposes here; this file doesn't depend on any VNode-related code. */
interface AnyVNodeType {
    properties: PropSchemaWithId;
}
interface PropSchemaWithId extends PropSchema {
    id: PropertyTypedField<FieldType.VNID, false>;
}

interface VNodeTypedField<Nullable extends boolean, VNT extends AnyVNodeType> extends TypedField<FieldType.VNode, Nullable> {
    vnodeType: VNT;
}

type ResponseTypedField = (
    | VNodeTypedField<boolean, AnyVNodeType>
    | TypedField<FieldType.Node, boolean>
    | TypedField<FieldType.Relationship, boolean>
    | TypedField<FieldType.Path, boolean>
    | TypedField<FieldType.Any, boolean>
);


export interface ResponseSchema {
    [K: string]: PropertyTypedField|ResponseRecordTypedField|ResponseMapTypedField|ResponseListTypedField|AnyGenericField|ResponseTypedField;
}

// This helper function is used to declare variables with appropriate typing as "RS extends ResponseSchema" and not just "ResponseSchema"
export function ResponseSchema<RS extends ResponseSchema>(rs: RS): RS { return rs; }

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Constrcut the "Field" object that contains all the basic field types and lets you construct complex types:


export interface _PropertyTypedFieldConstructor<FT extends PropertyFieldType, Nullable extends boolean>
    extends PropertyTypedField<FT, Nullable>
{
    /** Add a custom validator for this field's value. Note that custom validators are not called if the value is null. */
    Check: (customValidator: TypedValidator<GetPrimitiveValueType<FT>>) => PropertyTypedField<FT, Nullable>
}

// These aliases are only defined to provide much nicer-looking types in the IDE (e.g. VS Code).
export type _VNIDField = _PropertyTypedFieldConstructor<FieldType.VNID, false>;
export type _NullableVNIDField = _PropertyTypedFieldConstructor<FieldType.VNID, true>;
export type _IntField = _PropertyTypedFieldConstructor<FieldType.Int, false>;
export type _NullableIntField = _PropertyTypedFieldConstructor<FieldType.Int, true>;
export type _StringField = _PropertyTypedFieldConstructor<FieldType.String, false>;
export type _NullableStringField = _PropertyTypedFieldConstructor<FieldType.String, true>;
export type _SlugField = _PropertyTypedFieldConstructor<FieldType.Slug, false>;
export type _NullableSlugField = _PropertyTypedFieldConstructor<FieldType.Slug, true>;
export type _BooleanField = _PropertyTypedFieldConstructor<FieldType.Boolean, false>;
export type _NullableBooleanField = _PropertyTypedFieldConstructor<FieldType.Boolean, true>;


/** Helper function used below to build the global "Field" constant object, which holds TypedField instances */
function makePropertyField<FT extends PropertyFieldType, Nullable extends boolean>(
    type: FT,
    nullable: Nullable,
    baseValidator: Validator<GetPrimitiveValueType<FT>>,  // The base validator is always called, and is called last
    defaultValidator?: Validator<GetPrimitiveValueType<FT>>,  // The default validator, which can be completely overridden and replaced with a custom validator
    customValidator?: Validator<GetPrimitiveValueType<FT>>,  // A custom validator to add to this field. It will override any "default validator" but can be chained with multiple custom validators.
): _PropertyTypedFieldConstructor<FT, Nullable> {
    return {
        type,
        nullable,
        baseValidator,
        customValidator: customValidator ?? defaultValidator,
        Check: (newCustomValidator: TypedValidator<GetPrimitiveValueType<FT>>) => makePropertyField(type, nullable, baseValidator, defaultValidator, (_value: unknown) => {
            let value = baseValidator(_value);
            if (customValidator && customValidator !== defaultValidator) {
                value = customValidator(value);
            }
            return newCustomValidator(value);
        }),
    };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function _getFieldTypes<Nullable extends boolean>(nullable: Nullable) {
    return {
        // Note: all of the code below should work just fine without th "as Nullable extends ?..." part.
        // It is just used to give these types nicer names when field schemas are viewed in an IDE.
        VNID: makePropertyField(FieldType.VNID, nullable, validateVNID) as Nullable extends true ? _NullableVNIDField : _VNIDField,
        Int: makePropertyField(FieldType.Int, nullable, validateInteger) as Nullable extends true ? _NullableIntField : _IntField,
        /** A signed integer up to 64 bits. For larger than 64 bits, use a string type as Neo4j doesn't support it. */
        BigInt: makePropertyField(FieldType.BigInt, nullable, validateBigInt),
        Float: makePropertyField(FieldType.Float, nullable, validateFloat),
        /**
         * A String.
         * By default:
         *   - an empty string is allowed
         *   - whitespace is trimmed from the beginning and end of the string
         *   - string length is limited to 1,000 characters
         * If you need anything different from the above defaults, call .Check(newValidator) with custom validation.
         * e.g. using https://deno.land/x/computed_types :
         *     myString: Field.String.Check(string.min(2).max(100))
         */
        String: makePropertyField(FieldType.String, nullable, validateString, trimStringMaxLength(1_000)) as Nullable extends true ? _NullableStringField : _StringField,
        /** A unicode-aware slug (cannot contain spaces/punctuation). Valid: "the-thing". Invalid: "foo_bar" or "foo bar" */
        Slug: makePropertyField(FieldType.Slug, nullable, validateSlug, trimStringMaxLength(60)) as Nullable extends true ? _NullableSlugField : _SlugField,
        Boolean: makePropertyField(FieldType.Boolean, nullable, validateBoolean) as Nullable extends true ? _NullableBooleanField : _BooleanField,
        /** A calendar date, i.e. a date without time information */
        Date: makePropertyField(FieldType.Date, nullable, validateVDate),
        DateTime: makePropertyField(FieldType.DateTime, nullable, validateDateTime),

        /** A Record is a map where the keys are known in advance. */
        Record: <Schema extends GenericSchema|ResponseSchema>(schema: Schema): (
            // Default to a "Generic" record/schema if possible, but if the schema includes some neo4j-response-specific
            // types like Field.Node, then use a Response Record
            Schema extends GenericSchema ? RecordTypedField<Nullable, Schema> :
            Schema extends ResponseSchema ? ResponseRecordTypedField<Nullable, Schema> :
            never) => ({
            type: FieldType.Record as const, schema, nullable,
        } as any),

        /** Map: A key-value structure with arbitrary string keys that aren't known in advance (unlike Record). */
        Map: <Schema extends GenericSchema[any]|ResponseSchema[any]>(schema: Schema): (
            // Default to a "Generic" record/schema if possible, but if the schema includes some neo4j-response-specific
            // types like Field.Node, then use a Response Record
            Schema extends GenericSchema[any] ? MapTypedField<Nullable, Schema> :
            Schema extends ResponseSchema[any] ? ResponseMapTypedField<Nullable, Schema> :
            never) => ({
            type: FieldType.Map as const, schema, nullable,
        } as any),

        List: <Schema extends GenericSchema[any]|ResponseSchema[any]>(schema: Schema): (
            // Default to a "Generic" record/schema if possible, but if the schema includes some neo4j-response-specific
            // types like Field.Node, then use a Response Record
            Schema extends GenericSchema[any] ? ListTypedField<Nullable, Schema> :
            Schema extends ResponseSchema[any] ? ResponseListTypedField<Nullable, Schema> :
            never) => ({
            type: FieldType.List as const, schema, nullable,
        } as any),

        // Pass through of the types used by the underlying Neo4j JavaScript driver:
        Node: {type: FieldType.Node as const, nullable, schema: undefined},
        Relationship: {type: FieldType.Relationship as const, nullable, schema: undefined},
        Path: {type: FieldType.Path as const, nullable, schema: undefined},
        /** A Raw VNode: includes all of its properties but not virtual props or derived props */
        VNode: <VNT extends AnyVNodeType>(vnodeType: VNT): VNodeTypedField<Nullable, VNT> => ({
            type: FieldType.VNode as const, nullable, vnodeType,
        }),
    };
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
    ..._getFieldTypes(false),
    // The nullable versions of all of the above:
    NullOr: {
        ..._getFieldTypes(true),
    },
    AnyPrimitive: makePropertyField(FieldType.AnyPrimitive as const, true, validateAnyPrimitive),

    Any: {type: FieldType.Any as const, nullable: false as const, schema: undefined},
    AnyGeneric: {type: FieldType.AnyGeneric as const, nullable: false as const, schema: undefined} as AnyGenericField,

    // Helpful validators
    validators: {
        email: validateEmail,
    },
});

/**
 * TypeScript helper type to get the underlying TypeScript/Javascript data type for a given field declaration.
 */
export type GetDataType<FieldSpec extends TypedField> = (
    (FieldSpec extends TypedField<any, true> ? null : never) | (
        FieldSpec extends PropertyTypedField<infer FT, any> ? GetPrimitiveValueType<FT> :

        FieldSpec extends ResponseRecordTypedField<any, infer Schema> ? { [K in keyof Schema]: GetDataType<Schema[K]> } :  // Works for Generic record or response record
        FieldSpec extends ResponseMapTypedField<any, infer Schema> ? { [K: string]: GetDataType<Schema> } :  // Works for Generic map or response map
        FieldSpec extends ResponseListTypedField<any, infer Schema> ? GetDataType<Schema>[] :  // Works for Generic list or response list
        FieldSpec extends CompositeTypedField<FieldType.AnyGeneric, any, any> ? GenericValue :

        FieldSpec extends VNodeTypedField<any, infer VNT> ?
            (VNT extends AnyVNodeType ? GetDataShape<VNT["properties"]> & {_labels: string[]} : {error: "Invalid VNodeType"}) :
        FieldSpec extends TypedField<FieldType.Node, any> ? Node :
        FieldSpec extends TypedField<FieldType.Relationship, any> ? Relationship :
        FieldSpec extends TypedField<FieldType.Path, any> ? Path :
        FieldSpec extends TypedField<FieldType.Any, any> ? any :
        {error: "unknown FieldType", got: FieldSpec}
    )
);

export type GetDataShape<Schema extends ResponseSchema> = {
    [K in keyof Schema]: GetDataType<Schema[K]>;
}

/**
 * Validate that a value matches the given field definition. Returns the "cleaned" value. Throw an exception if not.
 *
 * This may or may not coerce values to the expected type, depending on what validators are used. Most of the default
 * validators do _not_ coerce types, other than Neo4j.Date->VDate and Neo4j.DateTime->Date
 *
 * @param fieldType The Field definition, e.g. Field.NullOr.Float or Field.Int.Check(number.min(-5))
 * @param value The value to validate
 * @returns The validated value
 */
export function validateValue<FD extends PropertyTypedField<any, any>>(fieldType: FD, value: any): GetDataType<FD> {
    if (value === null) {
        // Skip validators if the value is null, but make sure null is a valid value:
        if (!fieldType.nullable) {
            throw new Error("Value is not allowed to be null");
        }
        return value;
    }

    if (fieldType.customValidator) {
        // Not that the code in Check() which accepts the custom validator also configures the base validator to run
        // first, so that the custom validator knows that 'value' is already the right type and is not 'unknown' type.
        value = fieldType.customValidator(value);
    }

    // Make sure the custom validator didn't change the fundamental type, or violate the base validator:
    value = fieldType.baseValidator(value);
    return value;
}


/**
 * Validate that a collection of values matches the given schema. Returns an object with "cleaned" property values or
 * throw an exception.
 * 
 * This will only validate known properties from the schema, and additional properties are returned unmodified.
 *
 * @param propSchema The PropSchema definition
 * @param value The object with keys and values to validate
 * @returns The validated/cleaned object
 */
export function validatePropSchema<PS extends PropSchema>(propSchema: PS, value: any): GetDataShape<PS> {
    const newValue = {...value};

    for (const key in propSchema) {
        const fieldType = propSchema[key];
        newValue[key] = validateValue(fieldType, value[key]);
    }

    return newValue;
}
