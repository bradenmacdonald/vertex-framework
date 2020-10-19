import { Vertex } from "../vertex";
import { Movie } from "./Movie";
import { MovieFranchise } from "./MovieFranchise";
import { Person } from "./Person";

export const testGraph = new Vertex({
    neo4jUrl: "bolt://neo4j",
    neo4jUser: "neo4j",
    neo4jPassword: "vertex",
    debugLogging: true,
    extraMigrations: {
        movie: {
            forward: (dbWrite, declareModel, removeModel) => declareModel(Movie.label, {shortId: true}),
            backward: (dbWrite, declareModel, removeModel) => removeModel(Movie.label, {shortId: true}),
            dependsOn: [],
        },
        person: {
            forward: (dbWrite, declareModel, removeModel) => declareModel(Person.label, {shortId: true}),
            backward: (dbWrite, declareModel, removeModel) => removeModel(Person.label, {shortId: true}),
            dependsOn: [],
        },
        moviefranchise: {
            forward: (dbWrite, declareModel, removeModel) => declareModel(MovieFranchise.label, {shortId: true}),
            backward: (dbWrite, declareModel, removeModel) => removeModel(MovieFranchise.label, {shortId: true}),
            dependsOn: [],
        },
    },
});
