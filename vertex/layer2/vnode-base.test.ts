import Joi from "@hapi/joi";
import {
    VNodeType,
    registerVNodeType,
    unregisterVNodeType,
    ShortIdProperty,
} from "..";
import { suite, test, assertRejects, configureTestData, assert, log, before, after } from "../lib/intern-tests";
import { getAllLabels } from "./vnode-base";

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


/** A VNodeType for use in this test suite. */
class Employee extends VNodeType {
    static label = "Employee";
    static readonly properties = {
        ...VNodeType.properties,
        shortId: ShortIdProperty,
    };
}

/** A VNodeType for use in this test suite. */
class Manager extends Employee {
    static label = "Manager";
    static readonly properties = {
        ...Employee.properties,
    };
    static readonly rel = Manager.hasRelationshipsFromThisTo({
        // A -to-many relationship:
        MANAGER_OF: { to: [Employee], properties: { since: Joi.date() } }
    });
}

/** A VNodeType for use in this test suite. */
class Executive extends Manager {
    static label = "Executive";
    static readonly properties = {
        ...Manager.properties,
    };
    static readonly rel = Executive.hasRelationshipsFromThisTo({
        // A -to-one relationship:
        HAS_ASSISTANT: { to: [Employee], properties: { since: Joi.date() } }
    }, Manager);
}

suite("vnode-base", () => {


    before(() => {
        registerVNodeType(Employee);
        registerVNodeType(Manager);
        registerVNodeType(Executive);
    });

    after(() => {
        unregisterVNodeType(Employee);
        unregisterVNodeType(Manager);
        unregisterVNodeType(Executive);
    });


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

    suite("VNodeType.hasRelationshipsFromThisTo", () => {

        test("basic sanity check", () => {
            assert.strictEqual(Manager.rel.MANAGER_OF.label, "MANAGER_OF");
            assert.deepStrictEqual(Manager.rel.MANAGER_OF.to, [Employee]);
        });

        test("can inherit relationship properties", () => {
            // Inherited relationship:
            assert.deepStrictEqual(Manager.rel.MANAGER_OF, Executive.rel.MANAGER_OF);
            assert.deepStrictEqual(Executive.rel.MANAGER_OF.to, [Employee]);
            // New relationship:
            assert.strictEqual(Executive.rel.HAS_ASSISTANT.label, "HAS_ASSISTANT");
            assert.deepStrictEqual(Executive.rel.HAS_ASSISTANT.to, [Employee]);
        });
    });
});