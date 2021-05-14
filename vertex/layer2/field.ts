import { Node as _Node, Relationship as _Relationship, Path as _Path } from "neo4j-driver-lite";
import Joi from "@hapi/joi";
import { isVNID, VNID } from "../lib/vnid";
import { VDate, isNeo4jDate } from "../lib/vdate";

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

    // Composite types - cannot be used as VNode properties but can be used for almost anything else
    /** A Record is a map where the keys are known in advance */
    Record,
    // Map: A key-value structure with arbitrary string keys?
    List,
    // Union type? Unknown/Any type?

    // Response types - these can _only_ be used when specifying the shape of a Cypher query response
    VNode,
    Node,
    Relationship,
    Path,
    Any,
}

/* Basic data structure that holds data about the type of a field. */
export interface TypedField<FT extends FieldType = FieldType, Nullable extends boolean = boolean, SchemaType = any> {
    readonly type: FT,
    readonly nullable: Nullable,
    /** Schema: A Joi schema (validator) for property types, but has different uses for other types. */
    readonly schema: SchemaType,
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
);


export type PropertyTypedField<FT extends PropertyFieldType = PropertyFieldType, Nullable extends boolean = boolean, SchemaType extends Joi.AnySchema = Joi.AnySchema>
    = TypedField<FT, Nullable, SchemaType>;

/**
 * Properties Schema (usually for a VNodeType, but also can be used to define properties on a relationship)
 */
export interface PropSchema {
    [K: string]: PropertyTypedField;
}

// This helper function is used to declare variables with appropriate typing as "RS extends ResponseSchema" and not just "ResponseSchema"
export function PropSchema<PS extends PropSchema>(ps: PS): PS { return ps; }

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Composite types:

export type CompositeFieldType = (
    | FieldType.Record
    | FieldType.List
);

// The record type comes in two flavors, depending on whether or not it allows response-typed values:
export type RecordTypedField        <Nullable extends boolean = boolean, Schema extends GenericSchema  = GenericSchema>  = TypedField<FieldType.Record, Nullable, Schema> & {__generic: true};
export type ResponseRecordTypedField<Nullable extends boolean = boolean, Schema extends ResponseSchema = ResponseSchema> = TypedField<FieldType.Record, Nullable, Schema>;

// The list type comes in two flavors, depending on whether or not it allows response-typed values:
export type ListTypedField        <Nullable extends boolean = boolean, Schema extends GenericSchema[any]  = any>  = TypedField<FieldType.List, Nullable, Schema> & {__generic: true};
export type ResponseListTypedField<Nullable extends boolean = boolean, Schema extends ResponseSchema[any] = any> = TypedField<FieldType.List, Nullable, Schema>;

/**
 * A schema that allows property typed field and composite typed fields, but not response typed fields
 * This is useful for e.g. action parameters
 */
export interface GenericSchema {
    [K: string]: PropertyTypedField|RecordTypedField|ListTypedField;
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
    id: TypedField<FieldType.VNID, false, any>;
}

type ResponseTypedField = (
    | TypedField<FieldType.VNode, boolean, AnyVNodeType>
    | TypedField<FieldType.Node, boolean, undefined>
    | TypedField<FieldType.Relationship, boolean, undefined>
    | TypedField<FieldType.Path, boolean, undefined>
    | TypedField<FieldType.Any, boolean, undefined>
);


export interface ResponseSchema {
    [K: string]: PropertyTypedField|ResponseRecordTypedField|ResponseListTypedField|ResponseTypedField;
}

// This helper function is used to declare variables with appropriate typing as "RS extends ResponseSchema" and not just "ResponseSchema"
export function ResponseSchema<RS extends ResponseSchema>(rs: RS): RS { return rs; }

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Constrcut the "Field" object that contains all the basic field types and lets you construct complex types:


export interface _PropertyTypedFieldConstructor<FT extends PropertyFieldType = PropertyFieldType, Nullable extends boolean = boolean, SchemaType extends Joi.AnySchema = Joi.AnySchema>
    extends TypedField<FT, Nullable, SchemaType>
{
    Check: (validationFunction: (baseSchema: SchemaType) => SchemaType) => PropertyTypedField<FT, Nullable, SchemaType>
}

// These aliases are only defined to provide much nicer-looking types in the IDE (e.g. VS Code).
export type _VNIDField = _PropertyTypedFieldConstructor<FieldType.VNID, false, Joi.StringSchema>;
export type _NullableVNIDField = _PropertyTypedFieldConstructor<FieldType.VNID, true, Joi.StringSchema>;
export type _IntField = _PropertyTypedFieldConstructor<FieldType.Int, false, Joi.NumberSchema>;
export type _NullableIntField = _PropertyTypedFieldConstructor<FieldType.Int, true, Joi.NumberSchema>;
export type _StringField = _PropertyTypedFieldConstructor<FieldType.String, false, Joi.StringSchema>;
export type _NullableStringField = _PropertyTypedFieldConstructor<FieldType.String, true, Joi.StringSchema>;
export type _SlugField = _PropertyTypedFieldConstructor<FieldType.Slug, false, Joi.StringSchema>;
export type _NullableSlugField = _PropertyTypedFieldConstructor<FieldType.Slug, true, Joi.StringSchema>;
export type _BooleanField = _PropertyTypedFieldConstructor<FieldType.Boolean, false, Joi.StringSchema>;
export type _NullableBooleanField = _PropertyTypedFieldConstructor<FieldType.Boolean, true, Joi.StringSchema>;


/** Helper function used below to build the global "Field" constant object, which holds TypedField instances */
function makePropertyField<FT extends PropertyFieldType, Nullable extends boolean, SchemaType extends Joi.AnySchema>(
    type: FT,
    nullable: Nullable,
    baseSchema: SchemaType
): _PropertyTypedFieldConstructor<FT, Nullable, SchemaType> {
    return {
        type,
        nullable,
        schema: nullable ? baseSchema.required().allow(null) : baseSchema.required(),
        Check: (validationFunction: (baseSchema: SchemaType) => SchemaType) => makePropertyField(type, nullable, validationFunction(baseSchema)),
    };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function _getFieldTypes<Nullable extends boolean>(nullable: Nullable) {
    return {
        // Note: all of the code below should work just fine without th "as unknown as Nullable extends ?..." part.
        // It is just used to give these types nicer names when field schemas are viewed in an IDE.
        VNID: makePropertyField(FieldType.VNID, nullable, Joi.string().custom(vnidValidator)) as unknown as Nullable extends true ? _NullableVNIDField : _VNIDField,
        Int: makePropertyField(FieldType.Int, nullable, Joi.number().integer()) as unknown as Nullable extends true ? _NullableIntField : _IntField,
        /** A signed integer up to 64 bits. For larger than 64 bits, use a string type as Neo4j doesn't support it. */
        BigInt: makePropertyField(FieldType.BigInt, nullable, Joi.any().custom(validateBigInt)),
        Float: makePropertyField(FieldType.Float, nullable, Joi.number()),
        /** A String. Default max length is 1,000, so use .Check(s => s.max(...)) if you need to change the limit. */
        String: makePropertyField(FieldType.String, nullable, Joi.string().max(1_000)) as unknown as Nullable extends true ? _NullableStringField : _StringField,
        /** A unicode-aware slug (cannot contain spaces/punctuation). Valid: "the-thing". Invalid: "foo_bar" or "foo bar" */
        Slug: makePropertyField(FieldType.Slug, nullable, Joi.string().regex(slugRegex).max(60)) as unknown as Nullable extends true ? _NullableSlugField : _SlugField,
        Boolean: makePropertyField(FieldType.Boolean, nullable, Joi.boolean()) as unknown as Nullable extends true ? _NullableBooleanField : _BooleanField,
        /** A calendar date, i.e. a date without time information */
        Date: makePropertyField(FieldType.Date, nullable, Joi.any().custom(validateDate)),
        DateTime: makePropertyField(FieldType.DateTime, nullable, Joi.date().iso()),
    
        Record: <Schema extends GenericSchema|ResponseSchema>(schema: Schema): (
            // Default to a "Generic" record/schema if possible, but if the schema includes some neo4j-response-specific
            // types like Field.Node, then use a Response Record
            Schema extends GenericSchema ? RecordTypedField<Nullable, Schema> :
            Schema extends ResponseSchema ? ResponseRecordTypedField<Nullable, Schema> :
            never) => ({
            type: FieldType.Record as const, schema, nullable,
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
        VNode: <VNT extends AnyVNodeType>(vnodeType: VNT): TypedField<FieldType.VNode, Nullable, VNT> => ({
            type: FieldType.VNode as const, nullable, schema: vnodeType,
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
    Any: {type: FieldType.Any as const, nullable: false as const, schema: undefined},

    // Convenience definition to get Joi via Field.Check
    // e.g. to use things like Field.Int.Check(n=>n.min(Field.Check.Ref("otherField")))
    Check: Joi,
});

/**
 * TypeScript helper type to get the underlying TypeScript/Javascript data type for a given field declaration.
 */
export type GetDataType<FieldSpec extends TypedField> = (
    (FieldSpec extends TypedField<any, true, any> ? null : never) | (
        FieldSpec extends TypedField<FieldType.VNID, any, any> ? VNID :
        FieldSpec extends TypedField<FieldType.Int, any, any> ? number :
        FieldSpec extends TypedField<FieldType.BigInt, any, any> ? bigint :
        FieldSpec extends TypedField<FieldType.Float, any, any> ? number :
        FieldSpec extends TypedField<FieldType.String, any, any> ? string :
        FieldSpec extends TypedField<FieldType.Slug, any, any> ? string :
        FieldSpec extends TypedField<FieldType.Boolean, any, any> ? boolean :
        FieldSpec extends TypedField<FieldType.Date, any, any> ? VDate :
        FieldSpec extends TypedField<FieldType.DateTime, any, any> ? Date :

        FieldSpec extends ResponseRecordTypedField<any, infer Schema> ? { [K in keyof Schema]: GetDataType<Schema[K]> } :  // Works for Generic record or response record
        FieldSpec extends ResponseListTypedField<any, infer Schema> ? GetDataType<Schema>[] :  // Works for Generic list or response list

        FieldSpec extends TypedField<FieldType.VNode, any, infer VNT> ?
            (VNT extends AnyVNodeType ? GetDataShape<VNT["properties"]> & {_labels: string[]} : {error: "Invalid VNodeType"}) :
        FieldSpec extends TypedField<FieldType.Node, any, any> ? Node :
        FieldSpec extends TypedField<FieldType.Relationship, any, any> ? Relationship :
        FieldSpec extends TypedField<FieldType.Path, any, any> ? Path :
        FieldSpec extends TypedField<FieldType.Any, any, any> ? any :
        {error: "unknown FieldType", got: FieldSpec}
    )
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
 * @param fieldType The Field definition, e.g. Field.NullOr.Float or Field.Int.Check(i => i.min(0))
 * @param value The value to validate
 * @returns The validated value
 */
export function validateValue<FD extends PropertyTypedField<any, any, any>>(fieldType: FD, value: any): GetDataType<FD> {
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
    // Build a Joi.object() schema, using the "schema" property of every TypedField in the propSchema:
    const joiSchemaObj = Joi.object(Object.fromEntries(
        Object.entries(propSchema).map(([key, fieldDeclaration]) => [key, fieldDeclaration.schema])
    ));
    const result = joiSchemaObj.validate(value, {convert: false, ...options});
    if (result.error) {
        throw result.error;
    }
    return result.value;
}
