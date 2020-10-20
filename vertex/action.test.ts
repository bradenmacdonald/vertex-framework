import { suite, test, assertRejects, isolateTestWrites } from "./lib/intern-tests";

import { CreatePerson } from "./test-project/Person";
import { testGraph } from "./test-project/graph";

// Data for use in tests ///////////////////////////////////////////////////////////////////////////////////////////////

suite("action", () => {
    isolateTestWrites();

    suite("test isolation", () => {
        // Test that our test cases have sufficient test isolation, via isolateTestWrites()
        const createJamie = CreatePerson({shortId: "jamie", name: "Jamie", props: {}});
        test("create a person", async () => {
            await testGraph.runAsSystem(createJamie);
        });
        test("create a person (2)", async () => {
            // Should succeed, even though there is a unique constraint on shortId.
            // This will only fail if the previous test case wasn't rolled back correctly.
            await testGraph.runAsSystem(createJamie);
        });
        test("create a person (check constraint)", async () => {
            // Check our assumptions: make sure there actually is a unique constraint on shortId
            await testGraph.runAsSystem(createJamie);
            await assertRejects(
                testGraph.runAsSystem(createJamie)
            );
        });
    });
});
