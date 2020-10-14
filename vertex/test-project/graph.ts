import { Vertex } from "../vertex";

export const testGraph = new Vertex({
    neo4jUrl: "bolt://neo4j",
    neo4jUser: "neo4j",
    neo4jPassword: "vertex",
    debugLogging: true,
    extraMigrations: {
        movie: {
            forward: (dbWrite, declareModel, removeModel) => declareModel("Movie", {shortId: true}),
            backward: (dbWrite, declareModel, removeModel) => removeModel("Movie", {shortId: true}),
            dependsOn: [],
        },
        person: {
            forward: (dbWrite, declareModel, removeModel) => declareModel("Person", {shortId: true}),
            backward: (dbWrite, declareModel, removeModel) => removeModel("Person", {shortId: true}),
            dependsOn: [],
        },
    },
});
