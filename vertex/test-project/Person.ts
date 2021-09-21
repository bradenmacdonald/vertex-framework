import {
    C,
    defaultCreateFor,
    defaultUpdateFor,
    defineAction,
    Field,
    VirtualPropType,
    VNodeType,
    DerivedProperty,
} from "../index.ts";
import { Movie } from "./Movie.ts";

/**
 * A Person VNode type
 */
export class Person extends VNodeType {
    static label = "TestPerson" as const;
    static properties = {
        ...VNodeType.properties,
        slugId: Field.Slug,
        name: Field.String,
        dateOfBirth: Field.Date,
    };
    static readonly rel = this.hasRelationshipsFromThisTo({
        /** This Person acted in a given movie */
        ACTED_IN: {
            to: [Movie],
            properties: {
                role: Field.String,
            },
        },
        /** This Person is a friend of the given person (non-directed relationship) */
        FRIEND_OF: {
            to: [this],
            properties: {},
            cardinality: VNodeType.Rel.ToManyUnique,
        },
    });
    static virtualProperties = this.hasVirtualProperties({
        movies: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[@rel:${this.rel.ACTED_IN}]->(@target:${Movie})`,
            relationship: this.rel.ACTED_IN,
            target: Movie,
        },
        moviesOrderedByRole: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[@rel:${this.rel.ACTED_IN}]->(@target:${Movie})`,
            relationship: this.rel.ACTED_IN,
            target: Movie,
            defaultOrderBy: "@rel.role",  // Just to test ordering a Many virtual property based on a property of the relationship; ordering by movie year (as happens by default) makes more sense
        },
        costars: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[:${this.rel.ACTED_IN}]->(:${Movie})<-[:${this.rel.ACTED_IN}]-(@target:${this})`,
            target: this,
            // TODO: Support making this DISTINCT
        },
        friends: {
            type: VirtualPropType.ManyRelationship,
            query: C`(@this)-[:${this.rel.FRIEND_OF}]-(@target:${this})`,
            target: this,
        },
        age: {
            type: VirtualPropType.CypherExpression,
            cypherExpression: C`duration.between(@this.dateOfBirth, date()).years`,
            valueType: Field.Int,
        }
    });
    static defaultOrderBy = "@this.name";

    static derivedProperties = this.hasDerivedProperties({
        ageJS,
        numFriends,
    });
}

/**
 * Compute the person's age in JavaScript (as opposed to in Cypher, like the .age virtual property does.)
 * This serves as an example of a derived property, which relies on a raw property and a virtual property
 */
function ageJS(): DerivedProperty<{ageJS: number, ageNeo: number}> { return DerivedProperty.make(
    Person,
    p => p.dateOfBirth.age(),
    data => {
        const today = new Date(), dob = data.dateOfBirth;
        const m = today.getMonth() - (dob.month - 1);
        const age = (today.getFullYear() - dob.year) - (m < 0 || (m === 0 && today.getDate() < dob.day) ? 1 : 0);
        // Return a complex object and test that we can return/access data from virtual props too:
        return {ageJS: age, ageNeo: data.age};
    }
)}

/**
 * A derived property for use in tests. Easier to work with than ageJS() since it doesn't change as time goes on :p
 */
function numFriends(): DerivedProperty<number> { return DerivedProperty.make(
    Person,
    p => p.friends(f => f),
    data => {
        return data.friends.length;
    }
)}

export const UpdatePerson = defaultUpdateFor(Person, p => p.name.dateOfBirth);

export const CreatePerson = defaultCreateFor(Person, p => p.slugId.name, UpdatePerson);

export const ActedIn = defineAction({
    type: "ActedIn",
    parameters: {} as {
        personId: string,
        movieId: string,
        role: string,
    },
    //resultData: {} as Record<string, never>,
    apply: async (tx, data) => {
        const result = await tx.queryOne(C`
            MATCH (p:${Person}), p HAS KEY ${data.personId}
            MATCH (m:${Movie}), m HAS KEY ${data.movieId}
            MERGE (p)-[rel:${Person.rel.ACTED_IN}]->(m)
            SET rel.role = ${data.role}
            `.RETURN({"p.id": Field.VNID, "m.id": Field.VNID}));
        return {
            modifiedNodes: [result["p.id"]],
            resultData: {},
            description: `Recorded that ${Person.withId(result["p.id"])} acted in ${Movie.withId(result["m.id"])}.`,
        };
    },
});

// Mark two people as being friends
export const RecordFriends = defineAction({
    type: "RecordFriends",
    parameters: {} as {
        personId: string,
        otherPersonId: string,
    },
    apply: async (tx, data) => {
        const result = await tx.queryOne(C`
            MATCH (p1:${Person}), p1 HAS KEY ${data.personId}
            MATCH (p2:${Person}), p2 HAS KEY ${data.otherPersonId}
            MERGE (p1)-[:${Person.rel.FRIEND_OF}]-(p2)
        `.RETURN({"p1.id": Field.VNID, "p2.id": Field.VNID}));
        return {
            modifiedNodes: [result["p1.id"], result["p2.id"]],
            resultData: {},
            description: `Recorded that ${Person.withId(result["p1.id"])} and ${Person.withId(result["p2.id"])} are friends.`,
        };
    },
});
