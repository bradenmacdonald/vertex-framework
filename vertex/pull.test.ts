import { registerSuite, assert, dedent } from "./lib/intern-tests";

import { buildCypherQuery, DataRequest, pull } from "./pull";
import { AssertEqual, AssertNotEqual } from "./lib/ts-utils";
import { Person } from "./test-project/Person";
import { Movie } from "./test-project/Movie";
import { testGraph } from "./test-project/graph";

// Compile time tests. /////////////////////////////////////////////////////////////////////////////////////////////////
// These are just checking the TypeScript type inference

// This DataRequest gets the raw properties of Person, with no virtual properties
const basicPersonRequest = DataRequest(Person, {uuid: true, name: true, dateOfBirth: true});
const checkBPR: {
    uuid: true,
    name: true,
    dateOfBirth: true,
} = basicPersonRequest;
const checkBRR2: AssertEqual<typeof basicPersonRequest.uuid, true> = true;

// This DataRequest tests typing of conditional fields and excluded fields
const maybe: boolean = ("yes".indexOf("y") === 0) ? true : false;
const partialPersonRequest = DataRequest(Person, {uuid: false, name: true, dateOfBirth: maybe});
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

// Runtime tests. /////////////////////////////////////////////////////////////////////////////////////////////////
registerSuite("buildCypherQuery", {
    tests: {
        "Queries with requested raw properties: Partial Person request with no filter (get all people)"() {
            const query = buildCypherQuery(partialPersonRequest);

            assert.equal(query.query, dedent`
                MATCH (_node:TestPerson)
                
                RETURN _node.name AS name, _node.dateOfBirth AS dateOfBirth
            `);
        },

        "Queries with requested raw properties: Basic Person request matching by UUID"() {
            const query = buildCypherQuery(basicPersonRequest, {key: "00000000-0000-0000-0000-000000001234"});

            assert.equal(query.query, dedent`
                MATCH (_node:TestPerson {uuid: $_nodeUuid})
                
                RETURN _node.uuid AS uuid, _node.name AS name, _node.dateOfBirth AS dateOfBirth
            `);
            assert.equal(query.params._nodeUuid, "00000000-0000-0000-0000-000000001234");
        },

        "Queries with requested raw properties: Movie request, keyed by shortId"() {
            const query = buildCypherQuery(DataRequest(Movie, {shortId: true, title: true, year: true}), {key: "jumanji-2"});
            assert.equal(query.query, dedent`
                MATCH (_node:TestMovie)<-[:IDENTIFIES]-(:ShortId {path: "TestMovie/" + $_nodeShortid})
                
                RETURN _node.shortId AS shortId, _node.title AS title, _node.year AS year
            `);
            assert.equal(query.params._nodeShortid, "jumanji-2");
        },

        "Queries with requested raw properties: Basic Person request matching with WHERE filter"() {
            const query = buildCypherQuery(basicPersonRequest, {where: "@.name = $nameMatch", params: {nameMatch: "Dwayne Johnson"}});

            assert.equal(query.query, dedent`
                MATCH (_node:TestPerson)
                WHERE _node.name = $nameMatch
                
                RETURN _node.uuid AS uuid, _node.name AS name, _node.dateOfBirth AS dateOfBirth
            `);
            assert.equal(query.params.nameMatch, "Dwayne Johnson");
        },
    },
});

registerSuite("pull", {
    tests: {
        async "Queries with requested raw properties: Partial Person request with no filter (get all people)"() {
            const people = await testGraph.pull(partialPersonRequest);

            assert.equal(people.length, 3);
            // TODO: database-level ordering
            people.sort((a, b) => a.name.localeCompare(b.name));
            assert.equal(people[0].name, "Chris Pratt");
            assert.equal(people[0].dateOfBirth, "1979-06-21");
            assert.equal(people[0].uuid, undefined);  // UUID was not requested
        },

    },
});

