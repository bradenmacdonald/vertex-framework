import { Neo4j } from "../deps.ts";
import { group, test, assertEquals, assert, assertIsEmpty, assertThrows } from "../lib/tests.ts";
import { C, CypherQuery, VNID, Field } from "../index.ts";
import { testGraph, Person } from "../test-project/index.ts";

/** Helper function to calculate the dbHits cost of a profiled cypher query */
const sumDbHits = (profile: Neo4j.ProfiledPlan|false): number => {
    if (profile === false) {
        throw new Error("Profile is missing");
    }
    return profile.dbHits + profile.children.reduce((acc, childProfile) => acc + sumDbHits(childProfile), 0);
}

group(import.meta, () => {

    test("doesn't change a basic string", () => {
        const query = C`MATCH (n) RETURN n`;
        assertEquals(query.queryString, "MATCH (n) RETURN n");
        assertIsEmpty(query.params);
    });

    test("can wrap a basic string", () => {
        const query = C("MATCH (n) RETURN n");
        assertEquals(query.queryString, "MATCH (n) RETURN n");
        assertIsEmpty(query.params);
    });

    test("Lazily interpolates VNodeType labels", () => {
        // Lazy interpolation is important as it reduces worries about circular references. You can interpolate a
        // VNode type into a query string even while the variable's value it undefined (module is still loading), and
        // later when it's actually needed, we'll load the .label value from the fully loaded VNode type.
        const query = C`MATCH (p:${Person}) RETURN p.id`;
        assert(!query.isCompiled);
        assertEquals(query.queryString, "MATCH (p:TestPerson:VNode) RETURN p.id");
        assert(query.isCompiled);
        assertIsEmpty(query.params);
    });

    test("Lazily interpolates VNodeTypeRelationship labels", () => {
        // Lazy interpolation is important as it reduces worries about circular references. You can interpolate a
        // VNode type into a query string even while the variable's value it undefined (module is still loading), and
        // later when it's actually needed, we'll load the .label value from the fully loaded VNode type.
        const query = C`MATCH (p:${Person})-[:${Person.rel.FRIEND_OF}]->(friend:${Person})`;
        assert(!query.isCompiled);
        assertEquals(query.queryString, "MATCH (p:TestPerson:VNode)-[:FRIEND_OF]->(friend:TestPerson:VNode)");
        assert(query.isCompiled);
        assertIsEmpty(query.params);
    });

    test("Doesn't interpolate a VNodeType as a value", () => {
        const query = C`MATCH (p:VNode) SET p.someField = ${Person} RETURN p.id`;
        assertThrows(() => query.queryString, "Interpolating a VNodeType into a string is only supported for matching labels");
    });

    test("Interpolates values", () => {
        // (this interpolation is also lazy, but we don't really care that it is)
        const vnid = VNID("_52DMYoaBc3fGp528wZJSFS");
        const name = "Jessie"
        const query = C`MATCH (p:${Person} {id: ${vnid}}) SET p.name = ${name}`;
        assertEquals(query.queryString, "MATCH (p:TestPerson:VNode {id: $p1}) SET p.name = $p2");
        assertEquals(query.params, {
            p1: vnid,
            p2: name,
        });
    });

    test("Interpolates values, if .params are accessed before .queryString", () => {
        const vnid = VNID("_52DMYoaBc3fGp528wZJSFS");
        const name = "Jessie"
        const query = C`MATCH (p:${Person} {id: ${vnid}}) SET p.name = ${name}`;
        assertEquals(query.params, {
            p1: vnid,
            p2: name,
        });
        assertEquals(query.queryString, "MATCH (p:TestPerson:VNode {id: $p1}) SET p.name = $p2");
    });

    test("Interpolates values as-is when C() is explicitly used.", () => {
        const vnid = VNID("_52DMYoaBc3fGp528wZJSFS");
        const label = "SomeLabel";
        const query = C`MATCH (p:${C(label)}:VNode {id: ${vnid}})`;
        assertEquals(query.queryString, "MATCH (p:SomeLabel:VNode {id: $p1})");
        assertEquals(query.params, {p1: vnid});
    });

    test("Interpolates other CypherQuery instances", () => {
        // Construct a MATCH clause without the MATCH keyword:
        const vnid = VNID("_52DMYoaBc3fGp528wZJSFS");
        const matchClause = C`(p:${Person} {id: ${vnid}})`;

        const name = "Alex";
        const outerClause = C`MATCH ${matchClause} SET p.name = ${name}`;
        assertEquals(outerClause.queryString, "MATCH (p:TestPerson:VNode {id: $clause0_p1}) SET p.name = $p1");
        assertEquals(outerClause.params, {clause0_p1: vnid, p1: name});
    });

    test("Lets us use .withParams() to add custom parameters", () => {
        // (this interpolation is also lazy, but we don't really care that it is)
        const vnid = VNID("_52DMYoaBc3fGp528wZJSFS");
        const query = C`
            MERGE (p:${Person} {id: ${vnid}})
            SET p.name = $name, p.username = toLower($name)
        `.withParams({name: "Alex"});
        assertEquals(query.queryString, `
            MERGE (p:TestPerson:VNode {id: $p1})
            SET p.name = $name, p.username = toLower($name)
        `);
        assertEquals(query.params, {p1: vnid, name: "Alex"});
    });

    test(".withParams() does not alter the original", () => {
        // (this interpolation is also lazy, but we don't really care that it is)
        const baseQuery = C`MATCH (p:${Person} {id: $vnid})`;
        const q1 = baseQuery.withParams({id: VNID("_1111111111111111111111")});
        const q2 = baseQuery.withParams({id: VNID("_2222222222222222222222")});
        assertEquals(q1.params, {id: VNID("_1111111111111111111111")});
        assertEquals(q2.params, {id: VNID("_2222222222222222222222")});
        // Now compile baseQuery then call withParams, to make sure withParams works on a compiled query:
        assert(!baseQuery.isCompiled);
        assertIsEmpty(baseQuery.params);
        assert(baseQuery.isCompiled);
        const q3 = baseQuery.withParams({id: VNID("_3333333333333333333333")});
        assertEquals(q3.params, {id: VNID("_3333333333333333333333")});
    });

    test("C() can be used directly", () => {
        // If someone doesn't like the C`...` tagged template literal helper, it can always
        // be used to directly construct a query string, and params passed in via .withParams()
        const query = C("MATCH (vn:VNode {id: $customKeyArg})").withParams({
            customKeyArg: VNID("_1111111111111111111111"),
        });
        assertEquals(query.queryString, `MATCH (vn:VNode {id: $customKeyArg})`);
        assertEquals(query.params, {customKeyArg: VNID("_1111111111111111111111")});
    });

    test("C.int() can be used to force a value to use the Neo4j Integer type", async () => {
        // JavaScript doesn't distinguish between integers and floats.
        // The JavaScript driver for Neo4j will treat all Numbers as floats.
        // If one wants to save a number as an Integer explicitly, use C.int()
        const numValue = 15;

        const defaultQuery = C`RETURN apoc.meta.cypher.type(${numValue}) AS numberType`;
        const defaultResult = await testGraph.read(tx => tx.run(defaultQuery.queryString, defaultQuery.params));
        assertEquals(defaultResult.records[0].get("numberType"), "FLOAT");

        const intQuery = C`RETURN apoc.meta.cypher.type(${C.int(numValue)}) AS numberType`;
        const intResult = await testGraph.read(tx => tx.run(intQuery.queryString, intQuery.params));
        assertEquals(intResult.records[0].get("numberType"), "INTEGER");
    });

    test("CypherQuery throws an error if passed invalid arguments", () => {
        assertThrows(() => {
            new CypherQuery(["one string"], ["two", "args"]);
        }, "expected params array to have length 1 less than strings array");
    });

    test("throws an error if passed multiple values for the same argument", () => {
        assertThrows(() => {
            C`MATCH (p:${Person})`.withParams({foo: "bar"}).withParams({foo: "other"});
        }, `Multiple values for query parameter "foo"`);
    });

    group("return shape", () => {

        test(".givesShape() can store a return shape", () => {
            const baseQuery = C`MATCH (p:${Person}) RETURN p.id`;

            const withReturnShape = baseQuery.givesShape({"p.id": Field.VNID});

            assertEquals(withReturnShape.returnShape, {"p.id": Field.VNID});
        });

        test(".RETURN() can store a return shape and generate the RETURN clause", () => {
            const query = C`MATCH (p:${Person})`.RETURN({"p.id": Field.VNID, "p.name": Field.String});

            assertEquals(query.queryString, "MATCH (p:TestPerson:VNode)\nRETURN p.id, p.name");
            assertEquals(query.returnShape, {"p.id": Field.VNID, "p.name": Field.String});
        });

        test(".RETURN({}) generates a RETURN null clause and an empty return shape", () => {
            const query = C`MATCH (p:${Person})`.RETURN({});

            assertEquals(query.queryString, "MATCH (p:TestPerson:VNode)\nRETURN null");
            assertEquals(query.returnShape, {});
        });
    });
});
