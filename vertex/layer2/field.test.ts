import { suite, test, assert } from "../lib/intern-tests";
import { AssertEqual, checkType } from "../lib/ts-utils";
import { VNID } from "../lib/vnid";
import { VDate, Neo4jDate } from "../lib/vdate";
import { Field, FieldType, validateValue } from "./field";

suite(__filename, () => {

    suite("Property Field type declarations", () => {

        suite("Any", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.Any;
                assert.equal(fieldDeclaration.type, FieldType.Any);
                assert.equal(fieldDeclaration.nullable, false);
    
                // An Any field can hold any type of value whatsoever, including null:
                const value1 = validateValue(fieldDeclaration, "string");
                checkType<AssertEqual<typeof value1, any>>();
                const value2 = validateValue(fieldDeclaration, {thisIs: "a complex object", num: 15});
                checkType<AssertEqual<typeof value2, any>>();
                const value3 = validateValue(fieldDeclaration, null);
                checkType<AssertEqual<typeof value3, any>>();
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case disallowing a specific value
                const fieldDeclaration = Field.Any.Check(v => v.disallow("specific string"));
                const value1 = validateValue(fieldDeclaration, "string");
                checkType<AssertEqual<typeof value1, any>>();
                const value2 = validateValue(fieldDeclaration, {thisIs: "a complex object", num: 15});
                checkType<AssertEqual<typeof value2, any>>();
                // But this will fail since the Check rejects it:
                assert.throws(() => { validateValue(fieldDeclaration, "specific string"); });
            });
        });

        suite("VNID", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.VNID;
                assert.equal(fieldDeclaration.type, FieldType.VNID);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, "_0");
                checkType<AssertEqual<typeof value1, VNID>>();
                assert.throws(() => { validateValue(fieldDeclaration, 123); });
                assert.throws(() => { validateValue(fieldDeclaration, "_not a vnid"); });
                assert.throws(() => { validateValue(fieldDeclaration, null); });
            });
    
            test(".OrNull", () => {
                const fieldDeclaration = Field.VNID.OrNull;
                assert.equal(fieldDeclaration.type, FieldType.VNID);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, "_0");
                checkType<AssertEqual<typeof value1, VNID|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.throws(() => { validateValue(fieldDeclaration, 123); });
                assert.throws(() => { validateValue(fieldDeclaration, "_not a vnid"); });
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case disallowing a specific value
                const fieldDeclaration = Field.VNID.Check(v => v.disallow("_0"));
                const value1 = validateValue(fieldDeclaration, "_3DF8hceEobPFSS26FKl733");
                checkType<AssertEqual<typeof value1, VNID>>();
                assert.throws(() => { validateValue(fieldDeclaration, "_0"); });
                assert.throws(() => { validateValue(fieldDeclaration, "_not a vnid"); });
            });
    
            test(".OrNull.Check(...)", () => {
                // Add a custom check, in this case disallowing a specific value
                const fieldDeclaration = Field.VNID.OrNull.Check(v => v.disallow("_0"));
                const value1 = validateValue(fieldDeclaration, "_3DF8hceEobPFSS26FKl733");
                checkType<AssertEqual<typeof value1, VNID|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                checkType<AssertEqual<typeof value2, VNID|null>>();
                assert.throws(() => { validateValue(fieldDeclaration, "_0"); });
                assert.throws(() => { validateValue(fieldDeclaration, "_not a vnid"); });
            });
        });

        suite("Int", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.Int;
                assert.equal(fieldDeclaration.type, FieldType.Int);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, 1234);
                checkType<AssertEqual<typeof value1, number>>();
                assert.typeOf(value1, "number")
                validateValue(fieldDeclaration, -35);
                assert.throws(() => { validateValue(fieldDeclaration, "50"); });
                assert.throws(() => { validateValue(fieldDeclaration, null); });
            });
    
            test(".OrNull", () => {
                const fieldDeclaration = Field.Int.OrNull;
                assert.equal(fieldDeclaration.type, FieldType.Int);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, 1234);
                checkType<AssertEqual<typeof value1, number|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.strictEqual(value2, null);
                assert.throws(() => { validateValue(fieldDeclaration, "50"); });
                assert.throws(() => { validateValue(fieldDeclaration, {}); });
                assert.throws(() => { validateValue(fieldDeclaration, undefined); });
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case a range
                const fieldDeclaration = Field.Int.Check(v => v.min(10).max(100));
                validateValue(fieldDeclaration, 50);
                assert.throws(() => { validateValue(fieldDeclaration, 0); });
                assert.throws(() => { validateValue(fieldDeclaration, 300); });
            });
    
            test(".OrNull.Check(...)", () => {
                // Add a custom check, in this case a range
                const fieldDeclaration = Field.Int.OrNull.Check(v => v.min(10).max(100));
                const value1 = validateValue(fieldDeclaration, 50);
                checkType<AssertEqual<typeof value1, number|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                checkType<AssertEqual<typeof value2, number|null>>();
                assert.throws(() => { validateValue(fieldDeclaration, 0); });
                assert.throws(() => { validateValue(fieldDeclaration, 300); });
            });
        });

        suite("BigInt", () => {

            // For testing bigints, here is a number that cannot be represented using the normal JavaScript Number type:
            const aHugeNumber = 9_876_543_210_000_000n;
            assert(aHugeNumber > BigInt(Number.MAX_SAFE_INTEGER));

            test("Basic field", () => {
                const fieldDeclaration = Field.BigInt;
                assert.equal(fieldDeclaration.type, FieldType.BigInt);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, aHugeNumber);
                checkType<AssertEqual<typeof value1, bigint>>();
                assert.typeOf(value1, "bigint");
                assert.strictEqual(value1, aHugeNumber);  // Ensure that validation has preserved the value.

                // Note that numbers and strings will not be auto-converted:
                assert.throws(() => { validateValue(fieldDeclaration, 50); });
                assert.throws(() => { validateValue(fieldDeclaration, "50"); });
                // And confirm that null is invalid:
                assert.throws(() => { validateValue(fieldDeclaration, null); });
            });
    
            test(".OrNull", () => {
                const fieldDeclaration = Field.BigInt.OrNull;
                assert.equal(fieldDeclaration.type, FieldType.BigInt);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, null);
                assert.strictEqual(value1, null);
                assert.throws(() => { validateValue(fieldDeclaration, 50); });
                assert.throws(() => { validateValue(fieldDeclaration, "50"); });
                assert.throws(() => { validateValue(fieldDeclaration, {}); });
                assert.throws(() => { validateValue(fieldDeclaration, undefined); });
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case a disallowed value (note: min() and max() don't work with BigInt)
                const fieldDeclaration = Field.BigInt.Check(v => v.disallow(0n));
                validateValue(fieldDeclaration, 50n);
                assert.throws(() => { validateValue(fieldDeclaration, 0n); });
            });
        });

        suite("Float", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.Float;
                assert.equal(fieldDeclaration.type, FieldType.Float);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, Math.PI);
                checkType<AssertEqual<typeof value1, number>>();
                assert.typeOf(value1, "number");
                assert.strictEqual(value1, Math.PI);  // Ensure that validation has preserved the value.

                assert.throws(() => { validateValue(fieldDeclaration, "50"); });
                assert.throws(() => { validateValue(fieldDeclaration, null); });
            });
    
            test(".OrNull", () => {
                const fieldDeclaration = Field.Float.OrNull;
                assert.equal(fieldDeclaration.type, FieldType.Float);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, 1234.5678);
                checkType<AssertEqual<typeof value1, number|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.strictEqual(value2, null);
                assert.throws(() => { validateValue(fieldDeclaration, "50"); });
                assert.throws(() => { validateValue(fieldDeclaration, {}); });
                assert.throws(() => { validateValue(fieldDeclaration, undefined); });
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case a limited range of values:
                const fieldDeclaration = Field.Float.Check(v => v.min(3.1).max(3.8));
                validateValue(fieldDeclaration, Math.PI);
                assert.throws(() => { validateValue(fieldDeclaration, 2.5); });
            });
        });

        suite("String", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.String;
                assert.equal(fieldDeclaration.type, FieldType.String);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, "Hello 世界");
                checkType<AssertEqual<typeof value1, string>>();
                assert.typeOf(value1, "string");
                assert.strictEqual(value1, "Hello 世界");  // Ensure that validation has preserved the value.

                assert.throws(() => { validateValue(fieldDeclaration, 50); });
                assert.throws(() => { validateValue(fieldDeclaration, null); });
            });
    
            test(".OrNull", () => {
                const fieldDeclaration = Field.String.OrNull;
                assert.equal(fieldDeclaration.type, FieldType.String);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, "Hello 世界");
                checkType<AssertEqual<typeof value1, string|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.strictEqual(value2, null);
                assert.throws(() => { validateValue(fieldDeclaration, 50); });
                assert.throws(() => { validateValue(fieldDeclaration, {}); });
                assert.throws(() => { validateValue(fieldDeclaration, undefined); });
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case an email address validator:
                const fieldDeclaration = Field.String.Check(v => v.email());
                validateValue(fieldDeclaration, "example@example.com");
                assert.throws(() => { validateValue(fieldDeclaration, "not an email"); });
            });
        });

        suite("Boolean", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.Boolean;
                assert.equal(fieldDeclaration.type, FieldType.Boolean);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, true);
                checkType<AssertEqual<typeof value1, boolean>>();
                assert.typeOf(value1, "boolean");
                assert.strictEqual(value1, true);  // Ensure that validation has preserved the value.

                assert.throws(() => { validateValue(fieldDeclaration, "true"); });
                assert.throws(() => { validateValue(fieldDeclaration, null); });
            });
    
            test(".OrNull", () => {
                const fieldDeclaration = Field.Boolean.OrNull;
                assert.equal(fieldDeclaration.type, FieldType.Boolean);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, true);
                checkType<AssertEqual<typeof value1, boolean|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.strictEqual(value2, null);
                assert.throws(() => { validateValue(fieldDeclaration, "50"); });
                assert.throws(() => { validateValue(fieldDeclaration, {}); });
                assert.throws(() => { validateValue(fieldDeclaration, undefined); });
            });

            // Not many checks worth doing for a single boolean value, so we don't test .Check()
        });

        suite("Date", () => {
            const stringDate = "2021-06-01";

            test("Basic field", () => {
                const fieldDeclaration = Field.Date;
                assert.equal(fieldDeclaration.type, FieldType.Date);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, VDate.fromString(stringDate));
                checkType<AssertEqual<typeof value1, VDate>>();
                assert.typeOf(value1, "object");
                assert.instanceOf(value1, VDate);
                assert.strictEqual(value1.toString(), stringDate);
                // Also, Neo4j dates are allowed:
                assert.equal(validateValue(fieldDeclaration, new Neo4jDate(2021, 6, 1)).toString(), "2021-06-01");

                // We do not auto-convert string values to VDate, because that could hide an issue where some date
                // property values in the database are stored as strings while others are stored as dates.
                assert.throws(() => { validateValue(fieldDeclaration, stringDate); });
                // JavaScript Date objects are not allowed, due to timezone issues
                // e.g. on my system, new Date("2021-03-01").toString() gives "Feb 28 2021..."
                assert.throws(() => { validateValue(fieldDeclaration, new Date()); });
                assert.throws(() => { validateValue(fieldDeclaration, "50"); });
                assert.throws(() => { validateValue(fieldDeclaration, null); });
            });
    
            test(".OrNull", () => {
                const fieldDeclaration = Field.Date.OrNull;
                assert.equal(fieldDeclaration.type, FieldType.Date);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, VDate.fromString(stringDate));
                checkType<AssertEqual<typeof value1, VDate|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.strictEqual(value2, null);
                assert.throws(() => { validateValue(fieldDeclaration, stringDate); });
                assert.throws(() => { validateValue(fieldDeclaration, {}); });
                assert.throws(() => { validateValue(fieldDeclaration, undefined); });
            });
    
            // Date values don't really support useful custom .Check() operations at the moment.
        });

        suite("DateTime", () => {
            const stringDate = "2021-05-10T00:10:41.079Z";
            const dateValue = new Date(stringDate);
            assert.strictEqual(dateValue.toISOString(), stringDate);  // Validate round-trip parsing

            test("Basic field", () => {
                const fieldDeclaration = Field.DateTime;
                assert.equal(fieldDeclaration.type, FieldType.DateTime);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, dateValue);
                checkType<AssertEqual<typeof value1, Date>>();
                assert.instanceOf(value1, Date);
                assert.strictEqual(value1.toISOString(), stringDate);
                // Note, Joi does not allow strings as datetimes - parse them first:
                assert.throws(() => { validateValue(fieldDeclaration, stringDate); });

                // And non-dates are of course not allowed:
                assert.throws(() => { validateValue(fieldDeclaration, "50"); });
                assert.throws(() => { validateValue(fieldDeclaration, null); });
            });
    
            test(".OrNull", () => {
                const fieldDeclaration = Field.DateTime.OrNull;
                assert.equal(fieldDeclaration.type, FieldType.DateTime);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, dateValue);
                checkType<AssertEqual<typeof value1, Date|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.strictEqual(value2, null);
                assert.throws(() => { validateValue(fieldDeclaration, "50"); });
                assert.throws(() => { validateValue(fieldDeclaration, {}); });
                assert.throws(() => { validateValue(fieldDeclaration, undefined); });
            });

            test(".Check(...)", () => {
                // Add a custom check, in this case that the date falls in the year 2021:
                const fieldDeclaration = Field.DateTime.Check(v => v.greater("2021-01-01").less("2022-01-01"));
                validateValue(fieldDeclaration, new Date("2021-05-06"));
                assert.throws(() => { validateValue(fieldDeclaration, new Date("2024-05-06")); });
                assert.throws(() => { validateValue(fieldDeclaration, new Date("2020-02-03")); });
            });
        });

    });
});
