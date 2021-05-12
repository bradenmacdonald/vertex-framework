import { suite, test, assert, assertRejects, configureTestData } from "../lib/intern-tests";
import { convertNeo4jRecord } from "./cypher-return-shape";
import { AssertEqual, AssertPropertyAbsent, AssertPropertyPresent, checkType } from "../lib/ts-utils";
import { testGraph, Person } from "../test-project";
import { Field, ResponseSchema, GetDataShape } from "./field";
import { VDate, VNID } from "..";

suite("Cypher return shape specification", () => {

    // Note: this test suite deliberately avoids using any cypher syntactic sugar (C`...`) or pull() and just focuses
    // on testing the ReturnShape specification class itself, as well as convertNeo4jRecord()

    async function runAndConvert<RS extends ResponseSchema>(query: string, params: any, shape: RS): Promise<GetDataShape<RS>[]> {
        const result = await testGraph.read(tx => tx.run(query, params));
        return result.records.map(record => convertNeo4jRecord(record, shape));
    }

    test("basic test - a typed record with an Any field.", async () => {
        const shape = ResponseSchema({value: Field.Any});
        const results = await runAndConvert(`RETURN {foo: "bar"} as value`, {}, shape);
        assert.deepStrictEqual(results, [{value: {foo: "bar"}}]);
    });
    test("basic test - a typed record with a VNID field.", async () => {
        const shape = ResponseSchema({value: Field.String});
        const results = await runAndConvert(`RETURN "_12345678" as value`, {}, shape);
        assert.deepStrictEqual(results, [{value: VNID("_12345678")}]);
        assert.typeOf(results[0].value, "string");
    });
    test("basic test - a typed record with an Int field.", async () => {
        const shape = ResponseSchema({value: Field.Int});
        const results = await runAndConvert(`RETURN 1234 as value`, {}, shape);
        assert.deepStrictEqual(results, [{value: 1234}]);
        assert.typeOf(results[0].value, "number");
    });
    test("basic test - a typed record with an BigInt field.", async () => {
        const number = 9_444_333_222_111_000n;
        const shape = ResponseSchema({value: Field.BigInt});
        const results = await runAndConvert(`RETURN $number as value`, {number, }, shape);
        assert.deepStrictEqual(results, [{value: number}]);
        assert.typeOf(results[0].value, "bigint");
    });
    test("basic test - a typed record with an Float field.", async () => {
        const number = 0.0625;  // This is a number that can be represented exactly in both binary and decimal floating point
        const shape = ResponseSchema({value: Field.Float});
        const results = await runAndConvert(`RETURN $number as value`, {number, }, shape);
        assert.deepStrictEqual(results, [{value: number}]);
        assert.typeOf(results[0].value, "number");
    });
    test("basic test - a typed record with a String field.", async () => {
        const shape = ResponseSchema({value: Field.String});
        const results = await runAndConvert(`RETURN "hello" as value`, {}, shape);
        assert.deepStrictEqual(results, [{value: "hello"}]);
        assert.typeOf(results[0].value, "string");
    });
    test("basic test - a typed record with a String field (Unicode).", async () => {
        const hello = "안녕하세요";
        const shape = ResponseSchema({value: Field.String});
        const results = await runAndConvert(`RETURN $hello as value`, {hello}, shape);
        assert.deepStrictEqual(results, [{value: hello}]);
        assert.typeOf(results[0].value, "string");
    });
    test("basic test - a typed record with a Slug field.", async () => {
        const shape = ResponseSchema({value: Field.Slug});
        const results = await runAndConvert(`RETURN "hello" as value`, {}, shape);
        assert.deepStrictEqual(results, [{value: "hello"}]);
        assert.typeOf(results[0].value, "string");
    });
    test("basic test - a typed record with a Slug field (Unicode).", async () => {
        const hello = "안녕하세요";
        const shape = ResponseSchema({value: Field.Slug});
        const results = await runAndConvert(`RETURN $hello as value`, {hello}, shape);
        assert.deepStrictEqual(results, [{value: hello}]);
        assert.typeOf(results[0].value, "string");
    });
    test("basic test - a typed record with a Boolean field.", async () => {
        const shape = ResponseSchema({value: Field.Boolean});
        const results = await runAndConvert(`RETURN true as value`, {}, shape);
        assert.deepStrictEqual(results, [{value: true}]);
        assert.typeOf(results[0].value, "boolean");
    });
    test("basic test - a typed record with a Date field.", async () => {
        const shape = ResponseSchema({value: Field.Date});
        const results = await runAndConvert(`RETURN date("2021-05-11") as value`, {}, shape);
        assert.typeOf(results[0].value, "object");
        assert.instanceOf(results[0].value, VDate);
        assert.strictEqual(results[0].value.toString(), "2021-05-11");
    });
    test("basic test - a typed record with a Date field, VDate object passed in to Neo4j", async () => {
        // This is similar to the previous test but tests that we can pass IN a date parameter as a VDate
        const shape = ResponseSchema({value: Field.Date});
        const results = await runAndConvert(`RETURN $dateObj as value`, {dateObj: VDate.fromString("2021-05-11")}, shape);
        assert.typeOf(results[0].value, "object");
        assert.instanceOf(results[0].value, VDate);
        assert.strictEqual(results[0].value.toString(), "2021-05-11");
    });
    test("basic test - a typed record with a DateTime field.", async () => {
        const dateStr = "2019-06-01T18:40:32.000Z";  // A unicode timestamp in UTC
        const shape = ResponseSchema({value: Field.DateTime});
        const results = await runAndConvert(`RETURN datetime($dateStr) as value`, {dateStr, }, shape);
        assert.instanceOf(results[0].value, Date);
        assert.strictEqual(results[0].value.toISOString(), dateStr);
    });

    test("basic test - a typed record with a list of numbers field and a boolean field.", async () => {
        const shape = ResponseSchema({boolField: Field.Boolean, listOfNumbers: Field.List(Field.Int)});
        const results = await runAndConvert(`RETURN true as boolField, [1, 2, 3] as listOfNumbers`, {}, shape);
        assert.deepStrictEqual(results, [{
            boolField: true,
            listOfNumbers: [1, 2, 3],
        }]);
    });

    test("basic test - a nullable number and a map", async () => {
        const shape = ResponseSchema({
            numberOrNull: Field.Int.OrNull,
            mapField: Field.Map({
                val1: Field.String,
                val2: Field.Any,
            }),
        });

        const results = await runAndConvert(`
            UNWIND [
                {numberOrNull: 123, mapField: {val1: "one", val2: true}},
                {numberOrNull: null, mapField: {val1: "two", val2: null}}
            ] AS row
            RETURN row.numberOrNull as numberOrNull, row.mapField as mapField
        `, {}, shape);
        assert.deepStrictEqual(results, [
            {
                numberOrNull: 123,
                mapField: {val1: "one", val2: true},
            },
            {
                numberOrNull: null,
                mapField: {val1: "two", val2: null},
            },
        ]);
    });

    suite("Convert Nodes to RawVNode", () => {

        suite("test with real data", () => {
            configureTestData({loadTestProjectData: true, isolateTestWrites: false});

            test("retrieve a Person VNode", async () => {
                const shape = ResponseSchema({p: Field.VNode(Person)});
                const results = await runAndConvert(`MATCH (p:TestPerson:VNode {slugId: $slugId}) RETURN p`, {slugId: "the-rock"}, shape);
                assert.lengthOf(results, 1);
                const theRock = results[0].p;
    
                checkType<AssertPropertyPresent<typeof theRock, "name", string>>();
                checkType<AssertPropertyAbsent<typeof theRock, "someOtherThing">>();
    
                assert.strictEqual(theRock.name, "Dwayne Johnson");
                assert.strictEqual(theRock.slugId, "the-rock");
                assert.includeMembers(theRock._labels, ["TestPerson", "VNode"]);
            });
        });

        test("retrieving a non-node as a VNode should fail", async () => {
            const shape = ResponseSchema({p: Field.VNode(Person)});
            await assertRejects(
                runAndConvert(`RETURN false AS p`, {}, shape),
                "Field p is of type boolean, not a VNode."
            );
        });

        test("retrieving a non-VNode as a VNode should fail", async () => {
            const shape = ResponseSchema({p: Field.VNode(Person)});
            await assertRejects(
                runAndConvert(`MATCH (s:SlugId) RETURN s AS p LIMIT 1`, {}, shape),
                "Field p is a node but is missing the VNode label"
            );
        });
    });
});
