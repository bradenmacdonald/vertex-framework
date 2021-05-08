import { suite, test, assert, dedent, configureTestData } from "./lib/intern-tests";
import { checkType, AssertEqual, AssertPropertyAbsent, AssertPropertyPresent, AssertPropertyOptional } from "./lib/ts-utils";
import { Person, testGraph } from "./test-project";

import { VNID, SlugId } from ".";

suite("Vertex Core", () => {

    configureTestData({loadTestProjectData: true, isolateTestWrites: false});

    suite("vnidForkey", () => {

        test("can retrieve VNID from either key type", async () => {
            // First, check Chris Pratt's VNID
            const slugId: SlugId = "chris-pratt";
            const vnid: VNID = (await testGraph.pullOne(Person, p => p.id, {key: slugId})).id;

            assert.strictEqual(await testGraph.vnidForKey(vnid), vnid);
            assert.strictEqual(await testGraph.vnidForKey(slugId), vnid);
        });
    });
});
