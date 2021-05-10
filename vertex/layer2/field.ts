import Joi, { AnySchema } from "@hapi/joi";
import {Date as Neo4jDate, isDate as isNeo4jDate} from "neo4j-driver-lite";
import { VNID } from "../lib/vnid";

import { BaseVNodeType } from "./vnode-base";

/**
 * A calendar date (a date without any time).
 *
 * This subclasses the Neo4j "Date" type and is compatible with it.
 * This mostly exists to add "toJSON" and "fromString".
 */
export class VDate extends Neo4jDate<number> {
    /**
     * Construct a VDate from an ISO 8601 date string "YYYY-MM-DD" or "YYYYMMDD"
     * @param {string} str - An ISO 8601 date string
     * @returns {PDate}
     */
    public static fromString(str: string): VDate {
        const year = parseInt(str.substr(0, 4), 10);
        let month = NaN;
        let day = NaN;
        if (str.length === 10 && str.charAt(4) === "-" && str.charAt(7) === "-") {
            // YYYY-MM-DD format, presumably:
            month = parseInt(str.substr(5, 2), 10);
            day = parseInt(str.substr(8, 2), 10);
        } else if (str.length === 8 && String(parseInt(str, 10)) === str) {
            // YYYYMMDD format, presumably.
            // (Note we check 'String(parseInt(str, 10)) === str' to avoid matching things like '05/05/05')
            month = parseInt(str.substr(4, 2), 10);
            day = parseInt(str.substr(6, 2), 10);
        }
        if (isNaN(year) || isNaN(month) || isNaN(day)) {
            throw new Error("Date string not in YYYY-MM-DD or YYYYMMDD format");
        }
        return new VDate(year, month, day);
    }
    static fromNeo4jDate(date: Neo4jDate<number>): VDate { return new VDate(date.year, date.month, date.day); }
    static fromStandardDate(standardDate: Date): VDate { return this.fromNeo4jDate(Neo4jDate.fromStandardDate(standardDate)); }

    public toJSON(): string { return this.toString(); }
}

/* Validation helpers for specific types */

const vnidRegex = /^_[0-9A-Za-z]{1,22}$/;
/** Custom Joi validator to add BigInt support. Won't work with other number-related validators like min() though. */
const validateBigInt: Joi.CustomValidator = (value, helpers) => {
    if (typeof value === "bigint") {
        return value;  // It's already a BigInt, return it unchanged.
    } else if (typeof value === "number") {
        // Try to coerce it to BigInt, throw an error if not possible
        return BigInt(value);
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
    } else if (typeof value === "string") {
        return VDate.fromString(value);
    } else {
        throw new Error("Not a date value.");
    }
};

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
    Boolean,
    /** A date without any time format. */
    Date,
    DateTime,
    // Future types (also supported by Neo4j): Point, Duration, Time
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
}

/* Our internal field data type */
const schema = Symbol("schema");
interface FieldData<FT extends FieldType, Nullable extends boolean, SchemaType extends Joi.AnySchema> {
    readonly type: FT,
    readonly nullable: Nullable,
    [schema]: SchemaType,
    Check: (validationFunction: (baseSchema: SchemaType) => SchemaType) => FieldData<FT, Nullable, SchemaType>
}

interface FieldDataRequired<FT extends FieldType, SchemaType extends Joi.AnySchema> extends FieldData<FT, false, SchemaType> {
    OrNull: FieldData<FT, true, SchemaType>,
}

const makeField = <FT extends FieldType, Nullable extends boolean, SchemaType extends Joi.AnySchema>(type: FT, nullable: Nullable, baseSchema: SchemaType): FieldData<FT, Nullable, SchemaType> => ({
    type,
    nullable,
    [schema]: baseSchema,
    Check: (validationFunction: (baseSchema: SchemaType) => SchemaType) => makeField(type, nullable, validationFunction(baseSchema)),
});

const makeFieldWithOrNull = <FT extends FieldType, SchemaType extends Joi.AnySchema>(type: FT, baseSchema: SchemaType): FieldDataRequired<FT, SchemaType> => ({
    ...makeField(type, false, baseSchema.required()),
    OrNull: makeField(type, true, baseSchema.required().allow(null)),
});

/**
 * Response fields are data types that can be returned from queries, but not used as VNode properties
 */
interface ResponseField {
    readonly type: ResponseFieldType;
    readonly nullable: boolean;
}
type ResponseFieldSpec = FieldData<any, any, any>|ResponseField|BaseVNodeType;

// Map field type - only used for specifying the return shape of custom/complex cypher queries
interface MapFieldSpec { [k: string]: ResponseFieldSpec; }
interface MapField<Spec extends MapFieldSpec> extends ResponseField {
    readonly type: ResponseFieldType.Map,
    readonly spec: Spec,
}
interface MapFieldRequired<Spec extends MapFieldSpec> extends MapField<Spec> {
    readonly nullable: false;
    OrNull: MapFieldOrNull<Spec>;
}
interface MapFieldOrNull<Spec extends MapFieldSpec> extends MapField<Spec> {
    readonly nullable: true;
}

// List field type - only used for specifying the return shape of custom/complex cypher queries
interface ListField<Spec extends ResponseFieldSpec> extends ResponseField {
    readonly type: ResponseFieldType.List,
    readonly spec: Spec,
}
interface ListFieldRequired<Spec extends ResponseFieldSpec> extends ListField<Spec> {
    readonly nullable: false;
    OrNull: ListFieldOrNull<Spec>;
}
interface ListFieldOrNull<Spec extends ResponseFieldSpec> extends ListField<Spec> {
    readonly nullable: true;
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
    VNID: makeFieldWithOrNull(FieldType.VNID, Joi.string().regex(vnidRegex)),
    Int: makeFieldWithOrNull(FieldType.Int, Joi.number().integer()),
    BigInt: makeFieldWithOrNull(FieldType.BigInt, Joi.any().custom(validateBigInt)),
    Float: makeFieldWithOrNull(FieldType.Float, Joi.number()),
    String: makeFieldWithOrNull(FieldType.String, Joi.string()),
    Boolean: makeFieldWithOrNull(FieldType.Boolean, Joi.boolean()),
    /** A calendar date, i.e. a date without time information */
    Date: makeFieldWithOrNull(FieldType.Date, Joi.any().custom(validateDate)),
    DateTime: makeFieldWithOrNull(FieldType.DateTime, Joi.date().iso()),

    // Special field types that can be returned from Cypher queries, but not used as property types:
    Map: <M extends MapFieldSpec>(m: M): MapFieldRequired<M> => ({
        type: ResponseFieldType.Map, spec: m, nullable: false,
        OrNull: {type: ResponseFieldType.Map, spec: m, nullable: true},
    }),
    List: <L extends ResponseFieldSpec>(valueType: L): ListFieldRequired<L> => ({
        type: ResponseFieldType.List, spec: valueType, nullable: false,
        OrNull: {type: ResponseFieldType.List, spec: valueType, nullable: true},
    }),
    // Pass through of the types used by the underlying Neo4j JavaScript driver:
    Node: {type: ResponseFieldType.Node, nullable: false, OrNull: {type: ResponseFieldType.Node, nullable: true}},
    Relationship: {type: ResponseFieldType.Relationship, nullable: false, OrNull: {type: ResponseFieldType.Relationship, nullable: true}},
    Path: {type: ResponseFieldType.Path, nullable: false, OrNull: {type: ResponseFieldType.Path, nullable: true}},
});


/**
 * TypeScript helper type to get the underlying TypeScript/Javascript data type for a given field declaration.
 */
type GetDataType<FieldSpec extends ResponseFieldSpec> = (
    FieldSpec extends FieldData<any, any, any> ?
        (FieldSpec extends FieldData<any, true, any> ? null : never) | (
            FieldSpec extends FieldData<FieldType.Any, any, any> ? any :
            FieldSpec extends FieldData<FieldType.VNID, any, any> ? VNID :
            FieldSpec extends FieldData<FieldType.Int, any, any> ? number :
            FieldSpec extends FieldData<FieldType.BigInt, any, any> ? bigint :
            FieldSpec extends FieldData<FieldType.Float, any, any> ? number :
            FieldSpec extends FieldData<FieldType.String, any, any> ? string :
            FieldSpec extends FieldData<FieldType.Boolean, any, any> ? boolean :
            FieldSpec extends FieldData<FieldType.Date, any, any> ? VDate :
            FieldSpec extends FieldData<FieldType.DateTime, any, any> ? Date :
            {error: "unknown FieldType"}
        )
    : never
);

/**
 * Validate that a value matches the given field definition.
 * For a few types this will also cast/coerce it to the correct type (e.g. number -> bigint), but generally the wrong
 * type will raise an exception.
 * @param fieldType The Field definition, e.g. Field.Float.OrNull
 * @param value The value to validate
 * @returns The validated value
 */
export const validateValue = <FD extends FieldData<any, any, any>>(fieldType: FD, value: any): GetDataType<FD> => {
    const result = fieldType[schema].validate(value, {convert: false});
    if (result.error) {
        throw result.error;
    }
    return result.value;
};
