import { suite, test, assert } from "./lib/intern-tests";
import { convertNeo4jRecord, ReturnShape, TypedResult } from "./cypher-return-shape";
import { AssertEqual, AssertPropertyAbsent, AssertPropertyPresent, checkType } from "./lib/ts-utils";
import { testGraph } from "./test-project/graph";

suite("Cypher return shape specification", () => {

    async function runAndConvert<RS extends ReturnShape>(query: string, params: any, shape: RS): Promise<TypedResult<RS>[]> {
        const result = await testGraph.read(tx => tx.run(query));
        return result.records.map(record => convertNeo4jRecord(record, shape));
    }

    test("basic test - a typed record with a string field.", async () => {
        const shape = ReturnShape({myString: "string"});

        checkType<AssertEqual<TypedResult<typeof shape>, {
            myString: string,
        }>>();
        checkType<AssertPropertyPresent<TypedResult<typeof shape>, "myString", string>>();
        checkType<AssertPropertyAbsent<TypedResult<typeof shape>, "otherField">>();

        const results = await runAndConvert(`RETURN "hello" as myString`, {}, shape);
        assert.deepEqual(results, [{myString: "hello"}]);
    });

    test("basic test - a typed record with a list of numbers field and a boolean field.", async () => {
        const shape = ReturnShape({boolField: "boolean", listOfNumbers: {list: "number"}});

        checkType<AssertEqual<TypedResult<typeof shape>, {
            boolField: boolean,
            listOfNumbers: number[],
        }>>();
        checkType<AssertPropertyPresent<TypedResult<typeof shape>, "boolField", boolean>>();
        checkType<AssertPropertyPresent<TypedResult<typeof shape>, "listOfNumbers", number[]>>();
        checkType<AssertPropertyAbsent<TypedResult<typeof shape>, "otherField">>();

        const results = await runAndConvert(`RETURN true as boolField, [1, 2, 3] as listOfNumbers`, {}, shape);
        assert.deepEqual(results, [{
            boolField: true,
            listOfNumbers: [1, 2, 3],
        }]);
    });

    test("basic test - a nullable number and a map", async () => {
        const shape = ReturnShape({numberOrNull: {nullOr: "number"}, mapField: {map: {val1: "string", val2: "any"}}});

        checkType<AssertEqual<TypedResult<typeof shape>, {
            numberOrNull: number|null,
            mapField: {
                val1: string,
                val2: any,
            },
        }>>();
        checkType<AssertPropertyPresent<TypedResult<typeof shape>, "numberOrNull", number|null>>();
        checkType<AssertPropertyAbsent<TypedResult<typeof shape>, "otherField">>();

        const results = await runAndConvert(`
            UNWIND [
                {numberOrNull: 123, mapField: {val1: "one", val2: true}},
                {numberOrNull: null, mapField: {val1: "two", val2: null}}
            ] AS row
            RETURN row.numberOrNull as numberOrNull, row.mapField as mapField
        `, {}, shape);
        assert.deepEqual(results, [
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

});
