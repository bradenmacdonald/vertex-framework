import neo4j, * as Neo4j from "https://raw.githubusercontent.com/neo4j/neo4j-javascript-driver/5.5.0/packages/neo4j-driver-deno/lib/mod.ts";
// For local development:
// import neo4j, * as Neo4j from "../../deno-neo4j-lite-client/mod.ts";
export {
    neo4j,
    Neo4j,
}

export * as stdLog from "https://deno.land/std@0.175.0/log/mod.ts"
export { format as formatDuration } from "https://deno.land/std@0.175.0/fmt/duration.ts";
