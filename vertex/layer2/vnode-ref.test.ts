import { C, VirtualPropType, VNodeType, VNodeTypeRef, isVNodeType, PropSchema } from "../index.ts";
import { group, test, assert, assertEquals, assertStrictEquals, assertThrows } from "../lib/tests.ts";
import { AssertPropertyAbsent, AssertPropertyPresent, checkType } from "../lib/ts-utils.ts";
import { Movie } from "../test-project/index.ts";
const MovieRef: typeof Movie = VNodeTypeRef("TestMovie");

// Forward reference to the type below
const OtherVNTRef: typeof OtherVNT = VNodeTypeRef("OtherVNT");
// A VNodeType that we don't register (using registerVNodeType)
export class OtherVNT extends VNodeType {
    static readonly label = "OtherVNT";
    static readonly properties = {...VNodeType.properties };
    static readonly defaultOrderBy = "@this.id";
    static readonly rel = {
        /** This Movie is part of a franchise */
        SELF_RELATIONSHIP: { to: [OtherVNT] },
        SELF_RELATIONSHIP_WITH_REF: { to: [OtherVNTRef] },
    };
    static readonly virtualProperties = {
        franchise: {
            type: VirtualPropType.OneRelationship,
            query: C`(@this)-[:${OtherVNT.rel.SELF_RELATIONSHIP}]->(@target:${OtherVNT})`,
            target: OtherVNT,
        },
    };
}

// Note: for this test suite, there are two references that can be used:
// 1. MovieRef, which is a forward reference to a VNode type that has now been fully loaded (registered)
// 2. OtherVNTRef, which is a forward reference to a VNode type that has NOT been fully loaded (we never called registerVNodeType())


group(import.meta, () => {

    test("a forward reference is an instance of VNodeType", () => {
        assert(isVNodeType(MovieRef));
        // And typescript sees it as a VNodeType:
        checkType<AssertPropertyPresent<typeof MovieRef, "label", string>>();
        checkType<AssertPropertyPresent<typeof MovieRef, "properties", PropSchema>>();
        checkType<AssertPropertyAbsent<typeof MovieRef, "somethingElse">>();
    });

    test("a forward reference's relationships can be accessed before the VNodeType is loaded", () => {
        const test = OtherVNTRef.rel.SELF_RELATIONSHIP;
        // And typescript sees it as a VNode Relationship declaration:
        // deno-lint-ignore no-explicit-any
        checkType<AssertPropertyPresent<typeof test, "to", Array<any>>>();
        checkType<AssertPropertyAbsent<typeof test, "somethingElse">>();
    });

    test("a forward reference can be used in a lazy CypherQuery object without being evaluated", () => {
        const test1 = C`MATCH (:${OtherVNTRef})`;
        const test2 = C`MATCH (:${OtherVNTRef})-[:${OtherVNTRef.rel.SELF_RELATIONSHIP_WITH_REF}]->(:${OtherVNTRef})`;
        // Now compilation will fail, because that's when it attempts to evaluate these objects, and this VNodeType
        // has not been registered yet:
        assertThrows(() => test1.queryString, undefined, "VNode definition with label OtherVNT has not been loaded.");
        assertThrows(() => test2.queryString, undefined, "VNode definition with label OtherVNT has not been loaded.");
        // But we can use MovieRef because it has been registered:
        const test3 = C`MATCH (:${MovieRef})-[:${MovieRef.rel.FRANCHISE_IS}]->()`;
        assertEquals(test3.queryString, "MATCH (:TestMovie:VNode)-[:FRANCHISE_IS]->()");
    });

    test("a forward reference acts like the VNode itself once loaded", () => {
        assertStrictEquals(MovieRef.properties, Movie.properties);
    });
});
