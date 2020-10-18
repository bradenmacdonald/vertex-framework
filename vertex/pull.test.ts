import { registerSuite, assert, dedent } from "./lib/intern-tests";

import { buildCypherQuery, VNodeDataRequest } from "./pull";
import { checkType, AssertEqual, AssertPropertyAbsent, AssertPropertyPresent, AssertPropertyOptional } from "./lib/ts-utils";
import { Person } from "./test-project/Person";
import { Movie } from "./test-project/Movie";
import { testGraph } from "./test-project/graph";
import { UUID } from "./lib/uuid";

// Data for use in tests ///////////////////////////////////////////////////////////////////////////////////////////////

// This DataRequest gets some raw properties of Person, with no virtual properties
const basicPersonRequest = (VNodeDataRequest(Person)
    .uuid
    .name
    .dateOfBirth
);

// This DataRequest tests conditional fields and excluded fields
const partialPersonRequest = (VNodeDataRequest(Person)
    .name
    .dateOfBirthIfFlag("includeDOB")
);

registerSuite("pull", {
    "buildCypherQuery": {
        "Queries with requested raw properties": {
            tests: {
                "Person allProps request with no filter (get all people)"() {
                    const query = buildCypherQuery(VNodeDataRequest(Person).allProps);

                    assert.equal(query.query, dedent`
                        MATCH (_node:TestPerson)
                        
                        RETURN _node.uuid AS uuid, _node.shortId AS shortId, _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                    `);
                },

                "Partial Person request with no filter (get all people, DOB flag off)"() {
                    const query = buildCypherQuery(partialPersonRequest);

                    assert.equal(query.query, dedent`
                        MATCH (_node:TestPerson)
                        
                        RETURN _node.name AS name ORDER BY _node.name
                    `);
                },

                "Partial Person request with no filter (get all people, DOB flag on)"() {
                    const query = buildCypherQuery(partialPersonRequest, {flags: ["includeDOB"]});

                    assert.equal(query.query, dedent`
                        MATCH (_node:TestPerson)
                        
                        RETURN _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                    `);
                },

                "Basic Person request matching by UUID"() {
                    const query = buildCypherQuery(basicPersonRequest, {key: "00000000-0000-0000-0000-000000001234"});

                    assert.equal(query.query, dedent`
                        MATCH (_node:TestPerson {uuid: $_nodeUuid})
                        
                        RETURN _node.uuid AS uuid, _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                    `);
                    assert.equal(query.params._nodeUuid, "00000000-0000-0000-0000-000000001234");
                },

                "Movie request, keyed by shortId"() {
                    const query = buildCypherQuery(VNodeDataRequest(Movie).shortId.title.year, {key: "jumanji-2"});
                    assert.equal(query.query, dedent`
                        MATCH (_node:TestMovie)<-[:IDENTIFIES]-(:ShortId {path: "TestMovie/" + $_nodeShortid})
                        
                        RETURN _node.shortId AS shortId, _node.title AS title, _node.year AS year ORDER BY _node.year DESC
                    `);
                    assert.equal(query.params._nodeShortid, "jumanji-2");
                },

                "Basic Person request matching with WHERE filter"() {
                    const query = buildCypherQuery(basicPersonRequest, {where: "@.name = $nameMatch", params: {nameMatch: "Dwayne Johnson"}});

                    assert.equal(query.query, dedent`
                        MATCH (_node:TestPerson)
                        WHERE _node.name = $nameMatch
                        
                        RETURN _node.uuid AS uuid, _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                    `);
                    assert.equal(query.params.nameMatch, "Dwayne Johnson");
                },
            },
        },
        "Queries including virtual properties": {
            tests: {
                async "Get all Chris Pratt Movies"() {
                    const query = await buildCypherQuery(
                        VNodeDataRequest(Person).movies(m => m.title.year),
                        {key: "chris-pratt", }
                    );
                    assert.equal(query.query, dedent`
                        MATCH (_node:TestPerson)<-[:IDENTIFIES]-(:ShortId {path: "TestPerson/" + $_nodeShortid})

                        OPTIONAL MATCH (_node)-[:ACTED_IN]->(_movie1:TestMovie)
                        WITH _node, collect(_movie1 {.title, .year}) AS movies

                        RETURN movies ORDER BY _node.name
                    `);
                    assert.equal(query.params._nodeShortid, "chris-pratt");
                },

            },
        },
    },
    "pull": {
        "Queries with raw properties": {
            tests: {
                async "Person allProps request with no filter (get all people)"() {
                    const people = await testGraph.pull(Person, p => p.allProps);
        
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
                },

                async "Partial Person request with no filter (get all people, DOB flag off)"() {
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
                },

                async "Partial Person request with no filter (get all people, DOB flag on)"() {
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
                },

                async "Partial Person request with name filter"() {
                    const people = await testGraph.pull(partialPersonRequest, {
                        where: "@.name STARTS WITH $nameStart",
                        params: {nameStart: "Ka"},
                    });

                    assert.equal(people[0].name, "Karen Gillan");
                    assert.equal(people[1].name, "Kate McKinnon");
                },

                async "Partial Person request with sorting"() {
                    const peopleOldestFirst = await testGraph.pull(partialPersonRequest, {
                        orderBy: "dateOfBirth",
                        // Test ordering by a field that's not included.
                    });

                    assert.equal(peopleOldestFirst[0].name, "Robert Downey Jr.");
                    assert.equal(peopleOldestFirst[0].dateOfBirth, undefined);  // Disabled by lack of flag
                    
                    const peopleYoungestFirst = await testGraph.pull(partialPersonRequest, {
                        orderBy: "dateOfBirth DESC",
                        flags: ["includeDOB"],
                    });
                    
                    assert.equal(peopleYoungestFirst[0].name, "Karen Gillan");
                    assert.equal(peopleYoungestFirst[0].dateOfBirth, "1987-11-28");
                },

            },
        },
        "Queries including virtual properties": {
            tests: {
                async "Get all Chris Pratt Movies"() {
                    const chrisPratt = await testGraph.pullOne(
                        VNodeDataRequest(Person).name.movies(m => m.shortId.title),
                        {key: "chris-pratt"},
                    );

                    assert.equal(chrisPratt.name, "Chris Pratt");
                    assert.equal(chrisPratt.movies.length, 3);
                    const firstTitle = chrisPratt.movies[0].title;
                    // TODO: check actual titles etc. once sorting is added.
                    assert.equal(typeof firstTitle, "string");
                    checkType<AssertEqual<typeof firstTitle, string>>();
                },
            },
        },
    },
});
