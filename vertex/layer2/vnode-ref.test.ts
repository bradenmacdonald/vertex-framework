import { C, VirtualPropType, VNodeType, VNodeTypeRef, isVNodeType, PropSchema } from "../index.ts";
import { group, test, assert, assertEquals, assertStrictEquals, assertThrows, assertType, IsExact, IsPropertyPresent, Has } from "../lib/tests.ts";
import { Movie } from "../test-project/index.ts";
const MovieRef: typeof Movie = VNodeTypeRef();
VNodeTypeRef.resolve(MovieRef, Movie);

// Forward reference to the type below
const OtherVNTRef: typeof OtherVNT = VNodeTypeRef();
// A VNodeType that we don't register (using registerVNodeType)
export class OtherVNT extends VNodeType {
    static readonly label = "OtherVNT";
    static readonly properties = {...VNodeType.properties };
    static readonly defaultOrderBy = "@this.id";
    static readonly rel = this.hasRelationshipsFromThisTo({
        /** This Movie is part of a franchise */
        SELF_RELATIONSHIP: { to: [this] },
        SELF_RELATIONSHIP_WITH_REF: { to: [OtherVNTRef] },
    });
    static readonly virtualProperties = this.hasVirtualProperties({
        franchise: {
            type: VirtualPropType.OneRelationship,
            query: C`(@this)-[:${this.rel.SELF_RELATIONSHIP}]->(@target:${this})`,
            target: this,
        },
    });
}

// Note: for this test suite, there are two references that can be used:
// 1. MovieRef, which is a forward reference to a VNode type that has now been fully resolved
// 2. OtherVNTRef, which is a forward reference to a VNode type that has NOT been fully resolved (we never called VNodeTypeRef.resolve())


group(import.meta, () => {

    test("a forward reference is an instance of VNodeType", () => {
        assert(isVNodeType(MovieRef));
        // And typescript sees it as a VNodeType:
        assertType<IsExact<typeof MovieRef["label"], string>>(true);
        assertType<Has<typeof MovieRef["properties"], PropSchema>>(true);
        assertType<IsPropertyPresent<typeof MovieRef, "somethingElse">>(false);
    });

    test("a forward reference's relationships can be accessed before the forward reference is resolved", () => {
        // deno-lint-ignore no-unused-vars
        const test = OtherVNTRef.rel.SELF_RELATIONSHIP;
        // And typescript sees it as a VNode Relationship declaration:
        assertType<Has<typeof test["to"], Array<unknown>>>(true);
        assertType<IsPropertyPresent<typeof test, "somethingElse">>(false);
    });

    test("a forward reference can be used in a lazy CypherQuery object without being evaluated", () => {
        const test1 = C`MATCH (:${OtherVNTRef})`;
        const test2 = C`MATCH (:${OtherVNTRef})-[:${OtherVNTRef.rel.SELF_RELATIONSHIP_WITH_REF}]->(:${OtherVNTRef})`;
        // Now compilation will fail, because that's when it attempts to evaluate these objects, and this forward
        // reference has not yet been resolved:
        assertThrows(() => test1.queryString, "Unable to use forward reference that hasn't been resolved with .resolveTo()");
        assertThrows(() => test2.queryString, "Unable to use forward reference that hasn't been resolved with .resolveTo()");
        // But we can use MovieRef because it has been resolved:
        const test3 = C`MATCH (:${MovieRef})-[:${MovieRef.rel.FRANCHISE_IS}]->()`;
        assertEquals(test3.queryString, "MATCH (:TestMovie:VNode)-[:FRANCHISE_IS]->()");
    });

    test("a forward reference acts like the VNode itself once resolved", () => {
        assertStrictEquals(MovieRef.properties, Movie.properties);
    });
});
