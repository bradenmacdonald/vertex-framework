import { suite, test, assert, configureTestData } from "../lib/intern-tests";
import { C, CypherQuery, VNID } from "..";
import { testGraph, Person } from "../test-project";
import { ProfiledPlan } from "neo4j-driver";

/** Helper function to calculate the dbHits cost of a profiled cypher query */
const sumDbHits = (profile: ProfiledPlan): number => {
    return profile.dbHits + profile.children.reduce((acc, childProfile) => acc + sumDbHits(childProfile), 0);
}

suite("Cypher syntactic sugar", () => {

    test("doesn't change a basic string", () => {
        const query = C`MATCH (n) RETURN n`;
        assert.equal(query.queryString, "MATCH (n) RETURN n");
        assert.isEmpty(query.params);
    });

    test("can wrap a basic string", () => {
        const query = C("MATCH (n) RETURN n");
        assert.equal(query.queryString, "MATCH (n) RETURN n");
        assert.isEmpty(query.params);
    });

    test("Lazily interpolates VNodeType labels", () => {
        // Lazy interpolation is important as it reduces worries about circular references. You can interpolate a
        // VNode type into a query string even while the variable's value it undefined (module is still loading), and
        // later when it's actually needed, we'll load the .label value from the fully loaded VNode type.
        const query = C`MATCH (p:${Person}) RETURN p.id`;
        assert.isFalse(query.isCompiled);
        assert.equal(query.queryString, "MATCH (p:TestPerson:VNode) RETURN p.id");
        assert.isTrue(query.isCompiled);
        assert.isEmpty(query.params);
    });

    test("Lazily interpolates VNodeTypeRelationship labels", () => {
        // Lazy interpolation is important as it reduces worries about circular references. You can interpolate a
        // VNode type into a query string even while the variable's value it undefined (module is still loading), and
        // later when it's actually needed, we'll load the .label value from the fully loaded VNode type.
        const query = C`MATCH (p:${Person})-[:${Person.rel.FRIEND_OF}]->(friend:${Person})`;
        assert.isFalse(query.isCompiled);
        assert.equal(query.queryString, "MATCH (p:TestPerson:VNode)-[:FRIEND_OF]->(friend:TestPerson:VNode)");
        assert.isTrue(query.isCompiled);
        assert.isEmpty(query.params);
    });

    test("Doesn't interpolate a VNodeType as a value", () => {
        const query = C`MATCH (p:VNode) SET p.someField = ${Person} RETURN p.id`;
        assert.throws(() => query.queryString, "Interpolating a VNodeType into a string is only supported for matching labels");
    });

    test("Interpolates values", () => {
        // (this interpolation is also lazy, but we don't really care that it is)
        const vnid = VNID("_52DMYoaBc3fGp528wZJSFS");
        const name = "Jessie"
        const query = C`MATCH (p:${Person} {id: ${vnid}}) SET p.name = ${name}`;
        assert.equal(query.queryString, "MATCH (p:TestPerson:VNode {id: $p1}) SET p.name = $p2");
        assert.deepEqual(query.params, {
            p1: vnid,
            p2: name,
        });
    });

    test("Interpolates values, if .params are accessed before .queryString", () => {
        const vnid = VNID("_52DMYoaBc3fGp528wZJSFS");
        const name = "Jessie"
        const query = C`MATCH (p:${Person} {id: ${vnid}}) SET p.name = ${name}`;
        assert.deepEqual(query.params, {
            p1: vnid,
            p2: name,
        });
        assert.equal(query.queryString, "MATCH (p:TestPerson:VNode {id: $p1}) SET p.name = $p2");
    });

    test("Interpolates values as-is when C() is explicitly used.", () => {
        const vnid = VNID("_52DMYoaBc3fGp528wZJSFS");
        const label = "SomeLabel";
        const query = C`MATCH (p:${C(label)}:VNode {id: ${vnid}})`;
        assert.equal(query.queryString, "MATCH (p:SomeLabel:VNode {id: $p1})");
        assert.deepEqual(query.params, {p1: vnid});
    });

    test("Interpolates other CypherQuery instances", () => {
        // Construct a MATCH clause without the MATCH keyword:
        const vnid = VNID("_52DMYoaBc3fGp528wZJSFS");
        const matchClause = C`(p:${Person} {id: ${vnid}})`;

        const name = "Alex";
        const outerClause = C`MATCH ${matchClause} SET p.name = ${name}`;
        assert.equal(outerClause.queryString, "MATCH (p:TestPerson:VNode {id: $clause0_p1}) SET p.name = $p1");
        assert.deepEqual(outerClause.params, {clause0_p1: vnid, p1: name});
    });

    test("Convert the special nodeVar HAS KEY $var syntax into appropriate lookups", () => {
        // MATCH clauses can have ", someNodeVariable HAS KEY $param" where $param is a VNID or slugId, and the query
        // will get updated automatically to incorporate the right lookup
        const vnid = VNID("_52DMYoaBc3fGp528wZJSFS");
        const slugId = "jessie"
        const makeQuery = (key: string): CypherQuery => C`
            MATCH (p:${Person})-[:${Person.rel.FRIEND_OF}]-(f:Friend), p HAS KEY ${key}
            RETURN p, f
        `;

        const withVNID = makeQuery(vnid);
        assert.equal(withVNID.queryString, `
            MATCH (p:TestPerson:VNode)-[:FRIEND_OF]-(f:Friend), (p:VNode {id: $p2})
            RETURN p, f
        `);
        assert.deepEqual(withVNID.params, {p2: vnid});

        const withSlugId = makeQuery(slugId);
        assert.equal(withSlugId.queryString, `
            MATCH (p:TestPerson:VNode)-[:FRIEND_OF]-(f:Friend), (p:VNode)<-[:IDENTIFIES]-(:SlugId {slugId: $p2})
            RETURN p, f
        `);
        assert.deepEqual(withSlugId.params, {p2: slugId});
    });

    suite("PROFILE with real data", () => {
        configureTestData({loadTestProjectData: true, isolateTestWrites: false});

        test("HAS KEY lookups by VNID are efficient", async () => {
            // Make sure we're not paying any database lookup performance penalty for using this HAS KEY lookup.
            // First, get the VNID:
            const vnid = (await testGraph.pullOne(Person, p => p.id, {key: "rdj"})).id;
    
            // A query written as efficiently as possible using normal syntax:
            const simpleQuery = C`PROFILE MATCH (person:${Person} {id: ${vnid}}) RETURN person`;
            const simpleResult = await testGraph.read(tx => tx.run(simpleQuery.queryString, simpleQuery.params));
    
            // The same query (VNID lookup) but using HAS KEY:
            const hasKeyQuery = C`PROFILE MATCH (person:${Person}), person HAS KEY ${vnid} RETURN person`;
            const hasKeyResult = await testGraph.read(tx => tx.run(hasKeyQuery.queryString, hasKeyQuery.params));
            
            assert.equal(
                // Make sure the database query complexity is the same:
                sumDbHits(hasKeyResult.summary.profile),
                sumDbHits(simpleResult.summary.profile),
            );
            assert.equal(sumDbHits(hasKeyResult.summary.profile), 8);
        });
    
        test("HAS KEY lookups by slugId are efficient", async () => {
            // Make sure we're not paying any database lookup performance penalty for using this HAS KEY lookup
            const slugId = "rdj";
    
            // A query written as efficiently as possible using normal syntax:
            const simpleQuery = C`PROFILE MATCH (person:${Person})<-[:IDENTIFIES]-(:SlugId {slugId: ${slugId}}) RETURN person LIMIT 1`;
            const simpleResult = await testGraph.read(tx => tx.run(simpleQuery.queryString, simpleQuery.params));
    
            // The same query (SlugId lookup) but using HAS KEY:
            const hasKeyQuery = C`PROFILE MATCH (person:${Person}), person HAS KEY ${slugId} RETURN person`;
            const hasKeyResult = await testGraph.read(tx => tx.run(hasKeyQuery.queryString, hasKeyQuery.params));
            
            assert.equal(
                // Make sure the database query complexity is the same:
                sumDbHits(hasKeyResult.summary.profile),
                sumDbHits(simpleResult.summary.profile),
            );
            assert.equal(sumDbHits(hasKeyResult.summary.profile), 11);  // 11 is the best we can do while supporting lookups on previous slugId values. Lower would be better.
        });
    });

    test("Lets us use .withParams() to add custom parameters", () => {
        // (this interpolation is also lazy, but we don't really care that it is)
        const vnid = VNID("_52DMYoaBc3fGp528wZJSFS");
        const query = C`
            MERGE (p:${Person} {id: ${vnid}})
            SET p.name = $name, p.username = toLower($name)
        `.withParams({name: "Alex"});
        assert.equal(query.queryString, `
            MERGE (p:TestPerson:VNode {id: $p1})
            SET p.name = $name, p.username = toLower($name)
        `);
        assert.deepEqual(query.params, {p1: vnid, name: "Alex"});
    });

    test(".withParams() does not alter the original", () => {
        // (this interpolation is also lazy, but we don't really care that it is)
        const baseQuery = C`MATCH (p:${Person} {id: $vnid})`;
        const q1 = baseQuery.withParams({id: VNID("_1111111111111111111111")});
        const q2 = baseQuery.withParams({id: VNID("_2222222222222222222222")});
        assert.deepEqual(q1.params, {id: VNID("_1111111111111111111111")});
        assert.deepEqual(q2.params, {id: VNID("_2222222222222222222222")});
        // Now compile baseQuery then call withParams, to make sure withParams works on a compiled query:
        assert.isFalse(baseQuery.isCompiled);
        assert.isEmpty(baseQuery.params);
        assert.isTrue(baseQuery.isCompiled);
        const q3 = baseQuery.withParams({id: VNID("_3333333333333333333333")});
        assert.deepEqual(q3.params, {id: VNID("_3333333333333333333333")});
    });

    test("Lets us use HAS KEY and .withParams() with no auto-parameters", () => {
        // This tests an edge case where a string with no interpolations still needs the HAS KEY substitution, which
        // must also means that the param must be added before the query is compiled (compilation of HAS KEY requires
        // the param value to be known, to know if it's a VNID or slugId)
        const query = C`MATCH (vn:VNode), vn HAS KEY $customKeyArg`.withParams({customKeyArg: VNID("_1111111111111111111111")});
        assert.equal(query.queryString, `MATCH (vn:VNode), (vn:VNode {id: $customKeyArg})`);
        assert.deepEqual(query.params, {customKeyArg: VNID("_1111111111111111111111")});
    });

    test("C() can be used directly", () => {
        // If someone doesn't like the C`...` tagged template literal helper, it can always
        // be used to directly construct a query string, and params passed in via .withParams()
        const query = C("MATCH (vn:VNode), vn HAS KEY $customKeyArg").withParams({
            customKeyArg: VNID("_1111111111111111111111"),
        });
        assert.equal(query.queryString, `MATCH (vn:VNode), (vn:VNode {id: $customKeyArg})`);
        assert.deepEqual(query.params, {customKeyArg: VNID("_1111111111111111111111")});
    });

    test("C.int() can be used to force a value to use the Neo4j Integer type", async () => {
        // JavaScript doesn't distinguish between integers and floats.
        // The JavaScript driver for Neo4j will treat all Numbers as floats.
        // If one wants to save a number as an Integer explicitly, use C.int()
        const numValue = 15;

        const defaultQuery = C`RETURN apoc.meta.type(${numValue}) AS numberType`;
        const defaultResult = await testGraph.read(tx => tx.run(defaultQuery.queryString, defaultQuery.params));
        assert.equal(defaultResult.records[0].get("numberType"), "FLOAT");

        const intQuery = C`RETURN apoc.meta.type(${C.int(numValue)}) AS numberType`;
        const intResult = await testGraph.read(tx => tx.run(intQuery.queryString, intQuery.params));
        assert.equal(intResult.records[0].get("numberType"), "INTEGER");
    });

    test("CypherQuery throws an error if passed invalid arguments", () => {
        assert.throws(() => {
            new CypherQuery(["one string"], ["two", "args"]);
        }, "expected params array to have length 1 less than strings array");
    });

    test("throws an error if passed multiple values for the same argument", () => {
        assert.throws(() => {
            C`MATCH (p:${Person})`.withParams({foo: "bar"}).withParams({foo: "other"});
        }, `Multiple values for query parameter "foo"`);
    });

    test("throws an error if using HAS KEY without a parameter", () => {
        assert.throws(() => {
            C`MATCH (p:${Person}), p HAS KEY $something`.queryString;
        }, `Expected a "something" parameter in the query for the p HAS KEY $something lookup.`);
    });

    suite("return shape", () => {

        test(".givesShape() can store a return shape", () => {
            const baseQuery = C`MATCH (p:${Person}) RETURN p.id`;

            const withReturnShape = baseQuery.givesShape({"p.id": "vnid"});

            assert.deepStrictEqual(withReturnShape.returnShape, {"p.id": "vnid"});
        });

        test(".RETURN() can store a return shape and generate the RETURN clause", () => {
            const query = C`MATCH (p:${Person})`.RETURN({"p.id": "vnid", "p.name": "string"});

            assert.equal(query.queryString, "MATCH (p:TestPerson:VNode)\nRETURN p.id, p.name");
            assert.deepStrictEqual(query.returnShape, {"p.id": "vnid", "p.name": "string"});
        });

        test(".RETURN({}) generates a RETURN null clause and an empty return shape", () => {
            const query = C`MATCH (p:${Person})`.RETURN({});

            assert.equal(query.queryString, "MATCH (p:TestPerson:VNode)\nRETURN null");
            assert.deepStrictEqual(query.returnShape, {});
        });
    });
});
