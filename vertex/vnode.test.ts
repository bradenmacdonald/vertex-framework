import {
    isVNodeType,
    VNodeType,
} from "./";
import { suite, test, assert } from "./lib/intern-tests";
import { registerVNodeType } from "./vnode";

/** A VNode type that exists just within this file, for very basic tests */
class SomeVNT extends VNodeType {
    static readonly label = "SomeVNT";
    static readonly properties = {
        ...VNodeType.properties,
    };
}


suite("VNodeType", () => {

    test("isVNodeType", () => {
        // This is a VNodeType:
        assert.isTrue(isVNodeType(SomeVNT));
        // These things are not VNodeTypes:
        assert.isFalse(isVNodeType(VNodeType));  // The base class shouldn't return true, it's abstract
        assert.isFalse(isVNodeType({label: "Test", properties: {}}));
        assert.isFalse(isVNodeType(undefined));
        assert.isFalse(isVNodeType(true));
    });

    test("registerVNodeType", () => {
        registerVNodeType(SomeVNT);
        assert.throws(() => {
            registerVNodeType(SomeVNT);
        }, "Duplicate VNodeType label: SomeVNT");
    });
});
