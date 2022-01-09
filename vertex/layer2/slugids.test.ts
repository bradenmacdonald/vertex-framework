import {
    C,
    CypherQuery,
    VNodeType,
    Field,
    VNID,
} from "../index.ts";
import { group, test, assertEquals, configureTestData, assertThrowsAsync } from "../lib/tests.ts";
import { testGraph } from "../test-project/index.ts";

/** A VNodeType for use in this test suite. */
class Person extends VNodeType {
    static label = "Person";
    static properties = {
        ...VNodeType.properties,
        slugId: Field.Slug,
    };
}


group(import.meta, () => {

    configureTestData({loadTestProjectData: false, isolateTestWrites: true, additionalVNodeTypes: [Person]});

    // Helper function to write to the graph
    const doQuery = <Q extends CypherQuery>(q: Q) => testGraph._restrictedAllowWritesWithoutAction(() => testGraph._restrictedWrite(tx => tx.query(q)));

    test("nodes can be looked up by slugId", async () => {
        const reginaldId = VNID();
        await doQuery(C`CREATE (p:${Person} {slugId: "reginald", id: ${reginaldId}})`);
        const aliciaId = VNID();
        await doQuery(C`CREATE (p:${Person} {slugId: "alicia", id: ${aliciaId}})`);

        const result1 = await doQuery(C`MATCH (p:Person), p HAS KEY ${"reginald"}`.RETURN({p: Field.VNode(Person)}));
        assertEquals(result1[0].p.id, reginaldId);

        const result2 = await doQuery(C`MATCH (p:Person), p HAS KEY ${"alicia"}`.RETURN({p: Field.VNode(Person)}));
        assertEquals(result2[0].p.id, aliciaId);
    });

    test("nodes can be looked up by an old slugId", async () => {
        const reginaldId = VNID();
        await doQuery(C`CREATE (p:${Person} {slugId: "reginald", id: ${reginaldId}})`);
        const aliciaId = VNID();
        await doQuery(C`CREATE (p:${Person} {slugId: "alicia", id: ${aliciaId}})`);
        await doQuery(C`
            MATCH (p:${Person} {slugId: "alicia"})
            SET p.slugId = "Aleesha"
        `);

        const result1 = await doQuery(C`MATCH (p:Person), p HAS KEY ${"alicia"}`.RETURN({p: Field.VNode(Person)}));
        assertEquals(result1[0].p.id, aliciaId);

        const result2 = await doQuery(C`MATCH (p:Person), p HAS KEY ${"Aleesha"}`.RETURN({p: Field.VNode(Person)}));
        assertEquals(result2[0].p.id, aliciaId);
    });

    test("nodes can be deleted and then new nodes can be created with the same slugId", async () => {
        const slugId = "reginald";
        const originalId = VNID();
        await doQuery(C`CREATE (p:${Person} {slugId: ${slugId}, id: ${originalId}})`);
        await doQuery(C`
            MATCH (p:${Person} {slugId: ${slugId}})
            DETACH DELETE (p)
        `);
        const newId = VNID();
        await doQuery(C`CREATE (p:${Person} {slugId: ${slugId}, id: ${newId}})`);

        const result1 = await doQuery(C`MATCH (p:Person), p HAS KEY ${slugId}`.RETURN({p: Field.VNode(Person)}));
        assertEquals(result1[0].p.id, newId);
    });

    test("slugids can't point to multiple nodes", async () => {
        const alexId = VNID(), bobId = VNID();
        await doQuery(C`CREATE (p:${Person} {slugId: "alex", id: ${alexId}})`);
        await doQuery(C`CREATE (p:${Person} {slugId: "bob", id: ${bobId}})`);
        await doQuery(C`
            MATCH (p:${Person} {slugId: ${"alex"}})
            SET p.slugId = "new-slug"
        `);
        await doQuery(C`
            MATCH (p:${Person} {slugId: ${"alex"}})
            SET p.slugId = "alex"
        `);
        // We can't use the slug ID "new-slug" for bob because even though it's not a current slugId, it was previously
        // used for alex.
        await assertThrowsAsync(async () => {
            await doQuery(C`
                MATCH (p:${Person} {slugId: ${"bob"}})
                SET p.slugId = "new-slug"
            `);
        });
    });
});