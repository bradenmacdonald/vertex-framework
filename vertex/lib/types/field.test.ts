import { suite, test, assert } from "../intern-tests";
import { AssertEqual, checkType } from "../ts-utils";
import { VNID } from "./vnid";
import { VDate, Neo4jDate } from "./vdate";
import { Field, FieldType, GetDataShape, PropSchema, GenericSchema, ResponseSchema, validatePropSchema, validateValue, Node, Relationship, Path } from "./field";
import { Person } from "../../test-project";
import { RawVNode } from "../../layer2/vnode-base";

suite(__filename, () => {

    suite("Property Field type declarations", () => {

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
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.VNID;
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
    
            test("NullOr. ... .Check(...)", () => {
                // Add a custom check, in this case disallowing a specific value
                const fieldDeclaration = Field.NullOr.VNID.Check(v => v.disallow("_0"));
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
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.Int;
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
    
            test("NullOr. ... .Check(...)", () => {
                // Add a custom check, in this case a range
                const fieldDeclaration = Field.NullOr.Int.Check(v => v.min(10).max(100));
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
            const aHugeNumber = 9_444_333_222_111_000n;
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
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.BigInt;
                assert.equal(fieldDeclaration.type, FieldType.BigInt);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, null);
                assert.strictEqual(value1, null);
                assert.throws(() => { validateValue(fieldDeclaration, 50); });
                assert.throws(() => { validateValue(fieldDeclaration, "50"); });
                assert.throws(() => { validateValue(fieldDeclaration, {}); });
                assert.throws(() => { validateValue(fieldDeclaration, undefined); });
            });

            test("64-bit range", () => {
                // This number is too big to be represented as a 64-bit integer in Neo4j:
                assert.throws(() => { validateValue(Field.BigInt, 666_555_444_333_222_111_000n); })
                // And this one is too small:
                assert.throws(() => { validateValue(Field.BigInt, -666_555_444_333_222_111_000n); })
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
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.Float;
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
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.String;
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

            test("Length limit defaults to 1,000 but can be changed", () => {
                validateValue(Field.String, "a".repeat(1_000));
                assert.throws(() => { validateValue(Field.String, "a".repeat(1_001)); });
                const customLengthField = Field.String.Check(s => s.max(10_000));
                validateValue(customLengthField, "a".repeat(2_000));
                assert.throws(() => { validateValue(customLengthField, "a".repeat(20_000)); });
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case an email address validator:
                const fieldDeclaration = Field.String.Check(v => v.email());
                validateValue(fieldDeclaration, "example@example.com");
                assert.throws(() => { validateValue(fieldDeclaration, "not an email"); });
            });
        });

        suite("Slug", () => {

            test("Basic field", () => {
                const fieldDeclaration = Field.Slug;
                assert.equal(fieldDeclaration.type, FieldType.Slug);
                assert.equal(fieldDeclaration.nullable, false);
    
                const value1 = validateValue(fieldDeclaration, "a-slug");
                checkType<AssertEqual<typeof value1, string>>();
                assert.typeOf(value1, "string");
                assert.strictEqual(value1, "a-slug");  // Ensure that validation has preserved the value.
                // These should all be valid:
                const check = (str: string): void => assert.strictEqual(validateValue(fieldDeclaration, str), str);
                check("CAPITALS");
                check("many-long-words");
                check("Solární-panel");
                check("ソーラーパネル");
                check("солнечная-панель")
                check("لوحة-شمسية");

                assert.throws(() => { validateValue(fieldDeclaration, "spaces between words"); });
                assert.throws(() => { validateValue(fieldDeclaration, "under_score"); });
                assert.throws(() => { validateValue(fieldDeclaration, null); });
            });
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.Slug;
                assert.equal(fieldDeclaration.type, FieldType.Slug);
                assert.equal(fieldDeclaration.nullable, true);
    
                const value1 = validateValue(fieldDeclaration, "a-slug");
                checkType<AssertEqual<typeof value1, string|null>>();
                const value2 = validateValue(fieldDeclaration, null);
                assert.strictEqual(value2, null);
                assert.throws(() => { validateValue(fieldDeclaration, "under_score"); });
                assert.throws(() => { validateValue(fieldDeclaration, {}); });
                assert.throws(() => { validateValue(fieldDeclaration, undefined); });
            });

            test("Length limit defaults to 60 but can be increased", () => {
                validateValue(Field.Slug, "a".repeat(60));
                assert.throws(() => { validateValue(Field.Slug, "a".repeat(61)); });
                const customLengthField = Field.Slug.Check(s => s.max(100));
                validateValue(customLengthField, "a".repeat(100));
                assert.throws(() => { validateValue(customLengthField, "a".repeat(200)); });
            });
    
            test(".Check(...)", () => {
                // Add a custom check, in this case that the slug must be lowercase:
                const fieldDeclaration = Field.Slug.Check(v => v.lowercase());
                validateValue(fieldDeclaration, "lowercase-slug");
                assert.throws(() => { validateValue(fieldDeclaration, "Capital-Slug"); });
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
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.Boolean;
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
                assert.equal(validateValue(fieldDeclaration, new Neo4jDate<number>(2021, 6, 1)).toString(), "2021-06-01");

                // We do not auto-convert string values to VDate, because that could hide an issue where some date
                // property values in the database are stored as strings while others are stored as dates.
                assert.throws(() => { validateValue(fieldDeclaration, stringDate); });
                // JavaScript Date objects are not allowed, due to timezone issues
                // e.g. on my system, new Date("2021-03-01").toString() gives "Feb 28 2021..."
                assert.throws(() => { validateValue(fieldDeclaration, new Date()); });
                assert.throws(() => { validateValue(fieldDeclaration, "50"); });
                assert.throws(() => { validateValue(fieldDeclaration, null); });
            });
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.Date;
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
    
            test("NullOr.", () => {
                const fieldDeclaration = Field.NullOr.DateTime;
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

        suite("validatePropSchema", () => {
            const buildingSchema: PropSchema = {
                name: Field.String,
                numHomes: Field.Int.Check(n => n.min(1)),  // How many homes/apartments are in this building
                numOccupiedHomes: Field.Int.Check(n => n.min(0).max(Field.Check.ref("numHomes"))),
            };

            test("Accepts a valid value", () => {
                validatePropSchema(buildingSchema, {
                    name: "Hogwarts Dorm A",
                    numHomes: 100,
                    numOccupiedHomes: 50,
                });
            });

            test("Rejects an invalid value", () => {
                assert.throws(() => {
                    validatePropSchema(buildingSchema, {
                        name: "Imaginary Building",
                        numHomes: 0,
                        numOccupiedHomes: -50,
                    });
                }, `"numHomes" must be larger than or equal to 1`);
            });

            test("Rejects an invalid value using Joi reference", () => {
                assert.throws(() => {
                    validatePropSchema(buildingSchema, {
                        name: "SuperOccupied Terrace",
                        numHomes: 40,
                        numOccupiedHomes: 50,  // Invalid since it's larger than homes
                    });
                }, `"numOccupiedHomes" must be less than or equal to ref:numHomes`);
            });
        });
    });

    suite("Property vs Generic vs Response Schemas", () => {

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
                // @ts-expect-error a Record is not allowed in a property schema
                fieldRecord: Field.Record({key: Field.String}),
                // @ts-expect-error a Record is not allowed in a property schema
                fieldList: Field.List(Field.String),
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
                fieldRecord: Field.Record({key: Field.String, key2: Field.List(Field.Boolean)}),
                fieldList: Field.List(Field.NullOr.String),
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
                fieldRecord: Field.Record({key: Field.String, key2: Field.List(Field.Boolean)}),
                fieldList: Field.List(Field.NullOr.String),
                fieldNode: Field.Node,
                fieldVNode: Field.VNode(Person),
                fieldListNode: Field.List(Field.Node),
                fieldAny: Field.Any,
            });
        });
    });

    suite("ResponseSchema and GetDataShape", () => {

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
        // Composite types:

        test("Record", () => {
            const shape = ResponseSchema({
                mapField: Field.Record({
                    subMap: Field.Record({ subKey1: Field.NullOr.String, subKey2: Field.BigInt }),
                    otherKey: Field.String,
                }),
                nullMap: Field.NullOr.Record({
                    key1: Field.VNID,
                }),
            });
            checkType<AssertEqual<GetDataShape<typeof shape>, {
                mapField: {
                    subMap: { subKey1: string|null, subKey2: bigint },
                    otherKey: string,
                },
                nullMap: null|{
                    key1: VNID,
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
