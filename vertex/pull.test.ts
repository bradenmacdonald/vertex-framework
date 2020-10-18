import { suite, test, assert, dedent } from "./lib/intern-tests";

import { buildCypherQuery, DataRequestFilter, VNodeDataRequest } from "./pull";
import { checkType, AssertEqual, AssertPropertyAbsent, AssertPropertyPresent, AssertPropertyOptional } from "./lib/ts-utils";
import { Person } from "./test-project/Person";
import { Movie } from "./test-project/Movie";
import { testGraph } from "./test-project/graph";
import { UUID } from "./lib/uuid";

// Data for use in tests ///////////////////////////////////////////////////////////////////////////////////////////////

suite("pull", () => {
    suite("simple queries", () => {

        suite("Person allProps request (no filter - get all people)", () => {
            const request = VNodeDataRequest(Person).allProps;
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request);

                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson)
                    
                    RETURN _node.uuid AS uuid, _node.shortId AS shortId, _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                `);
            });
            test("pull", async () => {
                const people = await testGraph.pull(request);
        
                // Note: request should be sorted by name by default, so Chris Pratt comes first
                const firstPerson = people[0];
                assert.typeOf(firstPerson.uuid, "string")
                assert.equal(firstPerson.shortId, "chris-pratt");
                assert.equal(firstPerson.name, "Chris Pratt");
                assert.equal(firstPerson.dateOfBirth, "1979-06-21");
                checkType<AssertPropertyPresent<typeof firstPerson, "uuid", UUID>>();
                checkType<AssertPropertyPresent<typeof firstPerson, "shortId", string>>();
                checkType<AssertPropertyPresent<typeof firstPerson, "name", string>>();
                checkType<AssertPropertyPresent<typeof firstPerson, "dateOfBirth", string>>();
            });
        });

        suite("Partial Person request", () => {
            // This data request tests conditional fields and excluded fields
            const partialPersonRequest = (VNodeDataRequest(Person)
                .name
                .dateOfBirthIfFlag("includeDOB")
            );
            test("buildCypherQuery - get all, DOB flag off", () => {
                const query = buildCypherQuery(partialPersonRequest);
                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson)
                    
                    RETURN _node.name AS name ORDER BY _node.name
                `);
            });
            test("buildCypherQuery - get all, DOB flag on", () => {
                const query = buildCypherQuery(partialPersonRequest, {flags: ["includeDOB"]});
                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson)
                    
                    RETURN _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                `);
            });
            test("pull - get all, DOB flag off", async () => {
                const people = await testGraph.pull(partialPersonRequest);

                // Note: request should be sorted by name by default, so Chris Pratt comes first
                const firstPerson = people[0];
                assert.equal(firstPerson.name, "Chris Pratt");
                checkType<AssertPropertyPresent<typeof firstPerson, "name", string>>();
                // dateOfBirth was not requested due to the missing flag (only known at runtime, not compile time)
                assert.equal(firstPerson.dateOfBirth, undefined);
                checkType<AssertPropertyOptional<typeof firstPerson, "dateOfBirth", string>>();
                // UUID was explicitly not requested, so should be undefined:
                assert.equal((firstPerson as any).uuid, undefined);
                checkType<AssertPropertyAbsent<typeof firstPerson, "uuid">>();
            });
            test("pull - get all, DOB flag on", async () => {
                const people = await testGraph.pull(partialPersonRequest, {flags: ["includeDOB"]});
        
                // Note: request should be sorted by name by default, so Chris Pratt comes first
                const firstPerson = people[0];
                assert.equal(firstPerson.name, "Chris Pratt");
                checkType<AssertPropertyPresent<typeof firstPerson, "name", string>>();
                // dateOfBirth was requested using a flag (only known at runtime, not compile time)
                assert.equal(firstPerson.dateOfBirth, "1979-06-21");
                checkType<AssertPropertyOptional<typeof firstPerson, "dateOfBirth", string>>();
                // UUID was explicitly not requested, so should be undefined:
                assert.equal((firstPerson as any).uuid, undefined);
                checkType<AssertPropertyAbsent<typeof firstPerson, "uuid">>();
            });
            test("pull - with name filter", async () => {
                const people = await testGraph.pull(partialPersonRequest, {
                    where: "@.name STARTS WITH $nameStart",
                    params: {nameStart: "Ka"},
                });

                assert.equal(people[0].name, "Karen Gillan");
                assert.equal(people[1].name, "Kate McKinnon");
            });
            test("Partial Person request with sorting (oldest first)", async () => {
                const peopleOldestFirst = await testGraph.pull(partialPersonRequest, {
                    orderBy: "dateOfBirth",
                    // Test ordering by a field that's not included in the response.
                });
                assert.equal(peopleOldestFirst[0].name, "Robert Downey Jr.");
                assert.equal(peopleOldestFirst[0].dateOfBirth, undefined);  // Disabled by lack of flag
            });
            test("Partial Person request with sorting (youngest first)", async () => {
                const peopleYoungestFirst = await testGraph.pull(partialPersonRequest, {
                    orderBy: "dateOfBirth DESC",
                    flags: ["includeDOB"],
                });
                assert.equal(peopleYoungestFirst[0].name, "Karen Gillan");
                assert.equal(peopleYoungestFirst[0].dateOfBirth, "1987-11-28");
            });
        });

        suite("Basic Person request", () => {
            // This DataRequest gets some raw properties of Person, with no virtual properties
            const basicPersonRequest = (VNodeDataRequest(Person)
                .uuid
                .name
                .dateOfBirth
            );
            test("buildCypherQuery - match by UUID", () => {
                const query = buildCypherQuery(basicPersonRequest, {key: "00000000-0000-0000-0000-000000001234"});

                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson {uuid: $_nodeUuid})
                    
                    RETURN _node.uuid AS uuid, _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                `);
                assert.equal(query.params._nodeUuid, "00000000-0000-0000-0000-000000001234");
            });
            test("buildCypherQuery - matching with WHERE filter", () => {
                const query = buildCypherQuery(basicPersonRequest, {where: "@.name = $nameMatch", params: {nameMatch: "Dwayne Johnson"}});

                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson)
                    WHERE _node.name = $nameMatch
                    
                    RETURN _node.uuid AS uuid, _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                `);
                assert.equal(query.params.nameMatch, "Dwayne Johnson");
            });
        });

        suite("Movie request, keyed by shortId", () => {
            const request = VNodeDataRequest(Movie).shortId.title.year;
            const filter: DataRequestFilter = {key: "jumanji-2"};
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request, filter);
                assert.equal(query.query, dedent`
                    MATCH (_node:TestMovie)<-[:IDENTIFIES]-(:ShortId {path: "TestMovie/" + $_nodeShortid})
                    
                    RETURN _node.shortId AS shortId, _node.title AS title, _node.year AS year ORDER BY _node.year DESC
                `);
                assert.equal(query.params._nodeShortid, "jumanji-2");
            });
            test("pull", async () => {
                const result = await testGraph.pullOne(request, filter);
                assert.equal(result.title, "Jumanji: The Next Level");
                checkType<AssertPropertyPresent<typeof result, "title", string>>();
                assert.equal(result.year, 2019);
                checkType<AssertPropertyPresent<typeof result, "year", number>>();
            });
        });
    });

    suite("Queries including virtual properties", () => {

        suite("Get all Chris Pratt Movies", () => {
            const request = VNodeDataRequest(Person).movies(m => m.title.year);
            const filter: DataRequestFilter = {key: "chris-pratt", };
            test("buildCypherQuery", () => {
                // This test covers the situation where we're not including any raw (non-virtual) properties from the main node (_node)
                const query = buildCypherQuery(request, filter);
                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson)<-[:IDENTIFIES]-(:ShortId {path: "TestPerson/" + $_nodeShortid})

                    OPTIONAL MATCH (_node)-[:ACTED_IN]->(_movie1:TestMovie)
                    WITH _node, _movie1 ORDER BY _movie1.year DESC
                    WITH _node, collect(_movie1 {.title, .year}) AS movies

                    RETURN movies ORDER BY _node.name
                `);
                assert.equal(query.params._nodeShortid, "chris-pratt");
            });
            test("pull", async () => {
                // This test covers the situation where we're not including any raw (non-virtual) properties from the main node (_node)
                const chrisPratt = await testGraph.pullOne(request, filter);
                assert.equal(chrisPratt.movies.length, 3);
                // Movies should be sorted newest first by default, so the first movie should be the newest one:
                const firstTitle = chrisPratt.movies[0].title;
                assert.equal(firstTitle, "Avengers: Infinity War");
                checkType<AssertEqual<typeof firstTitle, string>>();
            });
            test("pull - alternate syntax", async () => {
                const chrisPratt = await testGraph.pullOne(Person, p => p
                    .name
                    .movies(m => m.shortId.title),
                    filter,
                );
                assert.equal(chrisPratt.name, "Chris Pratt");
                assert.equal(chrisPratt.movies.length, 3);
                // Movies should be sorted newest first by default, so the first movie should be the newest one:
                const firstTitle = chrisPratt.movies[0].title;
                assert.equal(firstTitle, "Avengers: Infinity War");
                checkType<AssertEqual<typeof firstTitle, string>>();
            });
        });
    });
});
