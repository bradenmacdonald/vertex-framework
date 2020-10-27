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
    static readonly relationshipsFrom = {
        /** This Person acted in a given movie */
        ACTED_IN: {
            toLabels: [Movie.label],
            properties: {
                role: Joi.string(),
            },
        },
        /** This Person is a friend of the given person (non-directed relationship) */
        FRIEND_OF: {
            toLabels: [Person.label],
            properties: {},
        },
    };
    static readonly virtualProperties = {
        movies: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[:ACTED_IN]->(@target:${Movie})`,
            target: Movie,
        },
        costars: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[:ACTED_IN]->(:${Movie})<-[:ACTED_IN]-(@target:${Person})`,
            target: Person,
        },
        friends: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[:FRIEND_OF]-(@target:${Person})`,
            //gives: {friend: Person, rel: Person.relationshipsFrom.FRIEND_OF},
            target: Person,
        },
    };
    static readonly defaultOrderBy = "name";
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
