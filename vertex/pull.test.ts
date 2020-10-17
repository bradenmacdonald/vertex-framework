import { registerSuite, assert, dedent } from "./lib/intern-tests";

import { buildCypherQuery, DataRequest, NewDataRequest, pull } from "./pull";
import { AssertEqual, AssertNotEqual } from "./lib/ts-utils";
import { Person } from "./test-project/Person";
import { Movie } from "./test-project/Movie";
import { testGraph } from "./test-project/graph";

// Data for use in tests ///////////////////////////////////////////////////////////////////////////////////////////////

// This DataRequest gets the raw properties of Person, with no virtual properties
const basicPersonRequest = DataRequest(Person, {uuid: true, name: true, dateOfBirth: true});

// This DataRequest tests conditional fields and excluded fields
const maybe: boolean = ("yes".indexOf("y") === 0) ? true : false;
const partialPersonRequest = DataRequest(Person, {uuid: false, name: true, dateOfBirth: maybe});

registerSuite("pull", {
    "DataRequest - static typing": { // These are transpile-time tests; they check static typing, not code.
        "basicPersonRequest": {
            tests: {
                "DataRequest helper returns a fully typed data request"() {
                    const checkBPR: {
                        uuid: true,
                        name: true,
                        dateOfBirth: true,
                    } = basicPersonRequest;
                    const checkBRR2: AssertEqual<typeof basicPersonRequest.uuid, true> = true;
                },
            },
        },

        "partialPersonRequest": {
            tests: {
                "DataRequest helper returns a fully typed data request"() {
                    const checkPPR: {
                        uuid: false,
                        name: true,
                        dateOfBirth: boolean,
                    } = partialPersonRequest;
                    // If a requested field like "uuid" is set to 'true' or 'false' (not an unknown boolean value), it should be typed that way:
                    const checkPRR: AssertEqual<typeof partialPersonRequest.uuid, false> = true;
                    const checkPRR2: AssertNotEqual<typeof partialPersonRequest.uuid, true> = true;
                    const checkPRR3: AssertEqual<typeof partialPersonRequest.name, true> = true;
                    const checkPRR4: AssertNotEqual<typeof partialPersonRequest.name, false> = true;
                    // Whereas if a requested field is set to some value not known until runtime, it should be typed as 'boolean':
                    const checkPRR5: AssertEqual<typeof partialPersonRequest.name, boolean> = true;
                },
            },
        },
    },
    "buildCypherQuery": {
        "Queries with requested raw properties": {
            tests: {
                "Partial Person request with no filter (get all people)"() {
                    const query = buildCypherQuery(partialPersonRequest);

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
                    const query = buildCypherQuery(DataRequest(Movie, {shortId: true, title: true, year: true}), {key: "jumanji-2"});
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
                    const query = await buildCypherQuery(DataRequest(Person, {movies: {title: true, year: true}}), {
                        key: "chris-pratt",
                    });
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
                async "Partial Person request with no filter (get all people)"() {
                    const people = await testGraph.pull(partialPersonRequest);
        
                    // Note: request should be sorted by name by default, so Chris Pratt comes first
                    const firstPerson = people[0];
                    assert.equal(firstPerson.name, "Chris Pratt");
                    const checkNameType: AssertEqual<typeof firstPerson.name, string> = true;
                    // dateOfBirth was "maybe" requested (only known at runtime, not compile time)
                    assert.equal(firstPerson.dateOfBirth, "1979-06-21");
                    const checkDOBType: AssertEqual<typeof firstPerson.dateOfBirth, string|undefined> = true; // Note: this assertion isn't really working
                    // UUID was explicitly not requested, so should be undefined:
                    assert.equal(firstPerson.uuid, undefined);
                    const checkUuidType: AssertEqual<typeof firstPerson.uuid, undefined> = true;
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
                        orderBy: "dateOfBirth"
                    });

                    assert.equal(peopleOldestFirst[0].name, "Robert Downey Jr.");
                    assert.equal(peopleOldestFirst[0].dateOfBirth, "1965-04-04");
                    
                    const peopleYoungestFirst = await testGraph.pull(partialPersonRequest, {
                        orderBy: "dateOfBirth DESC"
                    });
                    
                    assert.equal(peopleYoungestFirst[0].name, "Karen Gillan");
                    assert.equal(peopleYoungestFirst[0].dateOfBirth, "1987-11-28");
                },

            },
        },
        "Queries including virtual properties": {
            tests: {
                async "Get all Chris Pratt Movies"() {
                    const chrisPratt = await testGraph.pullOne(DataRequest(Person, {
                        name: true,
                        movies: {
                            shortId: true as const,
                            title: true as const,
                            //year: true,
                        },
                    }), {
                        key: "chris-pratt",
                    });

                    const test = (NewDataRequest(Person)
                        .name
                        .dateOfBirthIfFlag("testeroni")
                        .movies(m => m.title.year, {ifFlag: "test2"})
                        .friends(f => f.allProps)
                    );
                    const otherTest = NewDataRequest(Person).allProps;

                    assert.equal(chrisPratt.name, "Chris Pratt");
                    assert.equal(chrisPratt.movies.length, 3);
                    const firstTitle = chrisPratt.movies[0].title;
                    // TODO: check actual titles etc. once sorting is added.
                    assert.equal(firstTitle, "string");
                    const checkTitleType: AssertEqual<typeof firstTitle, string> = true;
                },
            },
        },
    },
});
