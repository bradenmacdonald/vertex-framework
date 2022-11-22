// deno-lint-ignore-file no-explicit-any camelcase
import { group, test, configureTestData, assert, assertEquals, assertStrictEquals } from "../lib/tests.ts";
import { dedent } from "../lib/dedent.ts";

import { buildCypherQuery as _buildCypherQuery, newDataRequest } from "./pull.ts";
import { checkType, AssertEqual, AssertPropertyAbsent, AssertPropertyPresent, AssertPropertyOptional } from "../lib/ts-utils.ts";
import { testGraph, Person, Movie } from "../test-project/index.ts";
import { C, VNID, BaseDataRequest, DataRequestFilter, VDate } from "../index.ts";
import { FilteredRequest } from "./data-request-filtered.ts";

function buildCypherQuery(request: BaseDataRequest<any, any, any>, filter?: DataRequestFilter): ReturnType<typeof _buildCypherQuery> {
    return _buildCypherQuery(new FilteredRequest(request, filter ?? {}));
}


group(import.meta, () => {

    configureTestData({loadTestProjectData: true, isolateTestWrites: false});

    group("simple queries", () => {

        group("Person allProps request (no filter - get all people)", () => {
            const request = newDataRequest(Person).allProps;
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request);

                assertEquals(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)
                    
                    RETURN _node.id AS id, _node.slugId AS slugId, _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                `);
            });
            test("pull", async () => {
                const people = await testGraph.pull(request);
        
                // Note: request should be sorted by name by default, so Chris Pratt comes first
                const firstPerson = people[0];
                assertEquals(typeof firstPerson.id, "string")
                assertEquals(firstPerson.slugId, "chris-pratt");
                assertEquals(firstPerson.name, "Chris Pratt");
                assertEquals(firstPerson.dateOfBirth.toString(), "1979-06-21");
                checkType<AssertPropertyPresent<typeof firstPerson, "id", VNID>>();
                checkType<AssertPropertyPresent<typeof firstPerson, "slugId", string>>();
                checkType<AssertPropertyPresent<typeof firstPerson, "name", string>>();
                checkType<AssertPropertyPresent<typeof firstPerson, "dateOfBirth", VDate>>();
            });
        });

        group("Partial Person request", () => {
            // This data request tests conditional fields and excluded fields
            const partialPersonRequest = (newDataRequest(Person)
                .name
                .if("includeDOB", p => p.dateOfBirth)
            );
            test("buildCypherQuery - get all, DOB flag off", () => {
                const query = buildCypherQuery(partialPersonRequest);
                assertEquals(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)
                    
                    RETURN _node.name AS name ORDER BY _node.name
                `);
            });
            test("buildCypherQuery - get all, DOB flag on", () => {
                const query = buildCypherQuery(partialPersonRequest, {flags: ["includeDOB"]});
                assertEquals(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)
                    
                    RETURN _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                `);
            });
            test("pull - get all, DOB flag off", async () => {
                const people = await testGraph.pull(partialPersonRequest);

                // Note: request should be sorted by name by default, so Chris Pratt comes first
                const firstPerson = people[0];
                assertEquals(firstPerson.name, "Chris Pratt");
                checkType<AssertPropertyPresent<typeof firstPerson, "name", string>>();
                // dateOfBirth was not requested due to the missing flag (only known at runtime, not compile time)
                assertEquals(firstPerson.dateOfBirth, undefined);

                checkType<AssertPropertyOptional<typeof firstPerson, "dateOfBirth", VDate>>();
                // VNID was explicitly not requested, so should be undefined:
                assertEquals((firstPerson as any).id, undefined);
                checkType<AssertPropertyAbsent<typeof firstPerson, "id">>();
            });
            test("pull - get all, DOB flag on", async () => {
                const people = await testGraph.pull(partialPersonRequest, {flags: ["includeDOB"]});
        
                // Note: request should be sorted by name by default, so Chris Pratt comes first
                const firstPerson = people[0];
                assertEquals(firstPerson.name, "Chris Pratt");
                checkType<AssertPropertyPresent<typeof firstPerson, "name", string>>();
                // dateOfBirth was requested using a flag (only known at runtime, not compile time)
                assertEquals(firstPerson.dateOfBirth?.toString(), "1979-06-21");
                checkType<AssertPropertyOptional<typeof firstPerson, "dateOfBirth", VDate>>();
                // VNID was explicitly not requested, so should be undefined:
                assertEquals((firstPerson as any).id, undefined);
                checkType<AssertPropertyAbsent<typeof firstPerson, "id">>();
            });
            test("pull - with name filter", async () => {
                const nameStart = "Ka";
                const people = await testGraph.pull(partialPersonRequest, {
                    where: C`@this.name STARTS WITH ${nameStart}`,
                });

                assertEquals(people[0].name, "Karen Gillan");
                assertEquals(people[1].name, "Kate McKinnon");
            });
            test("Partial Person request with sorting (oldest first)", async () => {
                const peopleOldestFirst = await testGraph.pull(partialPersonRequest, {
                    orderBy: "@this.dateOfBirth",
                    // Test ordering by a field that's not included in the response.
                });
                assertEquals(peopleOldestFirst[0].name, "Robert Downey Jr.");
                assertEquals(peopleOldestFirst[0].dateOfBirth, undefined);  // Disabled by lack of flag
            });
            test("Partial Person request with sorting (youngest first)", async () => {
                const peopleYoungestFirst = await testGraph.pull(partialPersonRequest, {
                    orderBy: "@this.dateOfBirth DESC",
                    flags: ["includeDOB"],
                });
                assertEquals(peopleYoungestFirst[0].name, "Karen Gillan");
                assertEquals(peopleYoungestFirst[0].dateOfBirth?.toString(), "1987-11-28");
            });
        });

        group("Basic Person request", () => {
            // This DataRequest gets some raw properties of Person, with no virtual properties
            const basicPersonRequest = (newDataRequest(Person)
                .id
                .name
                .dateOfBirth
            );
            test("buildCypherQuery - match by VNID", () => {
                const query = buildCypherQuery(basicPersonRequest, {id: VNID("_12345")});

                assertEquals(query.query, dedent`
                    MATCH (_node:TestPerson:VNode {id: $_nodeVNID})
                    
                    RETURN _node.id AS id, _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                `);
                assertEquals(query.params._nodeVNID, "_12345");
            });
            test("buildCypherQuery - matching with WHERE filter", () => {
                const query = buildCypherQuery(basicPersonRequest, {where: C`@this.name = ${"Dwayne Johnson"}`});

                assertEquals(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)
                    WHERE _node.name = $whereParam1
                    
                    RETURN _node.id AS id, _node.name AS name, _node.dateOfBirth AS dateOfBirth ORDER BY _node.name
                `);
                assertEquals(query.params.whereParam1, "Dwayne Johnson");
            });
        });

        group("Movie request, keyed by slugId", () => {
            const request = newDataRequest(Movie).slugId.title.year;
            const filter: DataRequestFilter = {with: {slugId: "jumanji-2"}};
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request, filter);
                assertEquals(query.query, dedent`
                    MATCH (_node:TestMovie:VNode)
                    WHERE _node.slugId = $whereParam1
                    
                    RETURN _node.slugId AS slugId, _node.title AS title, _node.year AS year ORDER BY _node.year DESC
                `);
                assertEquals(query.params.whereParam1, "jumanji-2");
            });
            test("pull", async () => {
                const result = await testGraph.pullOne(request, filter);
                assertEquals(result.title, "Jumanji: The Next Level");
                checkType<AssertPropertyPresent<typeof result, "title", string>>();
                assertEquals(result.year, 2019);
                checkType<AssertPropertyPresent<typeof result, "year", number>>();
            });
        });
    });

    group("Queries including virtual properties", () => {

        // Test a to-many virtual property/relationship:
        group("Get all Chris Pratt Movies", () => {
            const request = newDataRequest(Person).movies(m => m.title.year);
            const filter: DataRequestFilter = {with: {slugId: "chris-pratt"}};
            test("buildCypherQuery", () => {
                // This test covers the situation where we're not including any raw (non-virtual) properties from the main node (_node)
                const query = buildCypherQuery(request, filter);
                assertEquals(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)
                    WHERE _node.slugId = $whereParam1

                    OPTIONAL MATCH _path1 = (_node)-[_rel1:ACTED_IN]->(_movie1:TestMovie:VNode)
                    WITH _node, _movie1, _path1, _rel1 ORDER BY _movie1.year DESC
                    WITH _node, collect(_movie1 {.title, .year}) AS _movies1

                    RETURN _movies1 AS movies ORDER BY _node.name
                `);
                assertEquals(query.params.whereParam1, "chris-pratt");
            });
            test("pull", async () => {
                // This test covers the situation where we're not including any raw (non-virtual) properties from the main node (_node)
                const chrisPratt = await testGraph.pullOne(request, filter);
                assertEquals(chrisPratt.movies.length, 3);
                // Movies should be sorted newest first by default, so the first movie should be the newest one:
                const firstTitle = chrisPratt.movies[0].title;
                assertEquals(firstTitle, "Avengers: Infinity War");
                checkType<AssertEqual<typeof firstTitle, string>>();
            });
            test("pull - alternate syntax", async () => {
                const chrisPratt = await testGraph.pullOne(Person, p => p
                    .name
                    .movies(m => m.slugId.title),
                    filter,
                );
                assertEquals(chrisPratt.name, "Chris Pratt");
                assertEquals(chrisPratt.movies.length, 3);
                // Movies should be sorted newest first by default, so the first movie should be the newest one:
                const firstTitle = chrisPratt.movies[0].title;
                assertEquals(firstTitle, "Avengers: Infinity War");
                checkType<AssertEqual<typeof firstTitle, string>>();
            });
        });

        test("can merge separate requests for the same virtual property", async () => {
            // Merging data requests is an important part of how "derived property" dependencies are handled.
            // Here's a request with overlapping field specification:
            const request = newDataRequest(Person)
                .name
                .movies(m => m.title.franchise(mf => mf.name))
                .movies(m => m.year.franchise(mf => mf.name.id))
            ;
            // The above request should be equivalent to:
            const mergedRequest = newDataRequest(Person)
                .name
                .movies(m => m.title.year.franchise(mf => mf.id.name))
            ;
            const filter: DataRequestFilter = {with: {slugId: "rdj" }};

            assertEquals(
                buildCypherQuery(request, filter),
                buildCypherQuery(mergedRequest, filter),
            );
            assertEquals<unknown>(
                await testGraph.pullOne(request, filter),
                await testGraph.pullOne(mergedRequest, filter),
            );
        });

        // Test a to-many virtual property/relationship with a property on the relationship:
        test("Get all Robert Downey Jr. Movies, annotated with role", async () => {
            const rdj = await testGraph.pullOne(Person, p => p
                .name
                .movies(m => m.title.year.role())
            , {with: {slugId: "rdj" }});

            assertEquals(rdj.movies.length, 2);
            assertEquals(rdj.movies[0].title, "Avengers: Infinity War");
            assertEquals(rdj.movies[0].role, "Tony Stark / Iron Man");  // "role" is a property stored on the relationship
            const infinityWar = rdj.movies[0];
            // We don't really enforce relationship properties or know when they're nullable so assume they can always be null:
            checkType<AssertPropertyPresent<typeof infinityWar, "role", string|null>>();
            assertEquals(rdj.movies[1].title, "Tropic Thunder");
            assertEquals(rdj.movies[1].role, "Kirk Lazarus");
        });

        group("Test ordering a to-many virtual property by a relationship property", () => {
            const request = newDataRequest(Person).name.moviesOrderedByRole(m => m.title.year.role())
            const filter: DataRequestFilter = {with: {slugId: "rdj" }};
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request, filter);
                assertEquals(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)
                    WHERE _node.slugId = $whereParam1

                    OPTIONAL MATCH _path1 = (_node)-[_rel1:ACTED_IN]->(_movie1:TestMovie:VNode)
                    WITH _node, _movie1, _path1, _rel1, (_rel1.role) AS _role1
                    WITH _node, _movie1, _path1, _rel1, _role1 ORDER BY _rel1.role
                    WITH _node, collect(_movie1 {.title, .year, role: _role1}) AS _moviesOrderedByRole1

                    RETURN _node.name AS name, _moviesOrderedByRole1 AS moviesOrderedByRole ORDER BY _node.name
                `);
            });
            test("pull", async () => {
                const rdj = await testGraph.pullOne(request, filter);
                assertEquals(rdj.moviesOrderedByRole.length, 2);
                // Kirk Lazarus comes before Tony Stark:
                assertEquals(rdj.moviesOrderedByRole[0].title, "Tropic Thunder");
                assertEquals(rdj.moviesOrderedByRole[0].role, "Kirk Lazarus");
                assertEquals(rdj.moviesOrderedByRole[1].title, "Avengers: Infinity War");
                assertEquals(rdj.moviesOrderedByRole[1].role, "Tony Stark / Iron Man");
                // Compare this to the previous test case for the role prop, where the order was different.
            });
        });

        // Test a to-one virtual property/relationship:
        group("Get a movie's franchise", () => {
            const request = newDataRequest(Movie).title.franchise(f => f.name);
            // This filter will match two movies: "Avengers: Infinity War" (MCU franchise) and "The Spy Who Dumped Me" (no franchise)
            const filter: DataRequestFilter = {where: C`@this.year = 2018`};
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request, filter);
                assertEquals(query.query, dedent`
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
                assertEquals(movies2018.length, 2);
                // Movies are sorted only by year, so we don't know the order of movies that are in the same year:
                const infinityWar = movies2018.find(m => m.title === "Avengers: Infinity War");
                assert(infinityWar !== undefined);
                assertEquals(infinityWar?.franchise?.name, "Marvel Cinematic Universe");
                const spyDumpedMe = movies2018.find(m => m.title === "The Spy Who Dumped Me");
                assert(spyDumpedMe !== undefined);
                assertStrictEquals(spyDumpedMe?.franchise, null);
            });
        });

        group("Test a to-one virtual property/relationship with a circular reference:", () => {
            const request = newDataRequest(Movie).title.franchise(f => f.name.movies(m => m.title));
            const filter: DataRequestFilter = {with: {slugId: "infinity-war"}};
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request, filter);
                assertEquals(query.query, dedent`
                    MATCH (_node:TestMovie:VNode)
                    WHERE _node.slugId = $whereParam1
                    
                    CALL {
                        WITH _node
                        OPTIONAL MATCH (_node)-[:FRANCHISE_IS]->(_moviefranchise1:TestMovieFranchise:VNode)
                        RETURN _moviefranchise1 LIMIT 1
                    }
                    
                    OPTIONAL MATCH _path1 = (_moviefranchise1)<-[:FRANCHISE_IS]-(_movie1:TestMovie:VNode)
                    WITH _node, _moviefranchise1, _movie1, _path1 ORDER BY _movie1.year DESC
                    WITH _node, _moviefranchise1, collect(_movie1 {.title}) AS _movies1
                    WITH _node, _moviefranchise1 {.name, movies: _movies1} AS _franchise1
                    
                    RETURN _node.title AS title, _franchise1 AS franchise ORDER BY _node.year DESC
                `);
            });
            test("pull", async () => {
                const infinityWar = await testGraph.pullOne(request, filter);
                assertEquals(infinityWar.franchise?.name, "Marvel Cinematic Universe");
                assertEquals(infinityWar.franchise?.movies[0].title, "Avengers: Infinity War");
            });
        });

        group("Cypher expression: get a person's age", () => {
            // This tests the "age" virtual property, which computes the Person's age within Neo4j and returns it
            const request = newDataRequest(Person).name.dateOfBirth.age();
            const filter: DataRequestFilter = {with: {slugId: "chris-pratt"}};
            test("buildCypherQuery", () => {
                const query = buildCypherQuery(request, filter);
                assertEquals(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)
                    WHERE _node.slugId = $whereParam1
                    WITH _node, (duration.between(_node.dateOfBirth, date()).years) AS _age1

                    RETURN _node.name AS name, _node.dateOfBirth AS dateOfBirth, _age1 AS age ORDER BY _node.name
                `);
            });
            test("pull", async () => {
                const chrisPratt = await testGraph.pullOne(request, filter);
                // A function to compute the age in JavaScript, from https://stackoverflow.com/a/7091965 :
                const getAge = (birthDate: VDate): number => {
                    const today = new Date();
                    let age = today.getFullYear() - birthDate.year;
                    const m = today.getMonth() - (birthDate.month - 1);
                    if (m < 0 || (m === 0 && today.getDate() < birthDate.day)) { age--; }
                    return age;
                }
                checkType<AssertEqual<typeof chrisPratt["age"], number>>();
                assertEquals(chrisPratt.age, getAge(chrisPratt.dateOfBirth));
            });
        })

        group("deep pull", () => {
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
                assertEquals(query.query, dedent`
                    MATCH (_node:TestPerson:VNode)

                    OPTIONAL MATCH _path1 = (_node)-[:FRIEND_OF]-(_person1:TestPerson:VNode)
                    
                    OPTIONAL MATCH _path2 = (_person1)-[:ACTED_IN]->(:TestMovie:VNode)<-[:ACTED_IN]-(_person2:TestPerson:VNode)
                    
                    OPTIONAL MATCH _path3 = (_person2)-[_rel1:ACTED_IN]->(_movie1:TestMovie:VNode)
                    WITH _node, _person1, _path1, _person2, _path2, _movie1, _path3, _rel1 ORDER BY _movie1.year DESC
                    WITH _node, _person1, _path1, _person2, _path2, collect(_movie1 {.title, .year}) AS _movies1
                    
                    OPTIONAL MATCH _path3 = (_person2)-[:FRIEND_OF]-(_person3:TestPerson:VNode)
                    
                    OPTIONAL MATCH _path4 = (_person3)-[_rel1:ACTED_IN]->(_movie1:TestMovie:VNode)
                    WITH _node, _person1, _path1, _person2, _path2, _movies1, _person3, _path3, _movie1, _path4, _rel1 ORDER BY _movie1.year DESC
                    WITH _node, _person1, _path1, _person2, _path2, _movies1, _person3, _path3, collect(_movie1 {.title, .year}) AS _movies2
                    WITH _node, _person1, _path1, _person2, _path2, _movies1, _person3, _path3, _movies2 ORDER BY _person3.name
                    WITH _node, _person1, _path1, _person2, _path2, _movies1, collect(_person3 {.name, movies: _movies2}) AS _friends1
                    WITH _node, _person1, _path1, _person2, _path2, _movies1, _friends1 ORDER BY _person2.name
                    WITH _node, _person1, _path1, collect(_person2 {.name, movies: _movies1, friends: _friends1}) AS _costars1
                    WITH _node, _person1, _path1, _costars1 ORDER BY _person1.name
                    WITH _node, collect(_person1 {.name, costars: _costars1}) AS _friends1

                    RETURN _friends1 AS friends ORDER BY _node.name
                `);
            });
            test("pull", async () => {
                // Test this horrible query, using Scarlett Johansson as a starting point:
                const result = await testGraph.pullOne(request, {with: {slugId: "scarlett-johansson"}});
                // Scarlett Johansson is friends with Robert Downey Jr. and Karen Gillan; results sorted alphabetically by name
                assertEquals(result.friends.map(f => f.name), ["Karen Gillan", "Robert Downey Jr."]);
                // Robert Downey Jr.'s co-stars are Chris Pratt, Scarlett Johansson, and Karen Gillan
                const sj_friends_rdj_costars = result.friends[1].costars;
                assertEquals(sj_friends_rdj_costars.map(costar => costar.name), ["Chris Pratt", "Karen Gillan", "Scarlett Johansson"]);
                // Karen Gillan's friends are Dwayne Johnson and Scarlett Johansson:
                const sj_friends_rdj_costars_kg_friends = sj_friends_rdj_costars[1].friends;
                assertEquals(sj_friends_rdj_costars_kg_friends.map(f => f.name), ["Dwayne Johnson", "Scarlett Johansson"]);
                // The Rock's movies (in reverse chronological order) are Jumanji: The Next Level, Jumanji: Welcome to the Jungle, Jem and the Holograms
                const sj_friends_rdj_costars_kg_friends_dj_movies = sj_friends_rdj_costars_kg_friends[0].movies;
                assertEquals(
                    sj_friends_rdj_costars_kg_friends_dj_movies.map(m => m.title),
                    ["Jumanji: The Next Level", "Jumanji: Welcome to the Jungle", "Jem and the Holograms"],
                );
                checkType<AssertPropertyPresent<typeof sj_friends_rdj_costars_kg_friends_dj_movies[0], "title", string>>();
                checkType<AssertPropertyPresent<typeof sj_friends_rdj_costars_kg_friends_dj_movies[0], "year", number>>();
                checkType<AssertPropertyAbsent<typeof sj_friends_rdj_costars_kg_friends_dj_movies[0], "foobar">>();
                // And, stepping back a level, Karen Gillan's movies (in reverse chronological order) are
                // "Jumanji: The Next Level", "Avengers: Infinity War", "Jumanji: Welcome to the Jungle", "Guardians of the Galaxy"
                const sj_friends_rdj_costars_kg_movies = sj_friends_rdj_costars[1].movies;
                assertEquals(
                    sj_friends_rdj_costars_kg_movies.map(m => m.title),
                    ["Jumanji: The Next Level", "Avengers: Infinity War", "Jumanji: Welcome to the Jungle", "Guardians of the Galaxy"],
                );
                checkType<AssertPropertyPresent<typeof sj_friends_rdj_costars_kg_movies[0], "title", string>>();
                checkType<AssertPropertyPresent<typeof sj_friends_rdj_costars_kg_movies[0], "year", number>>();
                checkType<AssertPropertyAbsent<typeof sj_friends_rdj_costars_kg_movies[0], "foobar">>();
            });
        });
    });

    group("Queries including derived properties", () => {
        test("Compute a property in JavaScript, using data from a raw property and virtual property that are explicitly fetched.", async () => {
            const chrisPratt = await testGraph.pullOne(Person, p => p.dateOfBirth.age().ageJS(), {with: {slugId: "chris-pratt"}});
            assertEquals(chrisPratt.age, chrisPratt.ageJS.ageJS);
            assertEquals(chrisPratt.age, chrisPratt.ageJS.ageNeo);
            assert(chrisPratt.ageJS.ageJS >= 40);
            assert(chrisPratt.ageJS.ageJS <= 70);
            // Check typing:
            checkType<AssertPropertyPresent<typeof chrisPratt.ageJS, "ageJS", number>>();
            checkType<AssertPropertyPresent<typeof chrisPratt.ageJS, "ageNeo", number>>();
            checkType<AssertPropertyAbsent<typeof chrisPratt.ageJS, "other">>();
        });
        test("Compute a property in JavaScript, using data from a raw property and virtual property that are NOT explicitly fetched.", async () => {
            const age = (await testGraph.pullOne(Person, p => p.age(), {with: {slugId: "chris-pratt"}})).age;
            const chrisPratt = await testGraph.pullOne(Person, p => p.ageJS(), {with: {slugId: "chris-pratt"}});
            assertEquals(age, chrisPratt.ageJS.ageJS);
            assert(chrisPratt.ageJS.ageJS >= 40);
            assert(chrisPratt.ageJS.ageJS <= 70);
            // Dependencies used in the calculation but not explicitly requested should be excluded from the final result:
            assertStrictEquals((chrisPratt as any).dateOfBirth, undefined);
            assertStrictEquals((chrisPratt as any).age, undefined);
        });
    });

    group("Deep conditional properties of all types", () => {

        const request = (newDataRequest(Person)
            .id
            .if("namesFlag", p=>p
                .name
                .friends(f => f.name)
                .costars(cs => cs.name)
            ).if("numFriendsFlag", p=>p
                .numFriends()
                .friends(f => f.numFriends())
                .costars(cs => cs.numFriends())
            )
        );
        // This request will behave similarly to the preceding one, but is slightly different - for example in this
        // second one, .friends is always set regardless of flags and only its properties change, while in the preceding
        // one, .friends may or may not be present at all.
        const request2 = (newDataRequest(Person)
            .id
            .if("namesFlag", p=>p.name)
            .if("numFriendsFlag", p=>p.numFriends())
            .friends(f => f
                .if("namesFlag", f => f.name)
                .if("numFriendsFlag", f => f.numFriends())
            )
            .costars(cs => cs
                .if("namesFlag", cs => cs.name)
                .if("numFriendsFlag", cs => cs.numFriends())
            )
        );

        test("no flags set", async () => {
            const chrisPratt = await testGraph.pullOne(request, {with: {slugId: "chris-pratt"}});
            assertEquals(typeof chrisPratt.id, "string");
            assertStrictEquals(chrisPratt.name, undefined);
            assertStrictEquals(chrisPratt.numFriends, undefined);
            assertStrictEquals(chrisPratt.friends, undefined);
            assertStrictEquals(chrisPratt.costars, undefined);
            // Request 2:
            const chrisPratt2 = await testGraph.pullOne(request2, {with: {slugId: "chris-pratt"}});
            assertEquals(typeof chrisPratt2.id, "string");
            assertStrictEquals(chrisPratt2.name, undefined);
            assertStrictEquals(chrisPratt2.numFriends, undefined);
            // An empty object is returned for each friend and costar, because we included their virtual properties
            // but only conditionally included the properties of the friends and costars:
            assertEquals(chrisPratt2.friends, [ {} ]);
            assertEquals(chrisPratt2.costars, [ {}, {}, {}, {}, {} ]);
        });

        test("namesFlag set", async () => {
            const filter = {with: {slugId: "chris-pratt"}, flags: ["namesFlag"]};
            const friendsExpected = [{name: "Dwayne Johnson"}];
            const costarsExpected = [
                {name: "Dwayne Johnson"},
                {name: "Karen Gillan"},
                {name: "Karen Gillan"},  // TODO: Optional support for DISTINCT
                {name: "Robert Downey Jr."},
                {name: "Scarlett Johansson"},
            ];

            {
                const chrisPratt = await testGraph.pullOne(request, filter);
                assertEquals(typeof chrisPratt.id, "string");
                assertEquals(chrisPratt.name, "Chris Pratt");
                // TODO / NOTE: Currently, the typing of "friends" in request 1 is
                //     friends?: {name: string}&{numFriends: number}
                // which is incorrect. However, representing the true type in TypeScript would get very complex; it
                // would be something like:
                //     friends?: {name: string}|{numFriends: number}|{name: string; numFriends: number}
                // which could get exponentially complex, or just the following:
                //     friends?: {name?: string; numFriends?: number}
                // But solving for this edge case is likely not worth the trouble, especially since rewriting the data
                // request into the format of "request2" solves the typing problem.
                assertEquals(chrisPratt.friends, friendsExpected as any);
                assertEquals(chrisPratt.costars, costarsExpected as any);
            }

            {
                const chrisPratt = await testGraph.pullOne(request2, filter);
                assertEquals(typeof chrisPratt.id, "string");
                assertEquals(chrisPratt.name, "Chris Pratt");
                assertEquals(chrisPratt.friends, friendsExpected);
                assertEquals(chrisPratt.costars, costarsExpected);
            }
        });

        test("numFriends and namesFlag set", async () => {
            const filter = {with: {slugId: "chris-pratt"}, flags: ["namesFlag", "numFriendsFlag"]};

            const friendsExpected = [{name: "Dwayne Johnson", numFriends: 2}];
            const costarsExpected = [
                {name: "Dwayne Johnson", numFriends: 2},
                {name: "Karen Gillan", numFriends: 2},
                {name: "Karen Gillan", numFriends: 2},  // TODO: Optional support for DISTINCT
                {name: "Robert Downey Jr.", numFriends: 1},
                {name: "Scarlett Johansson", numFriends: 2},
            ];

            {
                const chrisPratt = await testGraph.pullOne(request, filter);
                assertEquals(typeof chrisPratt.id, "string");
                assertStrictEquals(chrisPratt.name, "Chris Pratt");
                assertStrictEquals(chrisPratt.numFriends, 1);
                assertEquals(chrisPratt.friends, friendsExpected);
                assertEquals(chrisPratt.costars, costarsExpected);
            }

            {
                const chrisPratt = await testGraph.pullOne(request2, filter);
                assertEquals(typeof chrisPratt.id, "string");
                assertStrictEquals(chrisPratt.name, "Chris Pratt");
                assertStrictEquals(chrisPratt.numFriends, 1);
                assertEquals(chrisPratt.friends, friendsExpected);
                assertEquals(chrisPratt.costars, costarsExpected);
            }
        });
    });

    group("Type safety check", () => {
        test("Virtual properties have to be called", async () => {
            if (Math.floor(1.0) == 2) {  // This is a compile time test, so we don't need to run any code.
                // @ts-expect-error Requesting p.age must be done as p.age() since it's a virtual property
                await testGraph.pull(Person, p => p.age);
            }
        })
    });
});
