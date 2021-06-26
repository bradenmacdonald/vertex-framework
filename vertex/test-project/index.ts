import { Vertex } from "../index.ts";

export const testGraph = new Vertex({
    neo4jUrl: Deno.env.get("NEO4J_URL") ?? "bolt://localhost:7777",
    neo4jUser: "neo4j",
    neo4jPassword: "vertex",
    debugLogging: true,
    extraMigrations: {
        // No special migrations required.
    },
});

export * from "./Movie.ts";
export * from "./MovieFranchise.ts";
export * from "./Person.ts";
export * from "./TypeTester.ts";
export * from "./test-data.ts";
