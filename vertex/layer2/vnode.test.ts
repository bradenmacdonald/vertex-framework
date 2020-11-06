import {
    isVNodeType,
    VNodeType,
    registerVNodeType,
} from "../";
import { suite, test, assert } from "../lib/intern-tests";

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
        assert.isTrue(isVNodeType(VNodeType));  // It's arguable if this should be true or false but it happens to be true.
        // These things are not VNodeTypes:
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
