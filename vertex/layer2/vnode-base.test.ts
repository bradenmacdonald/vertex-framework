import {
    VNodeType,
    Field,
} from "../index.ts";
import { group, test, assertEquals, assertStrictEquals, assertThrows } from "../lib/tests.ts";
import { getAllLabels, getRelationshipType } from "./vnode-base.ts";

/** A VNodeType for use in this test suite. */
@VNodeType.declare
class Employee extends VNodeType {
    static label = "Employee";
    static properties = {
        ...VNodeType.properties,
        slugId: Field.Slug,
    };
}

/** A VNodeType for use in this test suite. */
@VNodeType.declare
class Manager extends Employee {
    static label = "Manager";
    static properties = {
        ...Employee.properties,
    };
    static rel = this.hasRelationshipsFromThisTo({
        // A -to-many relationship:
        MANAGER_OF: { to: [Employee], properties: { since: Field.DateTime } }
    });
}

/** A VNodeType for use in this test suite. */
@VNodeType.declare
class Executive extends Manager {
    static label = "Executive";
    static readonly properties = {
        ...Manager.properties,
    };
    static readonly rel = {
        ...Manager.rel,
        // A -to-one relationship:
        HAS_ASSISTANT: { to: [Employee], properties: { since: Field.DateTime } }
    };
}

group(import.meta, () => {


    group("BaseVNodeType", () => {
        test("VNodeType.declare", () => {

            class SomeVNT extends VNodeType {
                static readonly label = "SomeVNT";
                static readonly properties = {
                    ...VNodeType.properties,
                };
            }

            VNodeType.declare(SomeVNT);
            assertThrows(() => {
                VNodeType.declare(SomeVNT);
            }, undefined, "Duplicate VNodeType label: SomeVNT");
        });
    });

    group("getAllLabels", () => {

        test("Employee", () => {
            assertEquals(getAllLabels(Employee), ["Employee", "VNode"]);
        });

        test("Manager", () => {
            assertEquals(getAllLabels(Manager), ["Manager", "Employee", "VNode"]);
        });

        test("Executive", () => {
            // Note: these should be in order, base class last.
            assertEquals(getAllLabels(Executive), ["Executive", "Manager", "Employee", "VNode"]);
        });
    });

    group("VNodeType.rel relationship declarations", () => {

        test("basic sanity check", () => {
            assertStrictEquals(getRelationshipType(Manager.rel.MANAGER_OF), "MANAGER_OF");
            assertEquals(Manager.rel.MANAGER_OF.to, [Employee]);
        });

        test("can inherit relationship properties", () => {
            // Inherited relationship:
            assertEquals(Manager.rel.MANAGER_OF, Executive.rel.MANAGER_OF);
            assertEquals(Executive.rel.MANAGER_OF.to, [Employee]);
            // New relationship:
            assertStrictEquals(getRelationshipType(Executive.rel.HAS_ASSISTANT), "HAS_ASSISTANT");
            assertEquals(Executive.rel.HAS_ASSISTANT.to, [Employee]);
        });
    });
});