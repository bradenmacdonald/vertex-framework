import Joi from "@hapi/joi";
import { suite, test, assert } from "../lib/intern-tests";
import { AssertPropertyAbsent, AssertPropertyPresent, checkType } from "../lib/ts-utils";
import {
    VNodeType,
    RequestVNodeRawProperties,
    getRequestedRawProperties,
    SlugIdProperty,
} from "..";


// The VNodeType used in these test cases.
class SomeVNodeType extends VNodeType {
    static readonly label = "SomeVNodeType";
    static readonly properties = {
        ...VNodeType.properties,
        slugId: SlugIdProperty,
        name: Joi.string(),
        number: Joi.number(),
        otherProp: Joi.string(),
    };
}


// Data for use in tests ///////////////////////////////////////////////////////////////////////////////////////////////

suite("Data Request", () => {

    suite("RequestVNodeRawProperties + getRequestedRawProperties", () => {

        test("Can be used to specify raw properties", () => {
            const selector: RequestVNodeRawProperties<typeof SomeVNodeType> = v => v.id.name;
            const selectedProperties = getRequestedRawProperties(SomeVNodeType, selector);
            assert.sameMembers(selectedProperties, ["id", "name"]);
        });

        test("Preserves the selected order of properties", () => {
            const selectedProperties = getRequestedRawProperties(SomeVNodeType, v => v.otherProp.number.name.id);
            assert.deepStrictEqual(selectedProperties, ["otherProp", "number", "name", "id"]);
        });

        test("Provides fully typed building of the request", () => {
            // Note: this is a compile-time test, not a run-time test
            const selector: RequestVNodeRawProperties<typeof SomeVNodeType> = v => {
                const selectionSoFar = v.otherProp.number;
                // The "name" property exists and can be added to the request:
                checkType<AssertPropertyPresent<typeof selectionSoFar, "name", any>>();
                // No "nonProp" property exists so cannot be added:
                checkType<AssertPropertyAbsent<typeof selectionSoFar, "nonProp">>();
                return selectionSoFar;
            };
        });

        test("Does not have typing to add properties that are already included", () => {
            // Note: this is a compile-time test, not a run-time test
            const selector: RequestVNodeRawProperties<typeof SomeVNodeType> = v => {
                const selectionSoFar = v.otherProp.number;
                // No "number" property is already requested so cannot be added:
                checkType<AssertPropertyAbsent<typeof selectionSoFar, "number">>();
                // But it could have been added before:
                checkType<AssertPropertyPresent<typeof v.otherProp, "number", any>>();
                return selectionSoFar;
            };
        });

        test(".allProps will add all properties, in the order they were declared on the VNodeType", () => {
            const selectedProperties = getRequestedRawProperties(SomeVNodeType, v => v.allProps);
            assert.deepStrictEqual(selectedProperties, ["id", "slugId", "name", "number", "otherProp"]);
        });

        test(".allProps doesn't duplicate already selected properties", () => {
            const selectedProperties = getRequestedRawProperties(SomeVNodeType, v => v.otherProp.name.allProps);
            // Note also how the order has changed, with otherProp and name first, then the rest in declaration order:
            assert.deepStrictEqual(selectedProperties, ["otherProp", "name", "id", "slugId", "number"]);
        });

        test("ignoring the type system and adding a property twice has no effect", () => {
            const selectedProperties = getRequestedRawProperties(SomeVNodeType, v => (v as any).name.name);
            assert.deepStrictEqual(selectedProperties, ["name"]);
        });

        test("ignoring the type system and adding a non-existent property throws an exception", () => {
            assert.throws(() => {
                getRequestedRawProperties(SomeVNodeType, v => (v as any).nonProp);
            }, "Unknown property nonProp");
        });

    });

});
