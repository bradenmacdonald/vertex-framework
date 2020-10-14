import { Vertex } from "../vertex";
import { CreateMovie } from "./Movie";
import { CreatePerson, ActedIn } from "./Person";

/**
 * Create data that can be used for testing.
 * Test should not modify this data, but can create new data that points to this.
 * @param graph 
 */
export async function createTestData(graph: Vertex): Promise<void> {
    await graph.runAsSystem(
        CreateMovie({shortId: "guardians-galaxy", title: "Guardians of the Galaxy", year: 2014, props: {}}),
        CreateMovie({shortId: "jem-holograms", title: "Jem and the Holograms", year: 2015, props: {}}),
        CreateMovie({shortId: "jumanji-2017", title: "Jumanji: Welcome to the Jungle", year: 2017, props: {}}),
        CreateMovie({shortId: "infinity-war", title: "Avengers: Infinity War", year: 2018, props: {}}),
        CreateMovie({shortId: "jumanji-2", title: "Jumanji: The Next Level", year: 2019, props: {}}),
        CreatePerson({shortId: "the-rock", name: "Dwayne Johnson", props: {dateOfBirth: "1972-05-02"}}),
        CreatePerson({shortId: "karen-gillan", name: "Karen Gillan", props: {dateOfBirth: "1987-11-28"}}),
        CreatePerson({shortId: "chris-pratt", name: "Chris Pratt", props: {dateOfBirth: "1979-06-21"}}),
        ActedIn({personId: "the-rock", movieId: "jumanji-2017"}),
        ActedIn({personId: "the-rock", movieId: "jumanji-2"}),
        ActedIn({personId: "the-rock", movieId: "jumanji-2"}),
        ActedIn({personId: "the-rock", movieId: "jem-holograms"}),
        ActedIn({personId: "karen-gillan", movieId: "jumanji-2017"}),
        ActedIn({personId: "karen-gillan", movieId: "jumanji-2"}),
        ActedIn({personId: "karen-gillan", movieId: "guardians-galaxy"}),
        ActedIn({personId: "karen-gillan", movieId: "infinity-war"}),
        ActedIn({personId: "chris-pratt", movieId: "guardians-galaxy"}),
        ActedIn({personId: "chris-pratt", movieId: "infinity-war"}),
        ActedIn({personId: "chris-pratt", movieId: "jem-holograms"}),
    );
}
