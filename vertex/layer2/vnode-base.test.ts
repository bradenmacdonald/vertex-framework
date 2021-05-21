import {
    VNodeType,
    Field,
} from "..";
import { suite, test, assert } from "../lib/intern-tests";
import { getAllLabels, getRelationshipType } from "./vnode-base";


suite("BaseVNodeType", () => {
    test("registerVNodeType", () => {

        class SomeVNT extends VNodeType {
            static readonly label = "SomeVNT";
            static readonly properties = {
                ...VNodeType.properties,
            };
        }

        VNodeType.declare(SomeVNT);
        assert.throws(() => {
            VNodeType.declare(SomeVNT);
        }, "Duplicate VNodeType label: SomeVNT");
    });
});


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
    static rel = {
        // A -to-many relationship:
        MANAGER_OF: { to: [Employee], properties: { since: Field.DateTime } }
    };
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

suite(__filename, () => {

    suite("getAllLabels", () => {

        test("Employee", () => {
            assert.sameOrderedMembers(getAllLabels(Employee), ["Employee", "VNode"]);
        });

        test("Manager", () => {
            assert.sameOrderedMembers(getAllLabels(Manager), ["Manager", "Employee", "VNode"]);
        });

        test("Executive", () => {
            // Note: these should be in order, base class last.
            assert.sameOrderedMembers(getAllLabels(Executive), ["Executive", "Manager", "Employee", "VNode"]);
        });
    });

    suite("VNodeType.rel relationship declarations", () => {

        test("basic sanity check", () => {
            assert.strictEqual(getRelationshipType(Manager.rel.MANAGER_OF), "MANAGER_OF");
            assert.deepStrictEqual(Manager.rel.MANAGER_OF.to, [Employee]);
        });

        test("can inherit relationship properties", () => {
            // Inherited relationship:
            assert.deepStrictEqual(Manager.rel.MANAGER_OF, Executive.rel.MANAGER_OF);
            assert.deepStrictEqual(Executive.rel.MANAGER_OF.to, [Employee]);
            // New relationship:
            assert.strictEqual(getRelationshipType(Executive.rel.HAS_ASSISTANT), "HAS_ASSISTANT");
            assert.deepStrictEqual(Executive.rel.HAS_ASSISTANT.to, [Employee]);
        });
    });
});