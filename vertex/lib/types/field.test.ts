import { group, test, assert } from "../tests.ts";
import { AssertEqual, checkType } from "../ts-utils.ts";
import { VNID } from "./vnid.ts";
import { VDate } from "./vdate.ts";
import { Person } from "../../test-project/index.ts";
import { RawVNode } from "../../layer2/vnode-base.ts";
import { Neo4j } from "../../deps.ts";
import {
    Field,
    FieldType,
    GetDataShape,
    PropSchema,
    GenericSchema,
    ResponseSchema,
    validatePropSchema,
    validateValue,
    Node,
    Relationship,
    Path,
    PrimitiveValue,
    GenericValue,
} from "./field.ts";

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Validators, to test validation:

// For testing Check() functionality, we use computed_types, which is designed to be compatible.
import * as check from "https://denoporter.sirjosh.workers.dev/v1/deno.land/x/computed_types@v1.9.0/src/index.ts";
// Also this custom check
const disallowValue = <T>(disallowedValue: T) => {
    return (value: T) => {
        if (value === disallowedValue) { throw new Error("That value is disallowed."); }
        return value;
    }
};
const validateAllowedValues = (...values: any[]) => {
    return (value: any) => {
        if (values.includes(value)) {
            return value;
        }
        throw new Error(`Value "${value}" is not one of the allowed values.`);
    }
}



group(import.meta, () => {

    group("Property Field type declarations", () => {

        group("VNID", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.VNID;
                assert.equal(fieldDeclaration.type, FieldType.VNID);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, "_0");
                checkType<AssertEqual<typeof value1, VNID>>();
                assert.assertThrows(() => { validateValue(fieldDeclaration, 123); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, "_not a vnid"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, null); });
            });
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.VNID;
                assert.equal(fieldDeclaration.type, FieldType.VNID);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, "_0");
                checkType<AssertEqual<typeof value1, VNID|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.assertThrows(() => { validateValue(fieldDeclaration, 123); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, "_not a vnid"); });
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case disallowing a specific value
                const fieldDeclaration = Field.VNID.Check(disallowValue(VNID("_0")));
                const value1 = validateValue(fieldDeclaration, "_3DF8hceEobPFSS26FKl733");
                checkType<AssertEqual<typeof value1, VNID>>();
                assert.assertThrows(() => { validateValue(fieldDeclaration, "_0"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, "_not a vnid"); });
            });
    
            test("NullOr. ... .Check(...)", () => {
                // Add a custom check, in this case disallowing a specific value
                const fieldDeclaration = Field.NullOr.VNID.Check(disallowValue(VNID("_0")));
                const value1 = validateValue(fieldDeclaration, "_3DF8hceEobPFSS26FKl733");
                checkType<AssertEqual<typeof value1, VNID|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                checkType<AssertEqual<typeof value2, VNID|null>>();
                assert.assertThrows(() => { validateValue(fieldDeclaration, "_0"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, "_not a vnid"); });
            });
        });

        group("Int", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.Int;
                assert.equal(fieldDeclaration.type, FieldType.Int);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, 1234);
                checkType<AssertEqual<typeof value1, number>>();
                assert.equal(typeof value1, "number");
                validateValue(fieldDeclaration, -35);
                assert.assertThrows(() => { validateValue(fieldDeclaration, "50"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, null); });
            });
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.Int;
                assert.equal(fieldDeclaration.type, FieldType.Int);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, 1234);
                checkType<AssertEqual<typeof value1, number|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.assertStrictEquals(value2, null);
                assert.assertThrows(() => { validateValue(fieldDeclaration, "50"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, {}); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, undefined); });
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case a range
                const fieldDeclaration = Field.Int.Check(check.number.min(10).max(100));
                validateValue(fieldDeclaration, 50);
                assert.assertThrows(() => { validateValue(fieldDeclaration, 0); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, 300); });
            });
    
            test("NullOr. ... .Check(...)", () => {
                // Add a custom check, in this case a range
                const fieldDeclaration = Field.NullOr.Int.Check(check.number.min(10).max(100));
                const value1 = validateValue(fieldDeclaration, 50);
                checkType<AssertEqual<typeof value1, number|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                checkType<AssertEqual<typeof value2, number|null>>();
                assert.assertThrows(() => { validateValue(fieldDeclaration, 0); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, 300); });
            });
        });

        group("BigInt", () => {

            // For testing bigints, here is a number that cannot be represented using the normal JavaScript Number type:
            const aHugeNumber = 9_444_333_222_111_000n;
            assert.assert(aHugeNumber > BigInt(Number.MAX_SAFE_INTEGER));

            test("Basic field", () => {
                const fieldDeclaration = Field.BigInt;
                assert.equal(fieldDeclaration.type, FieldType.BigInt);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, aHugeNumber);
                checkType<AssertEqual<typeof value1, bigint>>();
                assert.equal(typeof value1, "bigint");
                assert.assertStrictEquals(value1, aHugeNumber);  // Ensure that validation has preserved the value.

                // Note that numbers and strings will not be auto-converted:
                assert.assertThrows(() => { validateValue(fieldDeclaration, 50); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, "50"); });
                // And confirm that null is invalid:
                assert.assertThrows(() => { validateValue(fieldDeclaration, null); });
            });
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.BigInt;
                assert.equal(fieldDeclaration.type, FieldType.BigInt);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, null);
                assert.assertStrictEquals(value1, null);
                assert.assertThrows(() => { validateValue(fieldDeclaration, 50); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, "50"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, {}); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, undefined); });
            });

            test("64-bit range", () => {
                // This number is too big to be represented as a 64-bit integer in Neo4j:
                assert.assertThrows(() => { validateValue(Field.BigInt, 666_555_444_333_222_111_000n); })
                // And this one is too small:
                assert.assertThrows(() => { validateValue(Field.BigInt, -666_555_444_333_222_111_000n); })
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case a disallowed value (note: min() and max() don't work with BigInt)
                const fieldDeclaration = Field.BigInt.Check(disallowValue(0n));
                validateValue(fieldDeclaration, 50n);
                assert.assertThrows(() => { validateValue(fieldDeclaration, 0n); });
            });
        });

        group("Float", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.Float;
                assert.equal(fieldDeclaration.type, FieldType.Float);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, Math.PI);
                checkType<AssertEqual<typeof value1, number>>();
                assert.assert(typeof value1, "number");
                assert.assertStrictEquals(value1, Math.PI);  // Ensure that validation has preserved the value.

                assert.assertThrows(() => { validateValue(fieldDeclaration, "50"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, null); });
            });
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.Float;
                assert.equal(fieldDeclaration.type, FieldType.Float);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, 1234.5678);
                checkType<AssertEqual<typeof value1, number|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.assertStrictEquals(value2, null);
                assert.assertThrows(() => { validateValue(fieldDeclaration, "50"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, {}); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, undefined); });
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case a limited range of values:
                const fieldDeclaration = Field.Float.Check(check.number.min(3.1).max(3.8));
                validateValue(fieldDeclaration, Math.PI);
                assert.assertThrows(() => { validateValue(fieldDeclaration, 2.5); });
            });
        });

        group("String", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.String;
                assert.equal(fieldDeclaration.type, FieldType.String);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, "Hello 世界");
                checkType<AssertEqual<typeof value1, string>>();
                assert.equal(typeof value1, "string");
                assert.assertStrictEquals(value1, "Hello 世界");  // Ensure that validation has preserved the value.

                assert.assertThrows(() => { validateValue(fieldDeclaration, 50); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, null); });
            });
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.String;
                assert.equal(fieldDeclaration.type, FieldType.String);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, "Hello 世界");
                checkType<AssertEqual<typeof value1, string|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.assertStrictEquals(value2, null);
                assert.assertThrows(() => { validateValue(fieldDeclaration, 50); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, {}); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, undefined); });
            });

            test("Length limit defaults to 1,000 but can be changed", () => {
                // Test the default limit of 1,000:
                validateValue(Field.String, "a".repeat(1_000));
                assert.assertThrows(() => { validateValue(Field.String, "a".repeat(1_001)); });
                // Test raising the limit to 10,000:
                const customLengthField = Field.String.Check(check.string.max(10_000));
                validateValue(customLengthField, "a".repeat(2_000));
                assert.assertThrows(() => { validateValue(customLengthField, "a".repeat(20_000)); });
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case an email address validator:
                const fieldDeclaration = Field.String.Check(Field.validators.email);
                validateValue(fieldDeclaration, "example@example.com");
                assert.assertThrows(() => { validateValue(fieldDeclaration, "not an email"); });
            });
        });

        group("Slug", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.Slug;
                assert.equal(fieldDeclaration.type, FieldType.Slug);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, "a-slug");
                checkType<AssertEqual<typeof value1, string>>();
                assert.equal(typeof value1, "string");
                assert.assertStrictEquals(value1, "a-slug");  // Ensure that validation has preserved the value.
                // These should all be valid:
                const check = (str: string) => assert.equal(validateValue(fieldDeclaration, str), str);
                check("CAPITALS");
                check("many-long-words");
                check("Solární-panel");
                check("ソーラーパネル");
                check("солнечная-панель")
                check("لوحة-شمسية");

                assert.assertThrows(() => { validateValue(fieldDeclaration, "spaces between words"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, "under_score"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, null); });
            });
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.Slug;
                assert.equal(fieldDeclaration.type, FieldType.Slug);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, "a-slug");
                checkType<AssertEqual<typeof value1, string|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.assertStrictEquals(value2, null);
                assert.assertThrows(() => { validateValue(fieldDeclaration, "under_score"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, {}); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, undefined); });
            });

            test("Length limit defaults to 60 but can be increased", () => {
                validateValue(Field.Slug, "a".repeat(60));
                assert.assertThrows(() => { validateValue(Field.Slug, "a".repeat(61)); });
                const customLengthField = Field.Slug.Check(check.string.max(100));
                validateValue(customLengthField, "a".repeat(100));
                assert.assertThrows(() => { validateValue(customLengthField, "a".repeat(200)); });
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case that the slug must be lowercase:
                const fieldDeclaration = Field.Slug.Check(check.string.toLowerCase());
                validateValue(fieldDeclaration, "lowercase-slug");
                assert.equal(validateValue(fieldDeclaration, "Capital-Slug"), "capital-slug");
            });
        });

        group("Boolean", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.Boolean;
                assert.equal(fieldDeclaration.type, FieldType.Boolean);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, true);
                checkType<AssertEqual<typeof value1, boolean>>();
                assert.equal(typeof value1, "boolean");
                assert.assertStrictEquals(value1, true);  // Ensure that validation has preserved the value.

                assert.assertThrows(() => { validateValue(fieldDeclaration, "true"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, null); });
            });
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.Boolean;
                assert.equal(fieldDeclaration.type, FieldType.Boolean);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, true);
                checkType<AssertEqual<typeof value1, boolean|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.assertStrictEquals(value2, null);
                assert.assertThrows(() => { validateValue(fieldDeclaration, "50"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, {}); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, undefined); });
            });

            // Not many checks worth doing for a single boolean value, so we don't test .Check()
        });

        group("Date", () => {
            const stringDate = "2021-06-01";

            test("Basic field", () => {
                const fieldDeclaration = Field.Date;
                assert.equal(fieldDeclaration.type, FieldType.Date);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, VDate.fromString(stringDate));
                checkType<AssertEqual<typeof value1, VDate>>();
                assert.equal(typeof value1, "object");
                assert.assert(value1 instanceof VDate);
                assert.assertStrictEquals(value1.toString(), stringDate);
                // Also, Neo4j dates are allowed:
                assert.equal(validateValue(fieldDeclaration, new Neo4j.Date<number>(2021, 6, 1)).toString(), "2021-06-01");

                // We do not auto-convert string values to VDate, because that could hide an issue where some date
                // property values in the database are stored as strings while others are stored as dates.
                assert.assertThrows(() => { validateValue(fieldDeclaration, stringDate); });
                // JavaScript Date objects are not allowed, due to timezone issues
                // e.g. on my system, new Date("2021-03-01").toString() gives "Feb 28 2021..."
                assert.assertThrows(() => { validateValue(fieldDeclaration, new Date()); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, "50"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, null); });
            });
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.Date;
                assert.equal(fieldDeclaration.type, FieldType.Date);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, VDate.fromString(stringDate));
                checkType<AssertEqual<typeof value1, VDate|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.assertStrictEquals(value2, null);
                assert.assertThrows(() => { validateValue(fieldDeclaration, stringDate); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, {}); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, undefined); });
            });
    
            // Date values don't really support useful custom .Check() operations at the moment.
        });

        group("DateTime", () => {
            const stringDate = "2021-05-10T00:10:41.079Z";
            const dateValue = new Date(stringDate);
            assert.equal(dateValue.toISOString(), stringDate);  // Validate round-trip parsing

            test("Basic field", () => {
                const fieldDeclaration = Field.DateTime;
                assert.equal(fieldDeclaration.type, FieldType.DateTime);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, dateValue);
                checkType<AssertEqual<typeof value1, Date>>();
                assert.assert(value1 instanceof Date);
                assert.assertStrictEquals(value1.toISOString(), stringDate);
                // Note, Joi does not allow strings as datetimes - parse them first:
                assert.assertThrows(() => { validateValue(fieldDeclaration, stringDate); });

                // And non-dates are of course not allowed:
                assert.assertThrows(() => { validateValue(fieldDeclaration, "50"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, null); });
            });
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.DateTime;
                assert.equal(fieldDeclaration.type, FieldType.DateTime);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, dateValue);
                checkType<AssertEqual<typeof value1, Date|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.assertStrictEquals(value2, null);
                assert.assertThrows(() => { validateValue(fieldDeclaration, "50"); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, {}); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, undefined); });
            });

            test(".Check(...)", () => {
                // Add a custom check, in this case that the date falls in the year 2021:
                const fieldDeclaration = Field.DateTime.Check(check.DateType.min(new Date("2021-01-01")).max(new Date("2022-01-01")));
                validateValue(fieldDeclaration, new Date("2021-05-06"));
                assert.assertThrows(() => { validateValue(fieldDeclaration, new Date("2024-05-06")); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, new Date("2020-02-03")); });
            });
        });

        group("AnyPrimitive", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.AnyPrimitive;
                assert.equal(fieldDeclaration.type, FieldType.AnyPrimitive);
    
                const value1 = validateValue(fieldDeclaration, 12345);
                checkType<AssertEqual<typeof value1, PrimitiveValue>>();
                assert.assertStrictEquals(value1, 12345);
                // That was a number, check that other primitive types are supported:
                assert.assertStrictEquals(validateValue(fieldDeclaration, null), null);
                assert.assertStrictEquals(validateValue(fieldDeclaration, 999_888_777_666_555_444_333n), 999_888_777_666_555_444_333n);
                assert.assertStrictEquals(validateValue(fieldDeclaration, "string"), "string");
                assert.assertStrictEquals(validateValue(fieldDeclaration, true), true);
                assert.assertStrictEquals(validateValue(fieldDeclaration, VDate.fromString("2021-05-14"))?.toString(), "2021-05-14");
                const someDate = new Date();
                const dateValueOut = validateValue(fieldDeclaration, someDate);
                assert.assert(dateValueOut instanceof Date);
                assert.equal((dateValueOut as Date).toISOString(), someDate.toISOString());
                
                // And non-primitive values are of course not allowed:
                assert.assertThrows(() => { validateValue(fieldDeclaration, {foo: "bar"}); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, undefined); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, [1,2,3]); });
                assert.assertThrows(() => { validateValue(fieldDeclaration, Math); });
            });

            test(".Check(...)", () => {
                // Add a custom check, in this case restricting it to a set of integers and null:
                const fieldDeclaration = Field.AnyPrimitive.Check(validateAllowedValues(1,2,3,4,5,null));
                validateValue(fieldDeclaration, 3);
                validateValue(fieldDeclaration, null);
                assert.assertThrows(() => { validateValue(fieldDeclaration, "5"); });  // string, not allowed
                assert.assertThrows(() => { validateValue(fieldDeclaration, 10); });
            });
        });

        group("validatePropSchema", () => {
            const buildingSchema: PropSchema = {
                name: Field.String,
                numHomes: Field.Int.Check(check.number.min(1)),  // How many homes/apartments are in this building
                numOccupiedHomes: Field.Int.Check(check.number.min(0).max(100/* reference to numHomes not supported */)),
            };

            test("Accepts a valid value", () => {
                validatePropSchema(buildingSchema, {
                    name: "Hogwarts Dorm A",
                    numHomes: 100,
                    numOccupiedHomes: 50,
                });
            });

            test("Rejects an invalid value", () => {
                assert.assertThrows(() => {
                    validatePropSchema(buildingSchema, {
                        name: "Imaginary Building",
                        numHomes: 0,
                        numOccupiedHomes: -50,
                    });
                }, undefined, `Expect value to be greater or equal than 1 (actual: 0)`);
            });
        });
    });

    group("Property vs Generic vs Response Schemas", () => {

        test("Property Schemas can hold only property typed values", () => {
            const valid = PropSchema({
                fieldId: Field.VNID,
                fieldNullId: Field.NullOr.VNID,
                fieldInt: Field.Int,
                fieldNullInt: Field.NullOr.Int,
                fieldBig: Field.BigInt,
                fieldFloat: Field.Float,
                fieldStr: Field.String,
                fieldSlug: Field.Slug,
                fieldBool: Field.Boolean,
                fieldDate: Field.Date,
                fieldDT: Field.DateTime,
                fieldAP: Field.AnyPrimitive,
                // @ts-expect-error a Record is not allowed in a property schema
                fieldRecord: Field.Record({key: Field.String}),
                // @ts-expect-error a Map is not allowed in a property schema
                fieldMap: Field.Map(Field.String),
                // @ts-expect-error a List is not allowed in a property schema
                fieldList: Field.List(Field.String),
                // @ts-expect-error an AnyGeneric is not allowed in a property schema
                fieldAnyGeneric: Field.AnyGeneric,
                // @ts-expect-error a Node is not allowed in a property schema
                fieldNode: Field.Node,
                // @ts-expect-error a VNode is not allowed in a property schema
                fieldVNode: Field.VNode(Person),
                // @ts-expect-error an "Any" result is not allowed in a property schema
                fieldAny: Field.Any,
            });
        });

        test("Generic Schemas can hold property typed values and composite types, but not response types", () => {
            const valid = GenericSchema({
                fieldId: Field.VNID,
                fieldNullId: Field.NullOr.VNID,
                fieldInt: Field.Int,
                fieldNullInt: Field.NullOr.Int,
                fieldBig: Field.BigInt,
                fieldFloat: Field.Float,
                fieldStr: Field.String,
                fieldSlug: Field.Slug,
                fieldBool: Field.Boolean,
                fieldDate: Field.Date,
                fieldDT: Field.DateTime,
                fieldAP: Field.AnyPrimitive,
                fieldRecord: Field.Record({key: Field.String, key2: Field.List(Field.Boolean)}),
                fieldMap: Field.Map(Field.String),
                fieldList: Field.List(Field.NullOr.String),
                fieldAnyGeneric: Field.AnyGeneric,
                // @ts-expect-error a Node is not allowed in a generic schema
                fieldNode: Field.Node,
                // @ts-expect-error a VNode is not allowed in a property schema
                fieldVNode: Field.VNode(Person),
                // @ts-expect-error They are also not allowed within composite types:
                fieldListNode: Field.List(Field.Node),
                // @ts-expect-error an "Any" result is not allowed in a generic schema
                fieldAny: Field.Any,
            });
        });

        test("Response Schemas can hold property typed values and composite types and response types", () => {
            const valid = ResponseSchema({
                fieldId: Field.VNID,
                fieldNullId: Field.NullOr.VNID,
                fieldInt: Field.Int,
                fieldNullInt: Field.NullOr.Int,
                fieldBig: Field.BigInt,
                fieldFloat: Field.Float,
                fieldStr: Field.String,
                fieldSlug: Field.Slug,
                fieldBool: Field.Boolean,
                fieldDate: Field.Date,
                fieldDT: Field.DateTime,
                fieldAP: Field.AnyPrimitive,
                fieldRecord: Field.Record({key: Field.String, key2: Field.List(Field.Boolean)}),
                fieldMap: Field.Map(Field.String),
                fieldList: Field.List(Field.NullOr.String),
                fieldAnyGeneric: Field.AnyGeneric,
                fieldNode: Field.Node,
                fieldVNode: Field.VNode(Person),
                fieldListNode: Field.List(Field.Node),
                fieldAny: Field.Any,
            });
        });
    });

    group("ResponseSchema and GetDataShape", () => {

        // Basic property field types:
        test("VNID", () => {
            const shape = ResponseSchema({myVNID: Field.VNID, nullVNID: Field.NullOr.VNID});
            checkType<AssertEqual<GetDataShape<typeof shape>, {myVNID: VNID, nullVNID: VNID|null}>>();
        });
        test("Int", () => {
            const shape = ResponseSchema({myInt: Field.Int, nullInt: Field.NullOr.Int});
            checkType<AssertEqual<GetDataShape<typeof shape>, {myInt: number, nullInt: number|null}>>();
        });
        test("BigInt", () => {
            const shape = ResponseSchema({myBigInt: Field.BigInt, nullBigInt: Field.NullOr.BigInt});
            checkType<AssertEqual<GetDataShape<typeof shape>, {myBigInt: bigint, nullBigInt: bigint|null}>>();
        });
        test("Float", () => {
            const shape = ResponseSchema({myFloat: Field.Float, nullFloat: Field.NullOr.Float});
            checkType<AssertEqual<GetDataShape<typeof shape>, {myFloat: number, nullFloat: number|null}>>();
        });
        test("String", () => {
            const shape = ResponseSchema({myString: Field.String, nullString: Field.NullOr.String});
            checkType<AssertEqual<GetDataShape<typeof shape>, {myString: string, nullString: string|null}>>();
        });
        test("Slug", () => {
            const shape = ResponseSchema({mySlug: Field.Slug, nullSlug: Field.NullOr.Slug});
            checkType<AssertEqual<GetDataShape<typeof shape>, {mySlug: string, nullSlug: string|null}>>();
        });
        test("Boolean", () => {
            const shape = ResponseSchema({myBool: Field.Boolean, nullBool: Field.NullOr.Boolean});
            checkType<AssertEqual<GetDataShape<typeof shape>, {myBool: boolean, nullBool: boolean|null}>>();
        });
        test("Date", () => {
            const shape = ResponseSchema({myDate: Field.Date, nulDate: Field.NullOr.Date});
            checkType<AssertEqual<GetDataShape<typeof shape>, {myDate: VDate, nulDate: VDate|null}>>();
        });
        test("DateTime", () => {
            const shape = ResponseSchema({myDateTime: Field.DateTime, nullDateTime: Field.NullOr.DateTime});
            checkType<AssertEqual<GetDataShape<typeof shape>, {myDateTime: Date, nullDateTime: Date|null}>>();
        });
        test("AnyPrimitive", () => {
            const shape = ResponseSchema({primValue: Field.AnyPrimitive});
            checkType<AssertEqual<GetDataShape<typeof shape>, {primValue: PrimitiveValue}>>();
        });
        // Composite types:

        test("Record", () => {
            const shape = ResponseSchema({
                recordField: Field.Record({
                    subMap: Field.Record({ subKey1: Field.NullOr.String, subKey2: Field.BigInt }),
                    otherKey: Field.String,
                }),
                nullMap: Field.NullOr.Record({
                    key1: Field.VNID,
                }),
            });
            checkType<AssertEqual<GetDataShape<typeof shape>, {
                recordField: {
                    subMap: { subKey1: string|null, subKey2: bigint },
                    otherKey: string,
                },
                nullMap: null|{
                    key1: VNID,
                },
            }>>();
        });
        test("Map", () => {
            const shape = ResponseSchema({
                mapField: Field.Map(Field.Map(Field.List(Field.NullOr.BigInt))),
                nullMap: Field.NullOr.Map(Field.VNID),
            });
            checkType<AssertEqual<GetDataShape<typeof shape>, {
                mapField: {
                    [K: string]: { [K: string]: Array<null|bigint> },
                },
                nullMap: null|{
                    [K: string]: VNID,
                },
            }>>();
        });
        test("List", () => {
            const shape = ResponseSchema({
                idList: Field.List(Field.VNID),
                nullStringList: Field.NullOr.List(Field.String),
            });
            checkType<AssertEqual<GetDataShape<typeof shape>, {
                idList: VNID[],
                nullStringList: string[]|null,
            }>>();
        });
        test("AnyGeneric", () => {
            const shape = ResponseSchema({
                generic: Field.AnyGeneric,
                genericMap: Field.Map(Field.AnyGeneric),
            });
            checkType<AssertEqual<GetDataShape<typeof shape>, {
                generic: GenericValue,
                genericMap: {[key: string]: GenericValue},
            }>>();
        });

        // Types unique to response fields:

        test("Raw Neo4j Node", () => {
            const shape = ResponseSchema({nodeField: Field.Node, nullNode: Field.NullOr.Node});
            checkType<AssertEqual<GetDataShape<typeof shape>, {nodeField: Node, nullNode: Node|null}>>();
        });
        test("Raw Neo4j Path", () => {
            const shape = ResponseSchema({pathField: Field.Path, nullPath: Field.NullOr.Path});
            checkType<AssertEqual<GetDataShape<typeof shape>, {pathField: Path, nullPath: Path|null}>>();
        });
        test("Raw Neo4j Relationship", () => {
            const shape = ResponseSchema({relField: Field.Relationship, nullRel: Field.NullOr.Relationship});
            checkType<AssertEqual<GetDataShape<typeof shape>, {relField: Relationship, nullRel: Relationship|null}>>();
        });
        test("RawVNode", () => {
            const shape = ResponseSchema({
                person: Field.VNode(Person),
                nullPerson: Field.NullOr.VNode(Person),
            });
            // First we check very specific types, to make it easier to diagnose typing bugs:
            checkType<AssertEqual<GetDataShape<typeof shape>["person"]["id"], VNID>>();
            checkType<AssertEqual<GetDataShape<typeof shape>["person"]["slugId"], string>>();
            checkType<AssertEqual<GetDataShape<typeof shape>["person"]["name"], string>>();
            checkType<AssertEqual<GetDataShape<typeof shape>["person"]["dateOfBirth"], VDate>>();
            checkType<AssertEqual<GetDataShape<typeof shape>["person"]["_labels"], string[]>>();
            checkType<AssertEqual<GetDataShape<typeof shape>["nullPerson"], null | RawVNode<typeof Person>>>();
            // Then check the typing of the whole thing:
            checkType<AssertEqual<GetDataShape<typeof shape>, {
                person: {
                    id: VNID,
                    slugId: string,
                    name: string,
                    dateOfBirth: VDate,
                } & {
                    _labels: string[]
                },
                nullPerson: null|({
                    id: VNID,
                    slugId: string,
                    name: string,
                    dateOfBirth: VDate,
                } & {
                    _labels: string[]
                }),
            }>>();
        });
        test("Any", () => {
            const shape = ResponseSchema({someUnknownValue: Field.Any});
            checkType<AssertEqual<GetDataShape<typeof shape>, {someUnknownValue: any}>>();
        });
    });
});
