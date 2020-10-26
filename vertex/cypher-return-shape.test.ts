import { suite, test, assert, assertRejects } from "./lib/intern-tests";
import { convertNeo4jRecord, ReturnShape, TypedResult } from "./cypher-return-shape";
import { AssertEqual, AssertPropertyAbsent, AssertPropertyPresent, checkType } from "./lib/ts-utils";
import { testGraph } from "./test-project/graph";
import { Person } from "./test-project/Person";

suite("Cypher return shape specification", () => {

    // Note: this test suite deliberately avoids using any cypher syntactic sugar (C`...`) or pull() and just focuses
    // on testing the ReturnShape specification class itself, as well as convertNeo4jRecord()

    async function runAndConvert<RS extends ReturnShape>(query: string, params: any, shape: RS): Promise<TypedResult<RS>[]> {
        const result = await testGraph.read(tx => tx.run(query, params));
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
        assert.deepStrictEqual(results, [{myString: "hello"}]);
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
        assert.deepStrictEqual(results, [{
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

        test("retrieve a Person VNode", async () => {
            const shape = ReturnShape({p: Person});
            const results = await runAndConvert(`MATCH (p:TestPerson:VNode {shortId: $shortId}) RETURN p`, {shortId: "the-rock"}, shape);
            assert.lengthOf(results, 1);
            const theRock = results[0].p;

            checkType<AssertPropertyPresent<typeof theRock, "name", string>>();
            checkType<AssertPropertyAbsent<typeof theRock, "someOtherThing">>();

            assert.strictEqual(theRock.name, "Dwayne Johnson");
            assert.strictEqual(theRock.shortId, "the-rock");
            assert.includeMembers(theRock._labels, ["TestPerson", "VNode"]);
            assert.isNumber(theRock._identity);
        });

        test("retrieving a non-node as a VNode should fail", async () => {
            const shape = ReturnShape({p: Person});
            await assertRejects(
                runAndConvert(`RETURN false AS p`, {}, shape),
                "Field p is of type boolean, not a VNode."
            );
        });

        test("retrieving a non-VNode as a VNode should fail", async () => {
            const shape = ReturnShape({p: Person});
            await assertRejects(
                runAndConvert(`MATCH (s:ShortId) RETURN s AS p LIMIT 1`, {}, shape),
                "Field p is a node but is missing the VNode label"
            );
        });
    });
});
