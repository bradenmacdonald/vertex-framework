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
        CreateMovie({shortId: "tropic-thunder", title: "Tropic Thunder", year: 2008, props: {}}),
        CreateMovie({shortId: "guardians-galaxy", title: "Guardians of the Galaxy", year: 2014, props: {}}),
        CreateMovie({shortId: "jem-holograms", title: "Jem and the Holograms", year: 2015, props: {}}),
        CreateMovie({shortId: "office-xmas-party", title: "Office Christmas Party", year: 2016, props: {}}),
        CreateMovie({shortId: "jumanji-2017", title: "Jumanji: Welcome to the Jungle", year: 2017, props: {}}),
        CreateMovie({shortId: "rough-night", title: "Rough Night", year: 2017, props: {}}),
        CreateMovie({shortId: "infinity-war", title: "Avengers: Infinity War", year: 2018, props: {}}),
        CreateMovie({shortId: "spy-who-dumped-me", title: "The Spy Who Dumped Me", year: 2018, props: {}}),
        CreateMovie({shortId: "jumanji-2", title: "Jumanji: The Next Level", year: 2019, props: {}}),

        CreatePerson({shortId: "rdj", name: "Robert Downey Jr.", props: {dateOfBirth: "1965-04-04"}}),
        ActedIn({personId: "rdj", movieId: "infinity-war"}),
        ActedIn({personId: "rdj", movieId: "tropic-thunder"}),

        CreatePerson({shortId: "the-rock", name: "Dwayne Johnson", props: {dateOfBirth: "1972-05-02"}}),
        ActedIn({personId: "the-rock", movieId: "jumanji-2017"}),
        ActedIn({personId: "the-rock", movieId: "jumanji-2"}),
        ActedIn({personId: "the-rock", movieId: "jumanji-2"}),
        ActedIn({personId: "the-rock", movieId: "jem-holograms"}),

        CreatePerson({shortId: "chris-pratt", name: "Chris Pratt", props: {dateOfBirth: "1979-06-21"}}),
        ActedIn({personId: "chris-pratt", movieId: "guardians-galaxy"}),
        ActedIn({personId: "chris-pratt", movieId: "infinity-war"}),
        ActedIn({personId: "chris-pratt", movieId: "jem-holograms"}),

        CreatePerson({shortId: "kate-mckinnon", name: "Kate McKinnon", props: {dateOfBirth: "1984-01-06"}}),
        ActedIn({personId: "kate-mckinnon", movieId: "office-xmas-party"}),
        ActedIn({personId: "kate-mckinnon", movieId: "spy-who-dumped-me"}),
        ActedIn({personId: "kate-mckinnon", movieId: "rough-night"}),

        CreatePerson({shortId: "scarlett-johansson", name: "Scarlett Johansson", props: {dateOfBirth: "1984-11-22"}}),
        ActedIn({personId: "scarlett-johansson", movieId: "rough-night"}),
        ActedIn({personId: "scarlett-johansson", movieId: "infinity-war"}),

        CreatePerson({shortId: "ilana-glazer", name: "Ilana Glazer", props: {dateOfBirth: "1987-04-12"}}),
        ActedIn({personId: "ilana-glazer", movieId: "rough-night"}),

        CreatePerson({shortId: "karen-gillan", name: "Karen Gillan", props: {dateOfBirth: "1987-11-28"}}),
        ActedIn({personId: "karen-gillan", movieId: "jumanji-2017"}),
        ActedIn({personId: "karen-gillan", movieId: "jumanji-2"}),
        ActedIn({personId: "karen-gillan", movieId: "guardians-galaxy"}),
        ActedIn({personId: "karen-gillan", movieId: "infinity-war"}),
    );
}
