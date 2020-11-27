/**
 * Tests for derived property declarations.
 * 
 * The implementation of actually using them is tested in pull.test.ts
 */
import {
    Action,
    C,
    DerivedProperty,
    ShortIdProperty,
    VirtualPropType,
    VNodeType,
} from "..";
import { suite, test, assert, before, after } from "../lib/intern-tests";

/** A VNodeType for use in this test suite. */
class Employee extends VNodeType {
    static label = "EmployeeDPT";  // DPT = Derived Props Test
    static readonly properties = {
        ...VNodeType.properties,
        shortId: ShortIdProperty,
    };

    static virtualProperties = VNodeType.hasVirtualProperties({
        createAction: {
            // Get the Action that originally created this employee
            type: VirtualPropType.OneRelationship,
            query: C`(@target:${Action} {type: "CreateEmployee"})-[:${Action.rel.MODIFIED}]->(@this)`,
            target: Action,
        },
    });

    static derivedProperties = VNodeType.hasDerivedProperties({
        yearsWithCompany,
    });
}

/** A VNodeType for use in this test suite. */
@VNodeType.declare
class Manager extends Employee {
    static label = "ManagerDPT";  // DPT = Derived Props Test
    static readonly properties = {
        ...Employee.properties,
    };
}

/** A VNodeType for use in this test suite. */
@VNodeType.declare
class Executive extends Manager {
    static label = "ExecutiveDPT";  // DPT = Derived Props Test
    static readonly properties = {
        ...Manager.properties,
    };

    static readonly derivedProperties = VNodeType.hasDerivedProperties({
        ...Manager.derivedProperties,
        annualBonus,
    });
}

/**
 * A sample "Derived property" that computes # of years an employee has been with the company
 * @param spec 
 */
function yearsWithCompany(): DerivedProperty<number|null> { return DerivedProperty.make(
    Employee,
    e => e.createAction(a=>a.timestamp),
    data => {
        if (!data.createAction) { return null; }
        const today = new Date(), startDate = new Date(data.createAction.timestamp);
        const m = today.getMonth() - startDate.getMonth();
        const years = (today.getFullYear() - startDate.getFullYear()) - (m < 0 || (m === 0 && today.getDate() < startDate.getDate()) ? 1 : 0);
        // Return a complex object and test that we can return/access data from virtual props too:
        return years;
    }
);}


/**
 * A sample "Derived property" that "computes" an annual bonus for each executive
 * @param spec 
 */
function annualBonus(): DerivedProperty<number> { return DerivedProperty.make(
    Executive,
    e => e,
    data => { return 100_000; }
);}

suite(__filename, () => {

    suite("VNodeType.hasDerivedProperties", () => {

        test("basic sanity check", () => {
            assert.isFunction(Employee.derivedProperties.yearsWithCompany.dataSpec);
            assert.isFunction(Employee.derivedProperties.yearsWithCompany.computeValue);
        });

        test("can inherit derived properties", () => {
            assert.strictEqual(
                Employee.derivedProperties.yearsWithCompany,
                Executive.derivedProperties.yearsWithCompany,
            );
        });
    });
});