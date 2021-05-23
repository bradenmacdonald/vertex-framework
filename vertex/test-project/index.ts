import { Vertex } from "..";

export const testGraph = new Vertex({
    neo4jUrl: "bolt://neo4j",
    neo4jUser: "neo4j",
    neo4jPassword: "vertex",
    debugLogging: true,
    extraMigrations: {
        // No special migrations required.
    },
});

export * from "./Movie";
export * from "./MovieFranchise";
export * from "./Person";
export * from "./TypeTester";
export * from "./test-data";
