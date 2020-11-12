import {
    VNodeType,
    registerVNodeType,
} from "..";
import { suite, test, assert } from "../lib/intern-tests";

/** A VNode type that exists just within this file, for very basic tests */
class SomeVNT extends VNodeType {
    static readonly label = "SomeVNT";
    static readonly properties = {
        ...VNodeType.properties,
    };
}

suite("BaseVNodeType", () => {
    test("registerVNodeType", () => {
        registerVNodeType(SomeVNT);
        assert.throws(() => {
            registerVNodeType(SomeVNT);
        }, "Duplicate VNodeType label: SomeVNT");
    });
});
