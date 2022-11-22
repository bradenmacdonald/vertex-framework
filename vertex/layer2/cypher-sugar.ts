/**
 * Syntactic sugar for writing Cypher queries.
 */
import { Neo4j } from "../deps.ts";
import { GetDataShape, ResponseSchema } from "../lib/types/field.ts";
import { getRelationshipType, isBaseVNodeType, isRelationshipDeclaration } from "./vnode-base.ts";

/**
 * Wrapper around a cypher statement/query string, with optional parameters.
 * 
 * This class is designed to be used with the C`` tagged template literal helper function, and provides syntactic sugar
 * for working with Cypher queries.
 * 
 * CypherQuery provides many features:
 *
 * - ${SomeType extends VNodeType} can be interpolated into the string and will be replaced with the label of the VNode
 *   type.
 *   e.g. Input:  C`MATCH (person:${Person})`)
 *        Output: "MATCH (person:Person:VNode)"
 *
 * - Any variable can be interpolated into the string and will be integrated into the query as a Cypher query parameter
 *   e.g. Input:  C`SET node.firstName = ${firstName}`
 *        Output: "SET node.firstName = $p1"
 *
 * - A variable can also be interpolated into the string without being converted into a query parameter, by wrapping it
 *   with this same C() helper:
 *   e.g. Input:  C`SET node.${C(fieldName)} = ${value}`
 *        Output: "SET node.lastName = $p1"
 *
 * - Custom named parameters can be added to the query, via withParams(). This creates a new copy of the
 *   CypherQuery, so that a single base query can be made into several derived queries with different parameters.
 *   e.g. Input:  C`MATCH (u:User) SET u.name = $name, u.username = toLower($name)`.withParams({name: "Jamie"})
 *        Output: "MATCH (u:User) SET u.name = $name, u.username = toLower($name)"
 * 
 * - To force a value to be saved as a Neo4j integer (instead of a float), use C.int().
 *   e.g. C`... SET node.prop = ${C.int(15)}` will save the value '15' instead of '15.0'
 *   This is just a shortcut to the Neo4j driver's Int class
 * 
 * - These features are implemented in a lazy way, so the variable interpolation into the query is only done when
 *   necessary, allowing the use of references to VNode types that may initially be undefined due to circular references
 *   while the module is still loading.
 */
export class CypherQuery {
    #strings: ReadonlyArray<string>;  // An array of strings, representing the "parts" of the overall query, with a param between each part
    #paramsArray: ReadonlyArray<unknown>;  // The parameters that get interpolated between the strings of #strings
    #paramsCompiled: Record<string, unknown>;  // This hold params after compile() happens, but it also holds custom parameters explicitly added via withParams()
    #isCompiled: boolean;

    constructor(strings: ReadonlyArray<string>, params: ReadonlyArray<unknown>) {
        this.#strings = strings;
        this.#paramsArray = params;
        this.#paramsCompiled = {};
        this.#isCompiled = false;
        if (this.#strings.length - this.#paramsArray.length !== 1) {
            throw new Error("Invalid usage of CypherQuery: expected params array to have length 1 less than strings array.");
        }
    }

    get isCompiled(): boolean {
        // We could just check if this.#strings.length === 1, but that would miss compilation in the case where we
        // receive a single string with no parameters to interpolate, which still needs some other compilation.
        return this.#isCompiled;
    }

    private compile(): void {
        // Compile the final Cypher query string:
        let compiledString = "";

        for (let i = 0;;i++) {
            compiledString += this.#strings[i];
            if (i === this.#strings.length - 1) {
                break;  // This is the last string; there is no variable interpolated after it.
            }
            // Add the parameter that comes after this chunk of the string:
            const paramValue = this.#paramsArray[i];
            // What each parameter means depends on its type
            if (isBaseVNodeType(paramValue)) {
                // Using a VNodeType in a string means you want the label, e.g. "MATCH (u:${User})"
                // It gets evaluated lazily in case the VNodeType is undefined at first due to circular references
                if (compiledString[compiledString.length - 1] !== ":") {
                    throw new Error("Interpolating a VNodeType into a string is only supported for matching labels, and should come after a ':'. Use ${C(vnodeType.label)} if you need the label in some other way.");
                }
                compiledString += paramValue.label + ":VNode";  // The VNode label is always required too, to ensure it's not a deleted node and that indexes are used.
            } else if (isRelationshipDeclaration(paramValue)) {
                // Using a VNode Relationship in a string means you want the relationship type, e.g. "(u)-[:${User.rel.IS_FRIEND_OF}]->(otherUser)"
                if (compiledString[compiledString.length - 1] !== ":" && compiledString[compiledString.length - 1] !== "|") {
                    throw new Error("Interpolating a VNode Relationship into a string is only supported for matching based on relationship type, and should come after a ':' or '|'. Use ${C(getRelationshipType(relationship))} if you need the label in some other way.");
                }
                compiledString += getRelationshipType(paramValue);
            } else if (paramValue instanceof CypherQuery) {
                // Embeding another compiled Cypher clause, merging its parameters:
                let clause = paramValue.queryString;
                for (const [subParam, value] of Object.entries(paramValue.params)) {
                    const newName = `clause${i}_${subParam}`;
                    // Replace the parameters with new names that won't conflict with the names in this outer Cypher
                    // statement, being careful that '$p1' won't match+replace '$p10'
                    clause = clause.replace(new RegExp(`\\$${subParam}(?!\\d)`, "g"), "$" + newName);
                    this.#paramsCompiled[newName] = value;
                }
                compiledString += clause;
            } else {
                // This should be interpolated into the query as a $variable:
                compiledString += "$p" + i;
                this.saveParameter("p" + i, paramValue);
            }
        }

        // Save the result and avoid compiling again:
        this.#strings = [compiledString];
        this.#isCompiled = true;
        // Free memory we don't need:
        this.#paramsArray = [];
    }

    get queryString(): string {
        if (!this.isCompiled) {
            this.compile();
        }
        return this.#strings[0];
    }

    get params(): Record<string, unknown> {
        if (!this.isCompiled) {
            this.compile();
        }
        return this.#paramsCompiled;
    }

    private saveParameter(paramName: string, value: unknown): void {
        if (paramName in this.#paramsCompiled) {
            throw new Error(`Multiple values for query parameter "${paramName}"`);
        }
        this.#paramsCompiled[paramName] = value;
    }

    public clone(): CypherQuery {
        const copy = new CypherQuery(this.#strings, this.#paramsArray);
        // Note that if 'this' is already compiled, then #strings is a single-element array and #paramsArray is empty.
        // We also need to copy #paramsCompiled, in case 'this' is compiled OR has custom parameters from withParams()
        copy.#paramsCompiled = {...this.#paramsCompiled};
        // At this point, whether this instance is compiled or not, these two are identical
        return copy;
    }

    /** Add custom parameters (values for "$variables" in the cypher query) to a copy of this query */
    public withParams(extraParams: Readonly<Record<string, unknown>>): CypherQuery {
        const copy = this.clone();
        for (const paramName in extraParams) {
            copy.saveParameter(paramName, extraParams[paramName]);
        }
        return copy;
    }

    /**
     * Return a new CypherQueryWithReturnShape which is identical to this, but which also stores the expected return
     * shape.
     * @param returnShape The expected return shape for the query
     */
    public givesShape<RS extends ResponseSchema>(returnShape: RS): CypherQueryWithReturnShape<RS> {
        const copy = new CypherQueryWithReturnShape(this.#strings, this.#paramsArray, returnShape);
        copy.#paramsCompiled = {...this.#paramsCompiled};
        return copy;
    }

    /**
     * Generate a Cypher RETURN ... clause, and return a new CypherQueryWithReturnShape with that RETURN clause included
     * in the query, and the expected return shape stored. The point of this is to avoid writing pretty much the same
     * information twice: once in the RETURN statement and a second time in the ReturnShape specification.
     */
    public RETURN<RS extends ResponseSchema>(returnShape: RS): CypherQueryWithReturnShape<RS> {
        const fieldNames = Object.keys(returnShape);
        const returnStatement = `\nRETURN ${fieldNames.length > 0 ? fieldNames.join(", ") : "null"}`;
        const newStrings = [...this.#strings];
        newStrings[newStrings.length - 1] += returnStatement;
        const copy = new CypherQueryWithReturnShape(newStrings, this.#paramsArray, returnShape);
        copy.#paramsCompiled = {...this.#paramsCompiled};
        return copy;
    }
}

/**
 * A cypher query that has additional data about the shape of its return type.
 */
export class CypherQueryWithReturnShape<RS extends ResponseSchema> extends CypherQuery {
    #shape: Readonly<RS>;
    constructor(strings: ReadonlyArray<string>, params: ReadonlyArray<unknown>, shape: RS) {
        super(strings, params);
        this.#shape = shape;
    }
    get returnShape(): Readonly<RS> {
        return this.#shape;
    }
}

// Get what the expected response shape of a query is, if known. Meant only for use with query() and queryOne()
export type QueryResponse<CQ extends CypherQuery> = (
    CQ extends CypherQueryWithReturnShape<infer RS> ? GetDataShape<RS> :
    CQ extends CypherQuery ? Neo4j.Record :
    never
);

/** Tagged template string helper function - write C`cypher here` */
function C(strings: TemplateStringsArray|string, ...params: unknown[]): CypherQuery {
    if (typeof strings === "string") {
        return new CypherQuery([strings], params);
    }
    // This was used as a tagged template literal:
    return new CypherQuery(strings, params);
}
/**
 * Helper function to ensure a JavaScript number gets saved into Neo4j as an integer, not a float.
 * Use it like this: C`... SET node.prop = ${C.int(newValue)}`
 */ 
C.int = BigInt;

export {C};
