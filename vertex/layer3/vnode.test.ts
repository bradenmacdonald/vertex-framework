import {
    isVNodeType,
    VNodeType,
} from "../index.ts";
import { group, test, assertStrictEquals } from "../lib/tests.ts";

/** A VNode type that exists just within this file, for very basic tests */
class SomeVNT extends VNodeType {
    static readonly label = "SomeVNT";
    static readonly properties = {
        ...VNodeType.properties,
    };
}

class NonVNT {
    static readonly label = "SomeVNT";
    static readonly properties = {
        ...VNodeType.properties,
    };
}


group("VNodeType", () => {

    test("isVNodeType", () => {
        // This is a VNodeType:
        assertStrictEquals(isVNodeType(SomeVNT), true);
        // These things are not VNodeTypes:
        assertStrictEquals(isVNodeType({label: "Test", properties: {}}), false);
        assertStrictEquals(isVNodeType(undefined), false);
        assertStrictEquals(isVNodeType(true), false);
        assertStrictEquals(isVNodeType(NonVNT), false);
    });
});
