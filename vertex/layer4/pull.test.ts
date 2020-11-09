import { suite, test, assert, dedent, configureTestData } from "../lib/intern-tests";

import { buildCypherQuery, DataRequestFilter, newDataRequest } from "./pull";
import { checkType, AssertEqual, AssertPropertyAbsent, AssertPropertyPresent, AssertPropertyOptional } from "../lib/ts-utils";
import { testGraph, Person, Movie } from "../test-project";
import { C, UUID } from "..";


suite("pull", () => {

    configureTestData({loadTestProjectData: true, isolateTestWrites: false});

    suite("simple queries", () => {

        suite("Person allProps request (no filter - get all people)", () => {
            const request = newDataRequest(Person).allProps;
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request);

                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)
                    
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
            const partialPersonRequest = (newDataRequest(Person)
                .name
                .dateOfBirthIfFlag("includeDOB")
            );
            test("buildCypherQuery - get all, DOB flag off", () => {
                const query = buildCypherQuery(partialPersonRequest);
                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)
                    
                    RETURN _node.name AS name ORDER BY _node.name
                `);
            });
            test("buildCypherQuery - get all, DOB flag on", () => {
                const query = buildCypherQuery(partialPersonRequest, {flags: ["includeDOB"]});
                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)
                    
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
                const nameStart = "Ka";
                const people = await testGraph.pull(partialPersonRequest, {
                    where: C`@this.name STARTS WITH ${nameStart}`,
                });

                assert.equal(people[0].name, "Karen Gillan");
                assert.equal(people[1].name, "Kate McKinnon");
            });
            test("Partial Person request with sorting (oldest first)", async () => {
                const peopleOldestFirst = await testGraph.pull(partialPersonRequest, {
                    orderBy: "@this.dateOfBirth",
                    // Test ordering by a field that's not included in the response.
                });
                assert.equal(peopleOldestFirst[0].name, "Robert Downey Jr.");
                assert.equal(peopleOldestFirst[0].dateOfBirth, undefined);  // Disabled by lack of flag
            });
            test("Partial Person request with sorting (youngest first)", async () => {
                const peopleYoungestFirst = await testGraph.pull(partialPersonRequest, {
                    orderBy: "@this.dateOfBirth DESC",
                    flags: ["includeDOB"],
                });
                assert.equal(peopleYoungestFirst[0].name, "Karen Gillan");
                assert.equal(peopleYoungestFirst[0].dateOfBirth, "1987-11-28");
            });
        });

        suite("Basic Person request", () => {
            // This DataRequest gets some raw properties of Person, with no virtual properties
            const basicPersonRequest = (newDataRequest(Person)
                .uuid
                .name
                .dateOfBirth
            );
            test("buildCypherQuery - match by UUID", () => {
                const query = buildCypherQuery(basicPersonRequest, {key: "00000000-0000-0000-0000-000000001234"});

                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson:VNode {uuid: $_nodeUuid})
                    
                    RETURN _node.uuid AS uuid, _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                `);
                assert.equal(query.params._nodeUuid, "00000000-0000-0000-0000-000000001234");
            });
            test("buildCypherQuery - matching with WHERE filter", () => {
                const query = buildCypherQuery(basicPersonRequest, {where: C`@this.name = ${"Dwayne Johnson"}`});

                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)
                    WHERE _node.name = $whereParam1
                    
                    RETURN _node.uuid AS uuid, _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                `);
                assert.equal(query.params.whereParam1, "Dwayne Johnson");
            });
        });

        suite("Movie request, keyed by shortId", () => {
            const request = newDataRequest(Movie).shortId.title.year;
            const filter: DataRequestFilter = {key: "jumanji-2"};
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request, filter);
                assert.equal(query.query, dedent`
                    MATCH (_node:TestMovie:VNode)<-[:IDENTIFIES]-(:ShortId {shortId: $_nodeShortid})
                    
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

        // Test a to-many virtual property/relationship:
        suite("Get all Chris Pratt Movies", () => {
            const request = newDataRequest(Person).movies(m => m.title.year);
            const filter: DataRequestFilter = {key: "chris-pratt", };
            test("buildCypherQuery", () => {
                // This test covers the situation where we're not including any raw (non-virtual) properties from the main node (_node)
                const query = buildCypherQuery(request, filter);
                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)<-[:IDENTIFIES]-(:ShortId {shortId: $_nodeShortid})

                    OPTIONAL MATCH (_node)-[_rel1:ACTED_IN]->(_movie1:TestMovie:VNode)
                    WITH _node, _movie1, _rel1 ORDER BY _movie1.year DESC
                    WITH _node, collect(_movie1 {.title, .year}) AS _movies1

                    RETURN _movies1 AS movies ORDER BY _node.name
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

        // Test a to-many virtual property/relationship with a property on the relationship:
        test("Get all Robert Downey Jr. Movies, annotated with role", async () => {
            const rdj = await testGraph.pullOne(Person, p => p
                .name
                .movies(m => m.title.year.role())
            , {key: "rdj", });

            assert.equal(rdj.movies.length, 2);
            assert.equal(rdj.movies[0].title, "Avengers: Infinity War");
            assert.equal(rdj.movies[0].role, "Tony Stark / Iron Man");  // "role" is a property stored on the relationship
            const infinityWar = rdj.movies[0];
            // We don't really enforce relationship properties or know when they're nullable so assume they can always be null:
            checkType<AssertPropertyPresent<typeof infinityWar, "role", string|null>>();
            assert.equal(rdj.movies[1].title, "Tropic Thunder");
            assert.equal(rdj.movies[1].role, "Kirk Lazarus");
        });

        suite("Test ordering a to-many virtual property by a relationship property", async () => {
            const request = newDataRequest(Person).name.moviesOrderedByRole(m => m.title.year.role())
            const filter: DataRequestFilter = {key: "rdj", };
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request, filter);
                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)<-[:IDENTIFIES]-(:ShortId {shortId: $_nodeShortid})

                    OPTIONAL MATCH (_node)-[_rel1:ACTED_IN]->(_movie1:TestMovie:VNode)
                    WITH _node, _movie1, _rel1, (_rel1.role) AS _role1
                    WITH _node, _movie1, _rel1, _role1 ORDER BY _rel1.role
                    WITH _node, collect(_movie1 {.title, .year, role: _role1}) AS _moviesOrderedByRole1

                    RETURN _node.name AS name, _moviesOrderedByRole1 AS moviesOrderedByRole ORDER BY _node.name
                `);
            });
            test("pull", async () => {
                const rdj = await testGraph.pullOne(request, filter);
                assert.equal(rdj.moviesOrderedByRole.length, 2);
                // Kirk Lazarus comes before Tony Stark:
                assert.equal(rdj.moviesOrderedByRole[0].title, "Tropic Thunder");
                assert.equal(rdj.moviesOrderedByRole[0].role, "Kirk Lazarus");
                assert.equal(rdj.moviesOrderedByRole[1].title, "Avengers: Infinity War");
                assert.equal(rdj.moviesOrderedByRole[1].role, "Tony Stark / Iron Man");
                // Compare this to the previous test case for the role prop, where the order was different.
            });
        });

        // Test a to-one virtual property/relationship:
        suite("Get a movie's franchise", () => {
            const request = newDataRequest(Movie).title.franchise(f => f.name);
            // This filter will match two movies: "Avengers: Infinity War" (MCU franchise) and "The Spy Who Dumped Me" (no franchise)
            const filter: DataRequestFilter = {where: C`@this.year = 2018`};
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request, filter);
                assert.equal(query.query, dedent`
                    MATCH (_node:TestMovie:VNode)
                    WHERE _node.year = 2018
                    
                    CALL {
                        WITH _node
                        OPTIONAL MATCH (_node)-[:FRANCHISE_IS]->(_moviefranchise1:TestMovieFranchise:VNode)
                        RETURN _moviefranchise1 LIMIT 1
                    }
                    WITH _node, _moviefranchise1 {.name} AS _franchise1
                    
                    RETURN _node.title AS title, _franchise1 AS franchise ORDER BY _node.year DESC
                `);
            });
            test("pull", async () => {
                const movies2018 = await testGraph.pull(request, filter);
                assert.equal(movies2018.length, 2);
                // Movies are sorted only by year, so we don't know the order of movies that are in the same year:
                const infinityWar = movies2018.find(m => m.title === "Avengers: Infinity War");
                assert.isDefined(infinityWar);
                assert.equal(infinityWar?.franchise?.name, "Marvel Cinematic Universe");
                const spyDumpedMe = movies2018.find(m => m.title === "The Spy Who Dumped Me");
                assert.isDefined(spyDumpedMe);
                assert.equal(spyDumpedMe?.franchise, undefined);
            });
        });

        suite("Test a to-one virtual property/relationship with a circular reference:", () => {
            const request = newDataRequest(Movie).title.franchise(f => f.name.movies(m => m.title));
            const filter: DataRequestFilter = {key: "infinity-war"};
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request, filter);
                assert.equal(query.query, dedent`
                    MATCH (_node:TestMovie:VNode)<-[:IDENTIFIES]-(:ShortId {shortId: $_nodeShortid})
                    
                    CALL {
                        WITH _node
                        OPTIONAL MATCH (_node)-[:FRANCHISE_IS]->(_moviefranchise1:TestMovieFranchise:VNode)
                        RETURN _moviefranchise1 LIMIT 1
                    }
                    
                    OPTIONAL MATCH (_moviefranchise1)<-[:FRANCHISE_IS]-(_movie1:TestMovie:VNode)
                    WITH _node, _moviefranchise1, _movie1 ORDER BY _movie1.year DESC
                    WITH _node, _moviefranchise1, collect(_movie1 {.title}) AS _movies1
                    WITH _node, _moviefranchise1 {.name, movies: _movies1} AS _franchise1
                    
                    RETURN _node.title AS title, _franchise1 AS franchise ORDER BY _node.year DESC
                `);
            });
            test("pull", async () => {
                const infinityWar = await testGraph.pullOne(request, filter);
                assert.equal(infinityWar.franchise?.name, "Marvel Cinematic Universe");
                assert.equal(infinityWar.franchise?.movies[0].title, "Avengers: Infinity War");
            });
        });

        suite("Cypher expression: get a person's age", () => {
            // This tests the "age" virtual property, which computes the Person's age within Neo4j and returns it
            const request = newDataRequest(Person).name.dateOfBirth.age();
            const filter: DataRequestFilter = {key: "chris-pratt"};
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request, filter);
                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)<-[:IDENTIFIES]-(:ShortId {shortId: $_nodeShortid})
                    WITH _node, (duration.between(date(_node.dateOfBirth), date()).years) AS _age1

                    RETURN _node.name AS name, _node.dateOfBirth AS dateOfBirth, _age1 AS age ORDER BY _node.name
                `);
            });
            test("pull", async () => {
                const chrisPratt = await testGraph.pullOne(request, filter);
                // A function to compute the age in JavaScript, from https://stackoverflow.com/a/7091965 :
                const getAge = (dateString: string): number => {
                    const today = new Date(), birthDate = new Date(dateString);
                    let age = today.getFullYear() - birthDate.getFullYear();
                    const m = today.getMonth() - birthDate.getMonth();
                    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) { age--; }
                    return age;
                }
                checkType<AssertEqual<typeof chrisPratt["age"], number>>();
                assert.equal(chrisPratt.age, getAge(chrisPratt.dateOfBirth));
            });
        })

        suite("deep pull", () => {
            // Build a horribly deep query:
            // For every person, find their friends, then find their friend's costars, then their costar's movies and friends' movies
            const request = (newDataRequest(Person)
                .friends(f => f
                    .name
                    .costars(cs => cs
                        .name
                        .friends(f2 => f2.name.movies(m => m.title.year))
                        .movies(m => m.title.year)
                    )
                )
            );
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request, {});
                assert.equal(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)

                    OPTIONAL MATCH (_node)-[:FRIEND_OF]-(_person1:TestPerson:VNode)
                    
                    OPTIONAL MATCH (_person1)-[:ACTED_IN]->(:TestMovie:VNode)<-[:ACTED_IN]-(_person2:TestPerson:VNode)
                    
                    OPTIONAL MATCH (_person2)-[_rel1:ACTED_IN]->(_movie1:TestMovie:VNode)
                    WITH _node, _person1, _person2, _movie1, _rel1 ORDER BY _movie1.year DESC
                    WITH _node, _person1, _person2, collect(_movie1 {.title, .year}) AS _movies1
                    
                    OPTIONAL MATCH (_person2)-[:FRIEND_OF]-(_person3:TestPerson:VNode)
                    
                    OPTIONAL MATCH (_person3)-[_rel1:ACTED_IN]->(_movie1:TestMovie:VNode)
                    WITH _node, _person1, _person2, _movies1, _person3, _movie1, _rel1 ORDER BY _movie1.year DESC
                    WITH _node, _person1, _person2, _movies1, _person3, collect(_movie1 {.title, .year}) AS _movies2
                    WITH _node, _person1, _person2, _movies1, _person3, _movies2 ORDER BY _person3.name
                    WITH _node, _person1, _person2, _movies1, collect(_person3 {.name, movies: _movies2}) AS _friends1
                    WITH _node, _person1, _person2, _movies1, _friends1 ORDER BY _person2.name
                    WITH _node, _person1, collect(_person2 {.name, movies: _movies1, friends: _friends1}) AS _costars1
                    WITH _node, _person1, _costars1 ORDER BY _person1.name
                    WITH _node, collect(_person1 {.name, costars: _costars1}) AS _friends1

                    RETURN _friends1 AS friends ORDER BY _node.name
                `);
            });
            test("pull", async () => {
                // Test this horrible query, using Scarlett Johansson as a starting point:
                const result = await testGraph.pullOne(request, {key: "scarlett-johansson"});
                // Scarlett Johansson is friends with Robert Downey Jr. and Karen Gillan; results sorted alphabetically by name
                assert.deepEqual(result.friends.map(f => f.name), ["Karen Gillan", "Robert Downey Jr."]);
                // Robert Downey Jr.'s co-stars are Chris Pratt, Scarlett Johansson, and Karen Gillan
                const sj_friends_rdj_costars = result.friends[1].costars;
                assert.deepEqual(sj_friends_rdj_costars.map(costar => costar.name), ["Chris Pratt", "Karen Gillan", "Scarlett Johansson"]);
                // Karen Gillan's friends are Dwayne Johnson and Scarlett Johansson:
                const sj_friends_rdj_costars_kg_friends = sj_friends_rdj_costars[1].friends;
                assert.deepEqual(sj_friends_rdj_costars_kg_friends.map(f => f.name), ["Dwayne Johnson", "Scarlett Johansson"]);
                // The Rock's movies (in reverse chronological order) are Jumanji: The Next Level, Jumanji: Welcome to the Jungle, Jem and the Holograms
                const sj_friends_rdj_costars_kg_friends_dj_movies = sj_friends_rdj_costars_kg_friends[0].movies;
                assert.deepEqual(
                    sj_friends_rdj_costars_kg_friends_dj_movies.map(m => m.title),
                    ["Jumanji: The Next Level", "Jumanji: Welcome to the Jungle", "Jem and the Holograms"],
                );
                checkType<AssertPropertyPresent<typeof sj_friends_rdj_costars_kg_friends_dj_movies[0], "title", string>>();
                checkType<AssertPropertyPresent<typeof sj_friends_rdj_costars_kg_friends_dj_movies[0], "year", number>>();
                checkType<AssertPropertyAbsent<typeof sj_friends_rdj_costars_kg_friends_dj_movies[0], "foobar">>();
                // And, stepping back a level, Karen Gillan's movies (in reverse chronological order) are
                // "Jumanji: The Next Level", "Avengers: Infinity War", "Jumanji: Welcome to the Jungle", "Guardians of the Galaxy"
                const sj_friends_rdj_costars_kg_movies = sj_friends_rdj_costars[1].movies;
                assert.deepEqual(
                    sj_friends_rdj_costars_kg_movies.map(m => m.title),
                    ["Jumanji: The Next Level", "Avengers: Infinity War", "Jumanji: Welcome to the Jungle", "Guardians of the Galaxy"],
                );
                checkType<AssertPropertyPresent<typeof sj_friends_rdj_costars_kg_movies[0], "title", string>>();
                checkType<AssertPropertyPresent<typeof sj_friends_rdj_costars_kg_movies[0], "year", number>>();
                checkType<AssertPropertyAbsent<typeof sj_friends_rdj_costars_kg_movies[0], "foobar">>();
            });
        });
    });

    suite("Queries including derived properties", () => {
        test("Compute a property in JavaScript, using data from a raw property and virtual property that are explicitly fetched.", async () => {
            const chrisPratt = await testGraph.pullOne(Person, p => p.dateOfBirth.age().ageJS(), {key: "chris-pratt"});
            assert.strictEqual(chrisPratt.age, chrisPratt.ageJS.ageJS);
            assert.strictEqual(chrisPratt.age, chrisPratt.ageJS.ageNeo);
            assert.isAtLeast(chrisPratt.ageJS.ageJS, 40);
            assert.isAtMost(chrisPratt.ageJS.ageJS, 70);
            // Check typing:
            checkType<AssertPropertyPresent<typeof chrisPratt.ageJS, "ageJS", number>>();
            checkType<AssertPropertyPresent<typeof chrisPratt.ageJS, "ageNeo", number>>();
            checkType<AssertPropertyAbsent<typeof chrisPratt.ageJS, "other">>();
        });
        test("Compute a property in JavaScript, using data from a raw property and virtual property that are NOT explicitly fetched.", async () => {
            const age = (await testGraph.pullOne(Person, p => p.age(), {key: "chris-pratt"})).age;
            const chrisPratt = await testGraph.pullOne(Person, p => p.ageJS(), {key: "chris-pratt"});
            assert.strictEqual(age, chrisPratt.ageJS.ageJS);
            assert.isAtLeast(chrisPratt.ageJS.ageJS, 40);
            assert.isAtMost(chrisPratt.ageJS.ageJS, 70);
        });
    });
});
