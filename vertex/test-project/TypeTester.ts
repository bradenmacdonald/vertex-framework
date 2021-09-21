import {
    defaultCreateFor,
    defaultUpdateFor,
    Field,
    VNodeType,
} from "../index.ts";

/**
 * A VNode type that contains nullable and non-nullable fields of all types supported by Vertex Framework
 */
export class TypeTester extends VNodeType {
    static readonly label = "TypeTester";
    static readonly properties = {
        ...VNodeType.properties,
        nullableId: Field.NullOr.VNID,
        int: Field.Int,
        nullableInt: Field.NullOr.Int,
        bigInt: Field.BigInt,
        nullableBigInt: Field.NullOr.BigInt,
        float: Field.Float,
        nullableFloat: Field.NullOr.Float,
        string: Field.String,
        nullableString: Field.NullOr.String,
        slug: Field.Slug,
        nullableSlug: Field.NullOr.Slug,
        boolean: Field.Boolean,
        nullableBoolean: Field.NullOr.Boolean,
        date: Field.Date,
        nullableDate: Field.NullOr.Date,
        dateTime: Field.DateTime,
        nullableDateTime: Field.NullOr.DateTime,
    };
}

export const UpdateTypeTester = defaultUpdateFor(TypeTester, t => t.allProps);

export const CreateTypeTester = defaultCreateFor(TypeTester, t => t.int.bigInt.float.string.slug.boolean.date.dateTime, UpdateTypeTester);
