import Joi from "@hapi/joi";
import { defaultCreateFor, defaultUpdateActionFor, defineAction } from "../action";
import { registerVNodeType, ShortIdProperty, VirtualPropType, VNodeType } from "../vnode";
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
        ACTED_ID: {
            toLabels: [Movie.label],
            properties: {},
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
            query: `(@this)-[:ACTED_IN]->(@target:${Movie.label})`,
            target: Movie,
        },
        costars: {
            type: VirtualPropType.ManyRelationship,
            query: `(@this)-[:ACTED_IN]->(:${Movie.label})<-[:ACTED_IN]-(@target:${Person.label})`,
            target: Person,
        },
        friends: {
            type: VirtualPropType.ManyRelationship,
            query: `(@this)-[:FRIEND_OF]-(@target:${Person.label})`,
            //gives: {friend: Person, rel: Person.relationshipsFrom.FRIEND_OF},
            target: Person,
        },
    };
    static readonly defaultOrderBy = "name";
}
registerVNodeType(Person);

// Parameters for the "UpdatePerson" Action
interface UpdateArgs {
    shortId?: string;
    name?: string;
    dateOfBirth?: string;
}

export const UpdatePerson = defaultUpdateActionFor<UpdateArgs>(Person, {mutableProperties: ["name", "dateOfBirth"], });
export const CreatePerson = defaultCreateFor<{shortId: string, name: string}, UpdateArgs>(Person, UpdatePerson);
export const ActedIn = defineAction<{personId: string, movieId: string}, {/* */}>({
    type: "ActedIn",
    apply: async (tx, data) => {
        const result = await tx.queryOne(`
            MATCH (p:${Person.label})::{$personId}
            MATCH (m:${Movie.label})::{$movieId}
            MERGE (p)-[:ACTED_IN]->(m)
        `, data, {p: Person});
        return {
            modifiedNodes: [result.p],
            resultData: {},
        };
    },
    invert: (data, resultData) => null,  // Not implemented
});
// Mark two people as being friends
export const RecordFriends = defineAction<{personId: string, otherPersonId: string}, {/* */}>({
    type: "RecordFriends",
    apply: async (tx, data) => {
        const result = await tx.queryOne(`
            MATCH (p1:${Person.label})::{$personId}
            MATCH (p2:${Person.label})::{$otherPersonId}
            MERGE (p1)-[:FRIEND_OF]->(p2)
        `, data, {p1: Person, p2: Person});
        return {
            modifiedNodes: [result.p1, result.p2],
            resultData: {},
        };
    },
    invert: (data, resultData) => null,  // Not implemented
});
