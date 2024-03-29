import {
    assert,
    assertArrayIncludes,
    assertEquals,
    assertRejects,
    assertType,
    IsPropertyPresent,
    configureTestData,
    group,
    IsExact,
    test,
} from "../lib/tests.ts";
import { convertNeo4jRecord } from "./cypher-return-shape.ts";
import { testGraph, Person } from "../test-project/index.ts";
import { VDate, VNID, Field, ResponseSchema, GetDataShape } from "../index.ts";

group(import.meta, () => {

    // Note: this test suite deliberately avoids using any cypher syntactic sugar (C`...`) or pull() and just focuses
    // on testing the ReturnShape specification class itself, as well as convertNeo4jRecord()

    async function runAndConvert<RS extends ResponseSchema>(query: string, params: Record<string, unknown>, shape: RS): Promise<GetDataShape<RS>[]> {
        const result = await testGraph.read(tx => tx.run(query, params));
        return result.records.map(record => convertNeo4jRecord(record, shape));
    }

    test("basic test - a typed record with a VNID field.", async () => {
        const shape = ResponseSchema({value: Field.String});
        const results = await runAndConvert(`RETURN "_12345678" as value`, {}, shape);
        assertEquals(results, [{value: VNID("_12345678")}]);
        assertEquals(typeof results[0].value, "string");
    });
    test("basic test - a typed record with an Int field.", async () => {
        const shape = ResponseSchema({value: Field.Int});
        const results = await runAndConvert(`RETURN 1234 as value`, {}, shape);
        assertEquals(results, [{value: 1234}]);
        assertEquals(typeof results[0].value, "number");
    });
    test("basic test - a typed record with an BigInt field.", async () => {
        const number = 9_444_333_222_111_000n;
        const shape = ResponseSchema({value: Field.BigInt});
        const results = await runAndConvert(`RETURN $number as value`, {number, }, shape);
        assertEquals(results, [{value: number}]);
        assertEquals(typeof results[0].value, "bigint");
    });
    test("basic test - a typed record with an Float field.", async () => {
        const number = 0.0625;  // This is a number that can be represented exactly in both binary and decimal floating point
        const shape = ResponseSchema({value: Field.Float});
        const results = await runAndConvert(`RETURN $number as value`, {number, }, shape);
        assertEquals(results, [{value: number}]);
        assertEquals(typeof results[0].value, "number");
    });
    test("basic test - a typed record with a String field.", async () => {
        const shape = ResponseSchema({value: Field.String});
        const results = await runAndConvert(`RETURN "hello" as value`, {}, shape);
        assertEquals(results, [{value: "hello"}]);
        assertEquals(typeof results[0].value, "string");
    });
    test("basic test - a typed record with a String field (Unicode).", async () => {
        const hello = "안녕하세요";
        const shape = ResponseSchema({value: Field.String});
        const results = await runAndConvert(`RETURN $hello as value`, {hello}, shape);
        assertEquals(results, [{value: hello}]);
        assertEquals(typeof results[0].value, "string");
    });
    test("basic test - a typed record with a Slug field.", async () => {
        const shape = ResponseSchema({value: Field.Slug});
        const results = await runAndConvert(`RETURN "hello" as value`, {}, shape);
        assertEquals(results, [{value: "hello"}]);
        assertEquals(typeof results[0].value, "string");
    });
    test("basic test - a typed record with a Slug field (Unicode).", async () => {
        const hello = "안녕하세요";
        const shape = ResponseSchema({value: Field.Slug});
        const results = await runAndConvert(`RETURN $hello as value`, {hello}, shape);
        assertEquals(results, [{value: hello}]);
        assertEquals(typeof results[0].value, "string");
    });
    test("basic test - a typed record with a JsonObjString field.", async () => {
        const shape = ResponseSchema({value: Field.JsonObjString});
        const results = await runAndConvert(`RETURN "{\\"foo\\": 123, \\"bar\\": [true, false]}" as value`, {}, shape);
        assertEquals(results, [{value: {foo: 123, bar: [true, false]}}]);
        assertEquals(typeof results[0].value, "object");
    });
    test("basic test - a typed record with a Boolean field.", async () => {
        const shape = ResponseSchema({value: Field.Boolean});
        const results = await runAndConvert(`RETURN true as value`, {}, shape);
        assertEquals(results, [{value: true}]);
        assertEquals(typeof results[0].value, "boolean");
    });
    test("basic test - a typed record with a Date field.", async () => {
        const shape = ResponseSchema({value: Field.Date});
        const results = await runAndConvert(`RETURN date("2021-05-11") as value`, {}, shape);
        assertEquals(typeof results[0].value, "object");
        assert(results[0].value instanceof VDate);
        assertEquals(results[0].value.toString(), "2021-05-11");
    });
    test("basic test - a typed record with a Date field, VDate object passed in to Neo4j", async () => {
        // This is similar to the previous test but tests that we can pass IN a date parameter as a VDate
        const shape = ResponseSchema({value: Field.Date});
        const results = await runAndConvert(`RETURN $dateObj as value`, {dateObj: VDate.fromString("2021-05-11")}, shape);
        assertEquals(typeof results[0].value, "object");
        assert(results[0].value instanceof VDate);
        assertEquals(results[0].value.toString(), "2021-05-11");
    });
    test("basic test - a typed record with a DateTime field.", async () => {
        const dateStr = "2019-06-01T18:40:32.000Z";  // A unicode timestamp in UTC
        const shape = ResponseSchema({value: Field.DateTime});
        const results = await runAndConvert(`RETURN datetime($dateStr) as value`, {dateStr, }, shape);
        assert(results[0].value instanceof Date);
        assertEquals(results[0].value.toISOString(), dateStr);
    });

    test("basic test - a typed record with a list of numbers field and a boolean field.", async () => {
        const shape = ResponseSchema({boolField: Field.Boolean, listOfNumbers: Field.List(Field.Int)});
        const results = await runAndConvert(`RETURN true as boolField, [1, 2, 3] as listOfNumbers`, {}, shape);
        assertEquals(results, [{
            boolField: true,
            listOfNumbers: [1, 2, 3],
        }]);
    });

    test("basic test - a nullable number and a record", async () => {
        const shape = ResponseSchema({
            numberOrNull: Field.NullOr.Int,
            recordField: Field.Record({
                val1: Field.String,
                val2: Field.NullOr.Boolean,
            }),
        });

        const results = await runAndConvert(`
            UNWIND [
                {numberOrNull: 123, recordField: {val1: "one", val2: true}},
                {numberOrNull: null, recordField: {val1: "two", val2: null}}
            ] AS row
            RETURN row.numberOrNull as numberOrNull, row.recordField as recordField
        `, {}, shape);
        assertEquals(results, [
            {
                numberOrNull: 123,
                recordField: {val1: "one", val2: true},
            },
            {
                numberOrNull: null,
                recordField: {val1: "two", val2: null},
            },
        ]);
    });

    test("basic test - a map of lists of integers", async () => {
        const shape = ResponseSchema({
            mapField: Field.Map(Field.List(Field.Int)),
        });

        const results = await runAndConvert(`
            UNWIND [
                {mapField: {pi: [3,1,4,1,5,9,2], e: [2,7,1,8,2,8]}},
                {mapField: {φ: [1,6,1,8,0,3,3]}}
            ] AS row
            RETURN row.mapField as mapField
        `, {}, shape);
        assertEquals(results, [
            {
                mapField: {pi: [3,1,4,1,5,9,2], e: [2,7,1,8,2,8]},
            },
            {
                mapField: {φ: [1,6,1,8,0,3,3]},
            },
        ]);
    });

    group("Convert Nodes to RawVNode", () => {

        group("test with real data", () => {
            configureTestData({loadTestProjectData: true, isolateTestWrites: false});

            test("retrieve a Person VNode", async () => {
                const shape = ResponseSchema({p: Field.VNode(Person)});
                const results = await runAndConvert(`MATCH (p:TestPerson:VNode {slugId: $slugId}) RETURN p`, {slugId: "the-rock"}, shape);
                assertEquals(results.length, 1);
                const theRock = results[0].p;
    
                assertType<IsExact<(typeof theRock)["name"], string>>(true);
                assertType<IsPropertyPresent<typeof theRock, "someOtherThing">>(false);
    
                assertEquals(theRock.name, "Dwayne Johnson");
                assertEquals(theRock.slugId, "the-rock");
                assertArrayIncludes(theRock._labels, ["TestPerson", "VNode"]);
            });
        });

        test("retrieving a non-node as a VNode should fail", async () => {
            const shape = ResponseSchema({p: Field.VNode(Person)});
            await assertRejects(
                () => runAndConvert(`RETURN false AS p`, {}, shape),
                "Field p is of type boolean, not a VNode."
            );
        });

        test("retrieving a non-VNode as a VNode should fail", async () => {
            const shape = ResponseSchema({p: Field.VNode(Person)});
            await assertRejects(
                // Note that apoc.create.vNode is *completely* different than our "VNode"s
                () => runAndConvert(`
                    CALL apoc.create.vNode(["NotVNode"], {prop: "value"}) YIELD node
                    RETURN node AS p LIMIT 1
                `, {}, shape),
                "Field p is a node but is missing the VNode label"
            );
        });
    });
});
