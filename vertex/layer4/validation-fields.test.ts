/**
 * Test validation of fields, especially cleaning/coercing values.
 */

import {
    C,
    defaultCreateFor,
    Field,
    VNodeType,
} from "../index.ts";
import { assertEquals, configureTestData, group, test } from "../lib/tests.ts";
import { testGraph } from "../test-project/index.ts";

// For testing Check() functionality, we use computed_types, which is designed to be compatible.
import * as check from "https://denoporter.sirjosh.workers.dev/v1/deno.land/x/computed_types@v1.9.0/src/index.ts";



class Note extends VNodeType {
    static label = "Note";
    static readonly properties = {
        ...VNodeType.properties,
        // A default string field. By default, the validation will trim the string and limit it to 1,000 characters.
        defaultString: Field.NullOr.String,
        // A string field with custom checks. By adding a custom validtor we should skip the default trim/limit entirely.
        allCapsString: Field.NullOr.String.Check(check.string.toUpperCase()),
    };
}

const CreateNote = defaultCreateFor(Note, n => n.defaultString.allCapsString);


group(import.meta, () => {
    
    configureTestData({isolateTestWrites: true, loadTestProjectData: false, additionalVNodeTypes: [Note]});
    
    group("test field validation with cleaning features", () => {
        
        test("Default string fields are trim()ed", async () => {
            const {id} = await testGraph.runAsSystem(CreateNote({
                defaultString: "  this should be trimmed  ",
                allCapsString: " this should SHOUT but not be trimmed "
            }));
            const check = await testGraph.read(tx => tx.queryOne(C`MATCH (n:${Note} {id: ${id}})`.RETURN({n: Field.VNode(Note)})));
            assertEquals(check.n.defaultString, "this should be trimmed");
            assertEquals(check.n.allCapsString, " THIS SHOULD SHOUT BUT NOT BE TRIMMED ");
        });
    });
});
