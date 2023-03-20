import { Vertex } from "../index.ts";

export const testGraph = new Vertex({
    neo4jUrl: Deno.env.get("NEO4J_URL") ?? "bolt://localhost:7777",
    neo4jUser: "neo4j",
    neo4jPassword: "vertex",
    extraMigrations: {
        // Make the 'slugId' field act as a unique key for the VNode types in the test project:
        slugIdUnique: {
            forward: async (dbWrite) => {
                await dbWrite("CREATE CONSTRAINT testproject_slugids_uniq FOR (v:VNode) REQUIRE v.slugId IS UNIQUE");
            },
            backward: async (dbWrite) => {
                await dbWrite("DROP CONSTRAINT testproject_slugids_uniq IF EXISTS");
            },
            dependsOn: [],
        },
    },
});

import { Movie } from "./Movie.ts";
import { MovieFranchise } from "./MovieFranchise.ts";
import { Person } from "./Person.ts";
import { TypeTester } from "./TypeTester.ts";
testGraph.registerVNodeTypes([
    Movie,
    MovieFranchise,
    Person,
    TypeTester,
]);

export * from "./Movie.ts";
export * from "./MovieFranchise.ts";
export * from "./Person.ts";
export * from "./TypeTester.ts";
export * from "./test-data.ts";
