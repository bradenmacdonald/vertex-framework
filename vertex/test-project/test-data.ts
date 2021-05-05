import { Vertex } from "../vertex";
import { VertexTestDataSnapshot } from "../vertex-interface";
import { CreateMovie } from "./Movie";
import { CreateMovieFranchise } from "./MovieFranchise";
import { CreatePerson, ActedIn, RecordFriends } from "./Person";

let dataSnapshot: VertexTestDataSnapshot;

/**
 * Create data that can be used for testing.
 * Test should not modify this data, but can create new data that points to this.
 * @param graph 
 */
export async function createTestData(graph: Vertex): Promise<void> {
    if (dataSnapshot !== undefined) {
        await graph.resetDBToSnapshot(dataSnapshot);
        return;
    }

    await graph.runAsSystem(
        CreateMovieFranchise({slugId: "mcu", name: "Marvel Cinematic Universe"}),
        CreateMovieFranchise({slugId: "jumanji", name: "Jumanji"}),

        CreateMovie({slugId: "tropic-thunder", title: "Tropic Thunder", year: 2008}),
        CreateMovie({slugId: "guardians-galaxy", title: "Guardians of the Galaxy", year: 2014, franchiseId: "mcu"}),
        CreateMovie({slugId: "jem-holograms", title: "Jem and the Holograms", year: 2015}),
        CreateMovie({slugId: "office-xmas-party", title: "Office Christmas Party", year: 2016}),
        CreateMovie({slugId: "jumanji-2017", title: "Jumanji: Welcome to the Jungle", year: 2017, franchiseId: "jumanji"}),
        CreateMovie({slugId: "rough-night", title: "Rough Night", year: 2017}),
        CreateMovie({slugId: "infinity-war", title: "Avengers: Infinity War", year: 2018, franchiseId: "mcu"}),
        CreateMovie({slugId: "spy-who-dumped-me", title: "The Spy Who Dumped Me", year: 2018}),
        CreateMovie({slugId: "jumanji-2", title: "Jumanji: The Next Level", year: 2019, franchiseId: "jumanji"}),

        CreatePerson({slugId: "rdj", name: "Robert Downey Jr.", dateOfBirth: "1965-04-04"}),
        ActedIn({personId: "rdj", movieId: "infinity-war", role: "Tony Stark / Iron Man"}),
        ActedIn({personId: "rdj", movieId: "tropic-thunder", role: "Kirk Lazarus"}),

        CreatePerson({slugId: "the-rock", name: "Dwayne Johnson", dateOfBirth: "1972-05-02"}),
        ActedIn({personId: "the-rock", movieId: "jumanji-2017", role: `Dr. Xander "Smolder" Bravestone`}),
        ActedIn({personId: "the-rock", movieId: "jumanji-2", role: `Dr. Xander "Smolder" Bravestone`}),
        ActedIn({personId: "the-rock", movieId: "jem-holograms", role: "Dwayne Johnson"}),

        CreatePerson({slugId: "chris-pratt", name: "Chris Pratt", dateOfBirth: "1979-06-21"}),
        ActedIn({personId: "chris-pratt", movieId: "guardians-galaxy", role: "Peter Quill"}),
        ActedIn({personId: "chris-pratt", movieId: "infinity-war", role: "Peter Quill / Star Lord"}),
        ActedIn({personId: "chris-pratt", movieId: "jem-holograms", role: "Chris Pratt"}),

        CreatePerson({slugId: "kate-mckinnon", name: "Kate McKinnon", dateOfBirth: "1984-01-06"}),
        ActedIn({personId: "kate-mckinnon", movieId: "office-xmas-party", role: "Mary"}),
        ActedIn({personId: "kate-mckinnon", movieId: "spy-who-dumped-me", role: "Morgan"}),
        ActedIn({personId: "kate-mckinnon", movieId: "rough-night", role: "Kiwi / Pippa"}),

        CreatePerson({slugId: "scarlett-johansson", name: "Scarlett Johansson", dateOfBirth: "1984-11-22"}),
        ActedIn({personId: "scarlett-johansson", movieId: "rough-night", role: "Jess"}),
        ActedIn({personId: "scarlett-johansson", movieId: "infinity-war", role: "Natasha Romanoff / Black Widow"}),

        CreatePerson({slugId: "ilana-glazer", name: "Ilana Glazer", dateOfBirth: "1987-04-12"}),
        ActedIn({personId: "ilana-glazer", movieId: "rough-night", role: "Frankie"}),

        CreatePerson({slugId: "karen-gillan", name: "Karen Gillan", dateOfBirth: "1987-11-28"}),
        ActedIn({personId: "karen-gillan", movieId: "jumanji-2017", role: "Ruby Roundhouse"}),
        ActedIn({personId: "karen-gillan", movieId: "jumanji-2", role: "Ruby Roundhouse"}),
        ActedIn({personId: "karen-gillan", movieId: "guardians-galaxy", role: "Nebula"}),
        ActedIn({personId: "karen-gillan", movieId: "infinity-war", role: "Nebula"}),

        // Friendships (these are just made up)
        RecordFriends({personId: "chris-pratt", otherPersonId: "the-rock"}),
        RecordFriends({personId: "the-rock", otherPersonId: "karen-gillan"}),
        RecordFriends({personId: "scarlett-johansson", otherPersonId: "karen-gillan"}),
        RecordFriends({personId: "scarlett-johansson", otherPersonId: "rdj"}),
        RecordFriends({personId: "kate-mckinnon", otherPersonId: "ilana-glazer"}),
    );
    // Save a snapshot to make this faster next time:
    dataSnapshot = await graph.snapshotDataForTesting();
}
