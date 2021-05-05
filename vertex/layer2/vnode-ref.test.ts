import { C, VirtualPropType, VNodeType, VNodeTypeRef, isVNodeType, PropSchema } from "..";
import { suite, test, assert, dedent } from "../lib/intern-tests";
import { AssertPropertyAbsent, AssertPropertyPresent, checkType } from "../lib/ts-utils";
import {
    Movie,
    MovieRef,
} from "../test-project";

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


suite("VNodeRef", () => {

    test("a forward reference is an instance of VNodeType", () => {
        assert.isTrue(isVNodeType(MovieRef));
        // And typescript sees it as a VNodeType:
        checkType<AssertPropertyPresent<typeof MovieRef, "label", string>>();
        checkType<AssertPropertyPresent<typeof MovieRef, "properties", PropSchema>>();
        checkType<AssertPropertyAbsent<typeof MovieRef, "somethingElse">>();
    });

    test("a forward reference's relationships can be accessed before the VNodeType is loaded", () => {
        const test = OtherVNTRef.rel.SELF_RELATIONSHIP;
        // And typescript sees it as a VNode Relationship declaration:
        checkType<AssertPropertyPresent<typeof test, "to", Array<any>>>();
        checkType<AssertPropertyAbsent<typeof test, "somethingElse">>();
    });

    test("a forward reference can be used in a lazy CypherQuery object without being evaluated", () => {
        const test1 = C`MATCH (:${OtherVNTRef})`;
        const test2 = C`MATCH (:${OtherVNTRef})-[:${OtherVNTRef.rel.SELF_RELATIONSHIP_WITH_REF}]->(:${OtherVNTRef})`;
        // Now compilation will fail, because that's when it attempts to evaluate these objects, and this VNodeType
        // has not been registered yet:
        assert.throws(() => test1.queryString, "VNode definition with label OtherVNT has not been loaded.");
        assert.throws(() => test2.queryString, "VNode definition with label OtherVNT has not been loaded.");
        // But we can use MovieRef because it has been registered:
        const test3 = C`MATCH (:${MovieRef})-[:${MovieRef.rel.FRANCHISE_IS}]->()`;
        assert.equal(test3.queryString, "MATCH (:TestMovie:VNode)-[:FRANCHISE_IS]->()");
    });

    test("a forward reference acts like the VNode itself once loaded", () => {
        assert.strictEqual(MovieRef.properties, Movie.properties);
    });
});
