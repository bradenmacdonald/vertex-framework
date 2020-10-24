import { suite, test, assert } from "./lib/intern-tests";
import { C, CypherQuery, UUID } from "./";
import { Person } from "./test-project/Person";
import { testGraph } from "./test-project/graph";
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
        const query = C`MATCH (p:${Person}) RETURN p.uuid`;
        assert.isFalse(query.isCompiled);
        assert.equal(query.queryString, "MATCH (p:TestPerson:VNode) RETURN p.uuid");
        assert.isTrue(query.isCompiled);
        assert.isEmpty(query.params);
    });

    test("Doesn't interpolate a VNodeType as a value", () => {
        const query = C`MATCH (p:VNode) SET p.someField = ${Person} RETURN p.uuid`;
        assert.throws(() => query.queryString, "Interpolating a VNodeType into a string is only supported for matching labels");
    });

    test("Interpolates values", () => {
        // (this interpolation is also lazy, but we don't really care that it is)
        const uuid = UUID("4f33680a-d7a8-4a9f-8d50-4c40fc05997f");
        const name = "Jessie"
        const query = C`MATCH (p:${Person} {uuid: ${uuid}}) SET p.name = ${name}`;
        assert.equal(query.queryString, "MATCH (p:TestPerson:VNode {uuid: $p1}) SET p.name = $p2");
        assert.deepEqual(query.params, {
            p1: uuid,
            p2: name,
        });
    });

    test("Interpolates values, if .params are accessed before .queryString", () => {
        const uuid = UUID("4f33680a-d7a8-4a9f-8d50-4c40fc05997f");
        const name = "Jessie"
        const query = C`MATCH (p:${Person} {uuid: ${uuid}}) SET p.name = ${name}`;
        assert.deepEqual(query.params, {
            p1: uuid,
            p2: name,
        });
        assert.equal(query.queryString, "MATCH (p:TestPerson:VNode {uuid: $p1}) SET p.name = $p2");
    });

    test("Interpolates values as-is when C.raw() is explicitly used.", () => {
        const uuid = UUID("4f33680a-d7a8-4a9f-8d50-4c40fc05997f");
        const label = "SomeLabel";
        const query = C`MATCH (p:${C.raw(label)}:VNode {uuid: ${uuid}})`;
        assert.equal(query.queryString, "MATCH (p:SomeLabel:VNode {uuid: $p1})");
        assert.deepEqual(query.params, {p1: uuid});
    });

    test("Interpolates other CypherQuery instances", () => {
        // Construct a MATCH clause without the MATCH keyword:
        const uuid = UUID("4f33680a-d7a8-4a9f-8d50-4c40fc05997f");
        const matchClause = C`(p:${Person} {uuid: ${uuid}})`;

        const name = "Alex";
        const outerClause = C`MATCH ${matchClause} SET p.name = ${name}`;
        assert.equal(outerClause.queryString, "MATCH (p:TestPerson:VNode {uuid: $clause0_p1}) SET p.name = $p1");
        assert.deepEqual(outerClause.params, {clause0_p1: uuid, p1: name});
    });

    test("Convert the special nodeVar HAS KEY $var syntax into appropriate lookups", () => {
        // MATCH clauses can have ", someNodeVariable HAS KEY $param" where $param is a UUID or shortId, and the query
        // will get updated automatically to incorporate the right lookup
        const uuid = UUID("4f33680a-d7a8-4a9f-8d50-4c40fc05997f");
        const shortId = "jessie"
        const makeQuery = (key: string): CypherQuery => C`
            MATCH (p:${Person})-[:FRIEND_OF]-(f:Friend), p HAS KEY ${key}
            RETURN p, f
        `;

        const withUuid = makeQuery(uuid);
        assert.equal(withUuid.queryString, `
            MATCH (p:TestPerson:VNode)-[:FRIEND_OF]-(f:Friend), (p:VNode {uuid: $p1})
            RETURN p, f
        `);
        assert.deepEqual(withUuid.params, {p1: uuid});

        const withShortId = makeQuery(shortId);
        assert.equal(withShortId.queryString, `
            MATCH (p:TestPerson:VNode)-[:FRIEND_OF]-(f:Friend), (p:VNode)<-[:IDENTIFIES]-(:ShortId {shortId: $p1})
            RETURN p, f
        `);
        assert.deepEqual(withShortId.params, {p1: shortId});
    });

    test("HAS KEY lookups by UUID are efficient", async () => {
        // Make sure we're not paying any database lookup performance penalty for using this HAS KEY lookup
        const uuid = (await testGraph.pullOne(Person, p => p.uuid, {key: "rdj"})).uuid;

        // A query written as efficiently as possible using normal syntax:
        const simpleQuery = C`PROFILE MATCH (person:${Person} {uuid: ${uuid}}) RETURN person`;
        const simpleResult = await testGraph.read(tx => tx.run(simpleQuery.queryString, simpleQuery.params));

        // The same query (UUID lookup) but using HAS KEY:
        const hasKeyQuery = C`PROFILE MATCH (person:${Person}), person HAS KEY ${uuid} RETURN person`;
        const hasKeyResult = await testGraph.read(tx => tx.run(hasKeyQuery.queryString, hasKeyQuery.params));
        
        assert.equal(
            // Make sure the database query complexity is the same:
            sumDbHits(hasKeyResult.summary.profile),
            sumDbHits(simpleResult.summary.profile),
        );
        assert.equal(sumDbHits(hasKeyResult.summary.profile), 3);
    });

    test("HAS KEY lookups by shortId are efficient", async () => {
        // Make sure we're not paying any database lookup performance penalty for using this HAS KEY lookup
        const shortId = "rdj";

        // A query written as efficiently as possible using normal syntax:
        const simpleQuery = C`PROFILE MATCH (person:${Person})<-[:IDENTIFIES]-(:ShortId {shortId: ${shortId}}) RETURN person LIMIT 1`;
        const simpleResult = await testGraph.read(tx => tx.run(simpleQuery.queryString, simpleQuery.params));

        // The same query (UUID lookup) but using HAS KEY:
        const hasKeyQuery = C`PROFILE MATCH (person:${Person}), person HAS KEY ${shortId} RETURN person`;
        const hasKeyResult = await testGraph.read(tx => tx.run(hasKeyQuery.queryString, hasKeyQuery.params));
        
        assert.equal(
            // Make sure the database query complexity is the same:
            sumDbHits(hasKeyResult.summary.profile),
            sumDbHits(simpleResult.summary.profile),
        );
        assert.equal(sumDbHits(hasKeyResult.summary.profile), 6);  // 6 is the best we can do while supporting lookups on previous shortId values. Lower would be better.
    });

    test("Lets us use .withParams() to add custom parameters", () => {
        // (this interpolation is also lazy, but we don't really care that it is)
        const uuid = UUID("4f33680a-d7a8-4a9f-8d50-4c40fc05997f");
        const query = C`
            MERGE (p:${Person} {uuid: ${uuid}})
            SET p.name = $name, p.username = toLower($name)
        `.withParams({name: "Alex"});
        assert.equal(query.queryString, `
            MERGE (p:TestPerson:VNode {uuid: $p1})
            SET p.name = $name, p.username = toLower($name)
        `);
        assert.deepEqual(query.params, {p1: uuid, name: "Alex"});
    });

    test(".withParams() does not alter the original", () => {
        // (this interpolation is also lazy, but we don't really care that it is)
        const baseQuery = C`MATCH (p:${Person} {uuid: $uuid})`;
        const q1 = baseQuery.withParams({uuid: UUID("11111111-1111-1111-1111-111111111111")});
        const q2 = baseQuery.withParams({uuid: UUID("22222222-2222-2222-2222-222222222222")});
        assert.deepEqual(q1.params, {uuid: UUID("11111111-1111-1111-1111-111111111111")});
        assert.deepEqual(q2.params, {uuid: UUID("22222222-2222-2222-2222-222222222222")});
        // Now compile baseQuery then call withParams, to make sure withParams works on a compiled query:
        assert.isFalse(baseQuery.isCompiled);
        assert.isEmpty(baseQuery.params);
        assert.isTrue(baseQuery.isCompiled);
        const q3 = baseQuery.withParams({uuid: UUID("33333333-3333-3333-3333-333333333333")});
        assert.deepEqual(q3.params, {uuid: UUID("33333333-3333-3333-3333-333333333333")});
    });

    test("Lets us use HAS KEY and .withParams() with no auto-parameters", () => {
        // This tests an edge case where a string with no interpolations still needs the HAS KEY substitution, which
        // must also means that the param must be added before the query is compiled (compilation of HAS KEY requires
        // the param value to be known, to know if it's a UUID or shortId)
        const query = C`MATCH (vn:VNode), vn HAS KEY $customKeyArg`.withParams({customKeyArg: UUID("11111111-1111-1111-1111-111111111111")});
        assert.equal(query.queryString, `MATCH (vn:VNode), (vn:VNode {uuid: $customKeyArg})`);
        assert.deepEqual(query.params, {customKeyArg: UUID("11111111-1111-1111-1111-111111111111")});
    });

    test("C() can be used directly", () => {
        // If someone doesn't like the C`...` tagged template literal helper, it can always
        // be used to directly construct a query string, and params passed in via .withParams()
        const query = C("MATCH (vn:VNode), vn HAS KEY $customKeyArg").withParams({
            customKeyArg: UUID("11111111-1111-1111-1111-111111111111"),
        });
        assert.equal(query.queryString, `MATCH (vn:VNode), (vn:VNode {uuid: $customKeyArg})`);
        assert.deepEqual(query.params, {customKeyArg: UUID("11111111-1111-1111-1111-111111111111")});
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
});
