import Joi from "@hapi/joi";
import {
    C,
    defaultCreateFor,
    defaultUpdateActionFor,
    defineAction,
    registerVNodeType,
    ShortIdProperty,
    VirtualPropType,
    VNodeType,
} from "../";
import { DerivedProperty } from "../layer4/derived-props";
import { Movie } from "./Movie";

/**
 * A Person VNode type
 */
export class Person extends VNodeType {
    static readonly label = "TestPerson";
    static readonly properties = {
        ...VNodeType.properties,
        shortId: ShortIdProperty,
        name: Joi.string(),
        dateOfBirth: Joi.date().iso(),//.options({convert: false}),
    };
    static readonly rel = Person.hasRelationshipsFromThisTo({
        /** This Person acted in a given movie */
        ACTED_IN: {
            to: [Movie],
            properties: {
                role: Joi.string(),
            },
        },
        /** This Person is a friend of the given person (non-directed relationship) */
        FRIEND_OF: {
            to: [Person],
            properties: {},
        },
    });
    static readonly virtualProperties = {
        movies: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[@rel:${Person.rel.ACTED_IN}]->(@target:${Movie})`,
            relationship: Person.rel.ACTED_IN,
            target: Movie,
        },
        moviesOrderedByRole: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[@rel:${Person.rel.ACTED_IN}]->(@target:${Movie})`,
            relationship: Person.rel.ACTED_IN,
            target: Movie,
            defaultOrderBy: "@rel.role",  // Just to test ordering a Many virtual property based on a property of the relationship; ordering by movie year (as happens by default) makes more sense
        },
        costars: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[:${Person.rel.ACTED_IN}]->(:${Movie})<-[:${Person.rel.ACTED_IN}]-(@target:${Person})`,
            target: Person,
        },
        friends: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[:${Person.rel.FRIEND_OF}]-(@target:${Person})`,
            target: Person,
        },
        age: {
            type: VirtualPropType.CypherExpression,
            // Note: currently, "dateOfBirth" is stored as a string - TODO: Add proper date support
            cypherExpression: C`duration.between(date(@this.dateOfBirth), date()).years`,
            valueType: "number" as const,
        }
    };
    static readonly derivedProperties = Person.hasDerivedProperties({
        ageJS: DerivedProperty(p => p.dateOfBirth.age(), data => {
            const today = new Date(), dob = new Date(data.dateOfBirth);
            const m = today.getMonth() - dob.getMonth();
            const age = (today.getFullYear() - dob.getFullYear()) - (m < 0 || (m === 0 && today.getDate() < dob.getDate()) ? 1 : 0);
            // Return a complex object and test that we can return/access data from virtual props too:
            return {ageJS: age, ageNeo: data.age};
        }),
    });
    static readonly defaultOrderBy = "@this.name";
}
registerVNodeType(Person);


export const UpdatePerson = defaultUpdateActionFor(Person, ["name", "dateOfBirth"]);

export const CreatePerson = defaultCreateFor(Person, ["shortId", "name"], UpdatePerson);

export const ActedIn = defineAction<{personId: string, movieId: string, role: string}, {/* */}>({
    type: "ActedIn",
    apply: async (tx, data) => {
        const result = await tx.queryOne(C`
            MATCH (p:${Person}), p HAS KEY ${data.personId}
            MATCH (m:${Movie}), m HAS KEY ${data.movieId}
            MERGE (p)-[rel:ACTED_IN]->(m)
            SET rel.role = ${data.role}
            `.RETURN({"p.uuid": "uuid"}));
        return {
            modifiedNodes: [result["p.uuid"]],
            resultData: {},
        };
    },
    invert: (data, resultData) => null,  // Not implemented
});
// Mark two people as being friends
export const RecordFriends = defineAction<{personId: string, otherPersonId: string}, {/* */}>({
    type: "RecordFriends",
    apply: async (tx, data) => {
        const result = await tx.queryOne(C`
            MATCH (p1:${Person}), p1 HAS KEY ${data.personId}
            MATCH (p2:${Person}), p2 HAS KEY ${data.otherPersonId}
            MERGE (p1)-[:FRIEND_OF]->(p2)
        `.RETURN({"p1.uuid": "uuid", "p2.uuid": "uuid"}));
        return {
            modifiedNodes: [result["p1.uuid"], result["p2.uuid"]],
            resultData: {},
        };
    },
    invert: (data, resultData) => null,  // Not implemented
});
