import { group, test, assertEquals, assertThrows, assert } from "../lib/tests.ts";
import { AssertPropertyAbsent, AssertPropertyPresent, checkType } from "../lib/ts-utils.ts";
import {
    VNodeType,
    RequestVNodeRawProperties,
    getRequestedRawProperties,
    Field,
} from "../index.ts";


// The VNodeType used in these test cases.
class SomeVNodeType extends VNodeType {
    static readonly label = "SomeVNodeType";
    static readonly properties = {
        ...VNodeType.properties,
        slugId: Field.Slug,
        name: Field.String,
        number: Field.Int,
        otherProp: Field.String,
    };
}


// Data for use in tests ///////////////////////////////////////////////////////////////////////////////////////////////

group("Data Request", () => {

    group("RequestVNodeRawProperties + getRequestedRawProperties", () => {

        test("Can be used to specify raw properties", () => {
            const selector: RequestVNodeRawProperties<typeof SomeVNodeType> = v => v.id.name;
            const selectedProperties = getRequestedRawProperties(SomeVNodeType, selector);
            assertEquals(new Set(selectedProperties), new Set(["id", "name"]));
        });

        test("Preserves the selected order of properties", () => {
            const selectedProperties = getRequestedRawProperties(SomeVNodeType, v => v.otherProp.number.name.id);
            assertEquals(selectedProperties, ["otherProp", "number", "name", "id"]);
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
            assertEquals(selectedProperties, ["id", "slugId", "name", "number", "otherProp"]);
        });

        test(".allProps doesn't duplicate already selected properties", () => {
            const selectedProperties = getRequestedRawProperties(SomeVNodeType, v => v.otherProp.name.allProps);
            // Note also how the order has changed, with otherProp and name first, then the rest in declaration order:
            assertEquals(selectedProperties, ["otherProp", "name", "id", "slugId", "number"]);
        });

        test("ignoring the type system and adding a property twice has no effect", () => {
            const selectedProperties = getRequestedRawProperties(SomeVNodeType, v => (v as any).name.name);
            assertEquals(selectedProperties, ["name"]);
        });

        test("ignoring the type system and adding a non-existent property throws an exception", () => {
            assertThrows(() => {
                getRequestedRawProperties(SomeVNodeType, v => (v as any).nonProp);
            }, undefined, "Unknown property nonProp");
        });

    });

});
