import { group, test, assertEquals, configureTestData } from "./lib/tests.ts";
import { Person, testGraph } from "./test-project/index.ts";

import { VNID, SlugId } from "./index.ts";

group("Vertex Core", () => {

    configureTestData({loadTestProjectData: true, isolateTestWrites: false});

    group("vnidForkey", () => {

        test("can retrieve VNID from either key type", async () => {
            // First, check Chris Pratt's VNID
            const slugId: SlugId = "chris-pratt";
            const vnid: VNID = (await testGraph.pullOne(Person, p => p.id, {key: slugId})).id;

            assertEquals(await testGraph.vnidForKey(vnid), vnid);
            assertEquals(await testGraph.vnidForKey(slugId), vnid);
        });
    });
});
